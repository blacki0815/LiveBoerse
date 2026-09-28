// ===================== Live-Börse: gemeinsame Logik =====================
import { firebaseConfig } from './firebase-config.js';

const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';

// ---------- Speicher (Firebase oder lokaler Testmodus) ----------
export async function createStore() {
  if (firebaseConfig && firebaseConfig.databaseURL) {
    const { initializeApp } = await import(FB + 'firebase-app.js');
    const db = await import(FB + 'firebase-database.js');
    const app = initializeApp(firebaseConfig);
    const database = db.getDatabase(app);
    const r = p => db.ref(database, p);
    return {
      mode: 'firebase',
      set: (p, v) => db.set(r(p), v),
      update: (p, v) => db.update(r(p), v),
      remove: p => db.remove(r(p)),
      get: async p => (await db.get(r(p))).val(),
      on: (p, cb) => db.onValue(r(p), s => cb(s.val())),
      increment: async p => {
        const res = await db.runTransaction(r(p), v => (v || 0) + 1);
        return res.snapshot.val() - 1;
      },
      onConnection: cb => db.onValue(db.ref(database, '.info/connected'), s => cb(!!s.val())),
    };
  }
  return createLocalStore();
}

function createLocalStore() {
  const KEY = 'liveboerse-local-db';
  let tree = {};
  const load = () => { try { tree = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { } };
  load();
  let chan = null;
  try { chan = new BroadcastChannel('liveboerse'); } catch (e) { }
  const listeners = [];
  const parts = p => p.split('/').filter(Boolean);
  const getAt = p => parts(p).reduce((o, k) => (o == null ? undefined : o[k]), tree);
  const clone = v => v === undefined ? null : JSON.parse(JSON.stringify(v));
  const fire = () => listeners.forEach(l => l.cb(clone(getAt(l.p))));
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(tree)); } catch (e) { } if (chan) chan.postMessage('x'); fire(); };
  if (chan) chan.onmessage = () => { load(); fire(); };
  const setAt = (p, v) => {
    const ks = parts(p); let o = tree;
    for (let i = 0; i < ks.length - 1; i++) { if (typeof o[ks[i]] !== 'object' || o[ks[i]] === null) o[ks[i]] = {}; o = o[ks[i]]; }
    if (v === null || v === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = clone(v);
  };
  return {
    mode: 'local',
    set: async (p, v) => { load(); setAt(p, v); save(); },
    update: async (p, obj) => { load(); for (const k in obj) setAt(p + '/' + k, obj[k]); save(); },
    remove: async p => { load(); setAt(p, null); save(); },
    get: async p => { load(); return clone(getAt(p)); },
    on: (p, cb) => { listeners.push({ p, cb }); cb(clone(getAt(p))); },
    increment: async p => { load(); const v = getAt(p) || 0; setAt(p, v + 1); save(); return v; },
    onConnection: cb => cb(true),
  };
}

// ---------- Preis-Orientierung ----------
export const REF_PRICE = 200;      // Vorjahresdurchschnitt, dient allen als Anker
export const SCALE_MIN = 60, SCALE_MAX = 360;

// ---------- Rollen ----------
const BUY_P = [280, 190, 240, 210, 170, 260, 200, 250, 180, 220, 300, 195, 235, 185, 225, 175, 265, 205, 165, 275];
const SELL_P = [120, 210, 160, 195, 235, 140, 205, 150, 225, 180, 100, 200, 155, 215, 170, 230, 130, 190, 240, 145];
const BUY_Q = [30, 20, 40, 20, 30, 10, 40, 30, 20, 50, 20, 30, 10, 40, 20, 30, 20, 30, 40, 20];
const SELL_Q = [20, 30, 30, 40, 20, 50, 20, 30, 20, 30, 40, 20, 30, 10, 30, 20, 40, 20, 10, 30];
const BUY_N = ['Mühle Weißmehl', 'Bäckerei Krume', 'Brauerei Hopfenglück', 'Nudelwerk Spirelli', 'Großbäcker Laib & Co', 'Mühle am Neckar', 'Brezelhaus Schwaben', 'Pizzeria Bella Farina', 'Keksfabrik Knusper', 'Futterhandel Heu', 'Backstube Morgenrot', 'Mühle Kornblume', 'Toastwerk Golden', 'Brotzeit GmbH', 'Maultaschen-Manufaktur', 'Café Streusel', 'Bio-Bäckerei Dinkel', 'Waffelwerk Süß', 'Mühle Talgrund', 'Spätzle-Fabrik Alb'];
const SELL_N = ['Hof Sonnenfeld', 'Hof Lindenau', 'Agrar Kraichgau', 'Hof Ährenglück', 'Gut Weizenhausen', 'Hof Hohenlohe', 'Bauer Kornmüller', 'Hof Wiesengrund', 'Agrar Filder', 'Gut Goldacker', 'Hof Schwarzwaldblick', 'Bauer Sommerfeld', 'Hof Taubergrund', 'Agrar Ostalb', 'Gut Rapsweg', 'Hof Neckarblick', 'Bauer Erntefroh', 'Hof am Bach', 'Agrar Hegau', 'Gut Feldkamp'];

