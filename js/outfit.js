// Outfit-Logik: Kombinationen erzeugen, bewerten und für Tage/Reisen auswählen.
import { COLORS } from './color.js';

export const CATEGORIES = {
  oberteil: { label: 'Oberteil', hint: 'T-Shirt, Hemd, Bluse, Top', icon: '👕' },
  pulli: { label: 'Pulli & Strick', hint: 'Pullover, Hoodie, Cardigan', icon: '🧶' },
  unterteil: { label: 'Hose & Rock', hint: 'Jeans, Chino, Shorts, Rock', icon: '👖' },
  kleid: { label: 'Kleid & Overall', hint: 'Kleid, Jumpsuit', icon: '👗' },
  jacke: { label: 'Jacke & Mantel', hint: 'Jacke, Mantel, Blazer', icon: '🧥' },
  schuhe: { label: 'Schuhe', hint: 'Sneaker, Stiefel, Sandalen', icon: '👟' },
  accessoire: { label: 'Accessoire', hint: 'Schal, Mütze, Gürtel, Tasche', icon: '🧣' },
};

export const OCCASIONS = {
  alltag: 'Alltag',
  arbeit: 'Arbeit/Büro',
  sport: 'Sport',
  ausgehen: 'Ausgehen',
  elegant: 'Elegant',
  strand: 'Strand/Pool',
  wandern: 'Outdoor/Wandern',
};

export const WARMTH = ['', 'Sehr leicht', 'Leicht', 'Mittel', 'Warm', 'Sehr warm'];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Temperatur, die man „gefühlt" den Tag über hat.
export const dayTemp = (w) => w.tmin * 0.35 + w.tmax * 0.65;

// Wie viel Gesamt-Wärme ein Outfit bei dieser Temperatur haben sollte.
function targetWarmth(t) {
  if (t >= 27) return 2;
  if (t >= 22) return 3;
  if (t >= 17) return 4.5;
  if (t >= 12) return 6.5;
  if (t >= 6) return 8.5;
  if (t >= 0) return 10.5;
  return 12.5;
}

function outfitWarmth(o) {
  let w = 0;
  if (o.kleid) w += o.kleid.warmth * 1.5;
  if (o.oberteil) w += o.oberteil.warmth;
  if (o.unterteil) w += o.unterteil.warmth * 0.8;
  if (o.pulli) w += o.pulli.warmth * 1.1;
  if (o.jacke) w += o.jacke.warmth * 1.4;
  return w;
}

export const outfitItems = (o) =>
  ['jacke', 'pulli', 'oberteil', 'kleid', 'unterteil', 'schuhe', 'accessoire']
    .map((k) => o[k]).filter(Boolean);