// Sonderrollen nach Beitritts-Reihenfolge (0-basiert)
const SPECIAL = { 5: 'spec', 11: 'mega', 17: 'spec', 23: 'spec' };
const SPEC_N = ['Spekulant Wolf', 'Hedgefonds Falke', 'Spekulantin Fuchs', 'Trader Luchs', 'Fonds Adler'];

export function roleForIndex(i) {
  if (SPECIAL[i] === 'spec') {
    const k = Object.keys(SPECIAL).filter(x => SPECIAL[x] === 'spec' && Number(x) < i).length;
    return { role: 'spec', name: SPEC_N[k % SPEC_N.length], inv: 20, cash: 0, qty: 0, value: 0 };
  }
  if (SPECIAL[i] === 'mega') return { role: 'seller', mega: true, value: 160, qty: 80, name: 'GlobalGrain AG (Konzern)' };
  const n = i - Object.keys(SPECIAL).filter(x => Number(x) < i).length;
  const buyer = n % 2 === 0;
  const k = Math.floor(n / 2);
  const j = k % 20, lap = Math.floor(k / 20);
  const tweak = lap === 0 ? 0 : (lap % 2 ? 10 : -10);
  return buyer
    ? { role: 'buyer', value: BUY_P[j] + tweak, qty: BUY_Q[j], name: BUY_N[j] + (lap ? ' ' + (lap + 1) : '') }
    : { role: 'seller', value: SELL_P[j] + tweak, qty: SELL_Q[j], name: SELL_N[j] + (lap ? ' ' + (lap + 1) : '') };
}

// ---------- Größenklassen (für gezielte Ereignisse) ----------
export function sizeOf(p) {
  if (p.mega) return 'gross';
  const q = Number(p.qty) || 0;
  return q >= 40 ? 'gross' : q <= 30 ? 'klein' : 'mittel';
}
export const sizeLabel = p => p.mega ? 'Großkonzern' : ({ gross: 'großer Betrieb', mittel: 'mittlerer Betrieb', klein: 'kleiner Betrieb' })[sizeOf(p)];
const isSmall = p => sizeOf(p) === 'klein', isBig = p => sizeOf(p) === 'gross';

// ---------- Ereignisse (Schocks) ----------
export const EVENTS = {
  duerre: {
    title: 'Dürre in Osteuropa!', sub: 'Die Weizenernte bricht ein – die Höfe haben nur noch halb so viel Weizen.',
    side: 'seller', effect: 'Angebot sinkt', shift: 'Angebotskurve verschiebt sich nach links',
    card: 'Deine Ernte hat sich halbiert.', apply: p => ({ ...p, qty: Math.max(10, Math.round(Number(p.qty) / 20) * 10) }),
    rumor: 'Wetterdienste melden extreme Trockenheit in Osteuropa. Eine Missernte scheint sicher …',
    answer: 'up'
  },
  grossauftrag: {
    title: 'Riesen-Großauftrag!', sub: 'Eine Bäckereikette eröffnet 200 neue Filialen – alle Käufer brauchen 20 t mehr.',
    side: 'buyer', effect: 'Nachfrage steigt', shift: 'Nachfragekurve verschiebt sich nach rechts',
    card: 'Du brauchst 20 t mehr Weizen als bisher.', apply: p => ({ ...p, qty: Number(p.qty) + 20 }),
    rumor: 'Man munkelt, eine große Bäckereikette plant eine gewaltige Expansion …',
    answer: 'up'
  },
  rekordernte: {
    title: 'Rekordernte!', sub: 'Perfektes Wetter: Jeder Hof erntet 20 t mehr als geplant.',
    side: 'seller', effect: 'Angebot steigt', shift: 'Angebotskurve verschiebt sich nach rechts',
    card: 'Du hast 20 t mehr Weizen geerntet.', apply: p => ({ ...p, qty: Number(p.qty) + 20 }),
    rumor: 'Die Satellitenbilder zeigen: Die Felder stehen so gut wie seit Jahren nicht …',
    answer: 'down'
  },
  lowcarb: {
    title: 'Low-Carb-Trend!', sub: 'Influencer verteufeln Brot und Nudeln – die Käufer brauchen nur noch halb so viel.',
    side: 'buyer', effect: 'Nachfrage sinkt', shift: 'Nachfragekurve verschiebt sich nach links',
    card: 'Du brauchst nur noch halb so viel Weizen.', apply: p => ({ ...p, qty: Math.max(10, Math.round(Number(p.qty) / 20) * 10) }),
    rumor: 'Ein riesiger Ernährungs-Trend gegen Brot und Nudeln rollt auf Deutschland zu …',
    answer: 'down'
  },
  duenger: {
    title: 'Düngerpreise explodieren!', sub: 'Die Produktionskosten steigen – jeder Hof braucht mindestens 60 € mehr pro Tonne.',
    side: 'seller', effect: 'Angebot sinkt (Kosten steigen)', shift: 'Angebotskurve verschiebt sich nach oben/links',
    card: 'Deine Kosten sind gestiegen: Mindestpreis +60 €/t.', apply: p => ({ ...p, value: Number(p.value) + 60 }),
    rumor: 'Aus der Chemiebranche hört man: Dünger wird bald drastisch teurer …',
    answer: 'up'
  },

  // ----- Ereignisse, die nur eine Gruppe treffen -----
  frost: {
    title: 'Spätfrost in den Höhenlagen!', sub: 'Nur die kleinen Höfe in Hanglagen verlieren ihre Ernte – die großen Betriebe im Flachland bleiben verschont.',
    who: 'Nur kleine Anbieter (bis 30 t)', side: 'seller', match: isSmall,
    effect: 'Angebot sinkt', shift: 'Angebotskurve verschiebt sich im unteren Bereich nach links',
    card: 'Frostschaden: nur noch die halbe Menge, und das Nachsäen kostet (+50 €/t).', apply: p => ({ ...p, qty: Math.max(10, Math.round(Number(p.qty) / 20) * 10), value: Number(p.value) + 50 }),
    rumor: 'Der Wetterdienst warnt vor Frostnächten – vor allem in den Höhenlagen …',
    answer: 'up'
  },
  subvention: {
    title: 'EU-Hilfspaket für kleine Höfe!', sub: 'Kleine Betriebe bekommen eine Beihilfe je Tonne – sie können deshalb günstiger anbieten.',
    who: 'Nur kleine Anbieter (bis 30 t)', side: 'seller', match: isSmall,
    effect: 'Angebot steigt (Kosten sinken)', shift: 'Angebotskurve verschiebt sich nach unten/rechts',
    card: 'Die Beihilfe senkt deinen Mindestpreis um 60 €/t – und du baust 10 t mehr an.', apply: p => ({ ...p, value: Math.max(40, Number(p.value) - 60), qty: Number(p.qty) + 10 }),
    rumor: 'In Brüssel wird über Direkthilfen für kleine Betriebe verhandelt …',
    answer: 'down'
  },
  diesel: {
    title: 'Dieselpreis explodiert!', sub: 'Große Betriebe bewirtschaften weite Flächen und fahren lange Strecken – ihre Kosten steigen stark, kleine Höfe spüren kaum etwas.',
    who: 'Nur große Anbieter (ab 40 t) und der Konzern', side: 'seller', match: isBig,
    effect: 'Angebot sinkt (Kosten steigen)', shift: 'Angebotskurve verschiebt sich im oberen Bereich nach links',
    card: 'Deine Maschinen fressen Diesel: Mindestpreis +50 €/t.', apply: p => ({ ...p, value: Number(p.value) + 50 }),
    rumor: 'Die Ölpreise ziehen an – Diesel dürfte bald deutlich teurer werden …',
    answer: 'up'
  },
  bio: {
    title: 'Bio-Trend bei Handwerksbäckern!', sub: 'Kunden zahlen für handwerkliches Brot mehr – kleine Bäckereien können deshalb mehr für Weizen bieten.',
    who: 'Nur kleine Nachfrager (bis 30 t)', side: 'buyer', match: isSmall,
    effect: 'Nachfrage steigt', shift: 'Nachfragekurve verschiebt sich nach oben/rechts',
    card: 'Bio-Boom: Du brauchst 20 t mehr und kannst 40 €/t mehr zahlen.', apply: p => ({ ...p, qty: Number(p.qty) + 20, value: Number(p.value) + 40 }),
    rumor: 'Handwerksbäcker melden Rekordumsätze mit Bio-Brot …',
    answer: 'up'
  },
  industrie: {
    title: 'Industriebäckereien bauen aus!', sub: 'Die großen Abnehmer nehmen neue Werke in Betrieb und brauchen deutlich mehr Weizen. Kleine Bäckereien ändern nichts.',
    who: 'Nur große Nachfrager (ab 40 t)', side: 'buyer', match: isBig,
    effect: 'Nachfrage steigt', shift: 'Nachfragekurve verschiebt sich nach rechts',
    card: 'Neues Werk: Du brauchst 50 t mehr.', apply: p => ({ ...p, qty: Number(p.qty) + 50 }),
    rumor: 'Zwei Industriebäckereien kündigen große Werkseröffnungen an …',
    answer: 'up'
  },
};