function hueDist(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export function colorScore(items) {
  const colors = items.filter((i) => i.category !== 'accessoire').map((i) => i.color);
  const patterns = colors.filter((c) => COLORS[c]?.pattern).length;
  const accents = [...new Set(colors.filter((c) => COLORS[c] && !COLORS[c].neutral && !COLORS[c].pattern))];
  let s = 0;
  if (patterns > 1) s -= 6;
  if (patterns === 1 && accents.length >= 2) s -= 3;
  if (accents.length === 0) s += 1;
  else if (accents.length === 1) s += 2;
  else if (accents.length === 2) {
    const d = hueDist(COLORS[accents[0]].hue, COLORS[accents[1]].hue);
    s += d < 45 || (d > 150) ? 1 : -2.5;
  } else s -= 4;
  // Jeans zu Jeans ist meist kein guter Look
  if (colors.filter((c) => c === 'jeans').length > 1) s -= 2;
  return s;
}

const fitsOccasion = (item, occ) =>
  !occ || (item.occasions?.length ? item.occasions.includes(occ) : occ === 'alltag');

/**
 * Bewertet ein Outfit.
 * ctx: { temp, rain, occasion, recent: Map(itemId -> Tage seit zuletzt getragen),
 *        bonus: Set(itemIds), usage: Map(itemId -> Anzahl), lastDay: Set(itemIds) }
 */
export function scoreOutfit(o, ctx) {
  const items = outfitItems(o);
  let s = 0;
  const reasons = [];

  // 1) Wärme passend zur Temperatur
  const diff = outfitWarmth(o) - targetWarmth(ctx.temp);
  s -= Math.abs(diff) * 1.6;
  if (ctx.temp >= 22 && o.jacke && o.jacke.warmth > 1) s -= 4;
  if (ctx.temp >= 20 && o.pulli) s -= 3;
  if (ctx.temp < 12 && !o.jacke && ctx.has.jacke) s -= 5;
  if (o.schuhe) {
    const ideal = ctx.temp >= 24 ? 1.5 : ctx.temp >= 14 ? 2.5 : ctx.temp >= 5 ? 3.5 : 4.5;
    s -= Math.abs(o.schuhe.warmth - ideal) * 0.8;
  }
  if (o.accessoire && o.accessoire.warmth >= 3 && ctx.temp > 12) s -= 3;

  // 2) Regen
  if (ctx.rain) {
    if (o.jacke?.waterproof) { s += 3; reasons.push('regenfeste Jacke'); }
    else if (ctx.has.waterproof) s -= 2;
    if (o.schuhe?.warmth === 1) s -= 2; // offene Schuhe im Regen
  }

  // 3) Anlass
  for (const it of items) {
    if (!fitsOccasion(it, ctx.occasion)) s -= it.category === 'accessoire' ? 2 : 8;
  }

  // 4) Farben
  const cs = colorScore(items);
  s += cs * 1.2;
  if (cs >= 2) reasons.push('Farben harmonieren');

  // 5) Abwechslung: kürzlich getragene Teile vermeiden
  for (const it of items) {
    const d = ctx.recent?.get(it.id);
    if (d === undefined) continue;
    const isBasic = it.category === 'schuhe' || it.category === 'jacke' || it.category === 'accessoire';
    if (d <= 0) s -= isBasic ? 0.5 : 6;
    else if (d <= 2) s -= isBasic ? 0.3 : 3;
    else if (d <= 5) s -= isBasic ? 0 : 1;
  }

  // 6) Reiseplanung: wiederverwenden, aber nicht täglich dasselbe Oberteil
  if (ctx.bonus) {
    for (const it of items) {
      const n = ctx.usage.get(it.id) || 0;
      if (ctx.bonus.has(it.id)) s += 2.5;
      const maxUses = { oberteil: 2, kleid: 2, pulli: 3, unterteil: 3 }[it.category];
      if (maxUses && n >= maxUses) s -= 6 * (n - maxUses + 1);
      if (ctx.lastDay?.has(it.id) && ['oberteil', 'kleid'].includes(it.category)) s -= 5;
    }
  }

  // 7) Favoriten leicht bevorzugen
  for (const it of items) if (it.favorite) s += 0.5;

  return { score: s, reasons };
}

function groupItems(items) {
  const g = {};
  for (const k of Object.keys(CATEGORIES)) g[k] = [];
  for (const it of items) g[it.category]?.push(it);
  return g;
}

function randomOutfit(g, ctx) {
  const o = {};
  const canSeparates = g.oberteil.length && g.unterteil.length;
  const useDress = g.kleid.length && (!canSeparates || Math.random() < g.kleid.length / (g.kleid.length + g.oberteil.length + 1));
  if (useDress) o.kleid = pick(g.kleid);
  else if (canSeparates) { o.oberteil = pick(g.oberteil); o.unterteil = pick(g.unterteil); }
  else return null;
  if (g.pulli.length && ctx.temp < 20 && Math.random() < 0.6) o.pulli = pick(g.pulli);
  if (g.jacke.length && (ctx.temp < 18 || ctx.rain) && Math.random() < 0.85) o.jacke = pick(g.jacke);
  if (g.schuhe.length) o.schuhe = pick(g.schuhe);
  if (g.accessoire.length && Math.random() < 0.35) o.accessoire = pick(g.accessoire);
  return o;
}

const outfitKey = (o) => outfitItems(o).map((i) => i.id).sort().join('|');

/** Liefert die besten `count` unterschiedlichen Outfit-Vorschläge. */
export function suggestOutfits(allItems, ctx, count = 3, exclude = new Set()) {
  const items = allItems.filter((i) => !i.inLaundry);
  const g = groupItems(items);
  ctx = {
    ...ctx,
    has: { jacke: g.jacke.length > 0, waterproof: g.jacke.some((j) => j.waterproof) },
  };
  const seen = new Map();
  for (let i = 0; i < 900; i++) {
    const o = randomOutfit(g, ctx);
    if (!o) break;
    const key = outfitKey(o);
    if (seen.has(key) || exclude.has(key)) continue;
    const { score, reasons } = scoreOutfit(o, ctx);
    // etwas Zufall, damit „Neu mischen" auch wirklich etwas Neues bringt
    seen.set(key, { outfit: o, score, rank: score + Math.random() * 1.5, reasons, key });
  }
  return [...seen.values()].sort((a, b) => b.rank - a.rank).slice(0, count);
}

export function missingForOutfits(items) {
  const g = groupItems(items.filter((i) => !i.inLaundry));
  const missing = [];
  if (!g.kleid.length) {
    if (!g.oberteil.length) missing.push('ein Oberteil');
    if (!g.unterteil.length) missing.push('eine Hose oder einen Rock');
  }
  return missing;
}

/**
 * Plant für jeden Reisetag ein Outfit und hält die Packliste klein,
 * indem bereits eingeplante Teile bevorzugt wiederverwendet werden.
 */
export function planTrip(items, days, occasions) {
  const bonus = new Set();
  const usage = new Map();
  let lastDay = new Set();
  const plan = [];
  const occList = occasions.length ? occasions : ['alltag'];

  days.forEach((day, idx) => {
    const occasion = day.occasion || occList[idx % occList.length];
    const ctx = { temp: dayTemp(day), rain: day.rain, occasion, bonus, usage, lastDay };
    const [best] = suggestOutfits(items, ctx, 1);
    if (!best) { plan.push({ day, occasion, outfit: null }); return; }
    const its = outfitItems(best.outfit);
    for (const it of its) { bonus.add(it.id); usage.set(it.id, (usage.get(it.id) || 0) + 1); }
    lastDay = new Set(its.map((i) => i.id));
    plan.push({ day, occasion, outfit: best.outfit });
  });

  // Zusätzliche Anlässe (z. B. „Elegant" für einen Abend), die nicht als Tagesoutfit vorkamen
  const extras = [];
  for (const occ of occList) {
    if (plan.some((p) => p.occasion === occ)) continue;
    const avgDay = days[Math.floor(days.length / 2)];
    const [best] = suggestOutfits(items, { temp: dayTemp(avgDay), rain: false, occasion: occ, bonus, usage, lastDay: new Set() }, 1);
    if (best) {
      outfitItems(best.outfit).forEach((it) => bonus.add(it.id));
      extras.push({ occasion: occ, outfit: best.outfit });
    }
  }

  const packed = items.filter((i) => bonus.has(i.id));
  return { plan, extras, packed };
}

export function packingExtras(days, occasions) {
  const n = days.length;
  const hot = days.some((d) => d.tmax >= 25);
  const cold = days.some((d) => d.tmin <= 5);
  const rain = days.some((d) => d.rain);
  const list = [
    `${n + 1}× Unterwäsche`,
    `${n + 1}× Socken`,
    'Schlafsachen',
    'Kulturbeutel & Zahnbürste',
    'Ladekabel & Powerbank',
    'Ausweis/Reisepass',
  ];
  if (hot || occasions.includes('strand')) list.push('Badesachen', 'Sonnencreme', 'Sonnenbrille');
  if (cold) list.push('Mütze, Schal & Handschuhe');
  if (rain) list.push('Regenschirm');
  if (occasions.includes('sport')) list.push('Sportkleidung');
  if (occasions.includes('wandern')) list.push('Trinkflasche', 'Rucksack');
  return list;
}