export function affected(player, eventId) {
  const ev = EVENTS[eventId];
  if (!ev || ev.side !== player.role) return false;
  return ev.match ? !!ev.match(player) : true;
}
export function effective(player, eventId) {
  return affected(player, eventId) ? EVENTS[eventId].apply(player) : { ...player };
}

// ---------- Markt: Meistausführungsprinzip ----------
export function listOrders(ordersObj) {
  return Object.entries(ordersObj || {}).map(([pid, o]) => ({ pid, ...o, price: Number(o.price) || 0, qty: Number(o.qty) || 0 }));
}
export function supplyAt(orders, p) { return orders.filter(o => o.role === 'seller' && o.price <= p).reduce((s, o) => s + o.qty, 0); }
export function demandAt(orders, p) { return orders.filter(o => o.role === 'buyer' && o.price >= p).reduce((s, o) => s + o.qty, 0); }

export function bookTable(orders) {
  const prices = [...new Set(orders.map(o => o.price))].sort((a, b) => a - b);
  return prices.map(p => {
    const s = supplyAt(orders, p), d = demandAt(orders, p);
    return { price: p, supply: s, demand: d, volume: Math.min(s, d), diff: s - d };
  });
}

export function clear(orders) {
  const rows = bookTable(orders);
  if (!rows.length) return { price: null, volume: 0, rows, fills: {} };
  const maxV = Math.max(...rows.map(r => r.volume));
  if (maxV === 0) return { price: null, volume: 0, rows, fills: {} };
  let cand = rows.filter(r => r.volume === maxV);
  const minDiff = Math.min(...cand.map(r => Math.abs(r.diff)));
  cand = cand.filter(r => Math.abs(r.diff) === minDiff);
  const best = cand[Math.floor((cand.length - 1) / 2)];
  const P = best.price, V = best.volume;
  const fills = {};
  const buyers = orders.filter(o => o.role === 'buyer' && o.price >= P).sort((a, b) => b.price - a.price || (a.ts || 0) - (b.ts || 0));
  const sellers = orders.filter(o => o.role === 'seller' && o.price <= P).sort((a, b) => a.price - b.price || (a.ts || 0) - (b.ts || 0));
  let rest = V; for (const o of buyers) { const q = Math.min(o.qty, rest); rest -= q; fills[o.pid] = q; }
  rest = V; for (const o of sellers) { const q = Math.min(o.qty, rest); rest -= q; fills[o.pid] = q; }
  return { price: P, volume: V, rows, fills };
}

// Gewinn relativ zur geheimen Grenze (Käufer: Ersparnis, Verkäufer: Mehreinnahme)
export function gainFor(role, value, price, filled) {
  if (!filled || price == null) return 0;
  return role === 'buyer' ? (value - price) * filled : (price - value) * filled;
}

export const eur = v => (v == null ? '–' : v.toLocaleString('de-DE') + ' €');
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
export function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }

// "Schöne" Achsenschritte, damit die Beschriftung nie gequetscht wird (ca. 6–8 Striche)
export function niceStep(max, target = 7) {
  const raw = max / target, mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  for (const f of [1, 2, 2.5, 5, 10]) if (f * mag >= raw) return f * mag;
  return 10 * mag;
}
