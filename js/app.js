import { db, uid } from './db.js';
import { COLORS, loadImage, resizeImage, detectColor } from './color.js';
import {
  CATEGORIES, OCCASIONS, WARMTH, suggestOutfits, outfitItems, scoreOutfit,
  missingForOutfits, planTrip, packingExtras, dayTemp,
} from './outfit.js';
import * as weather from './weather.js';

// ---------- Hilfsfunktionen ----------
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const sheet = $('#sheet');
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayIso = () => new Date().toLocaleDateString('sv-SE');
const fmtDate = (iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('de-DE', opts);
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
const swatchStyle = (c) => {
  const v = COLORS[c]?.hex || '#ccc';
  return v.startsWith('conic') ? `background:${v}` : `background:${v}`;
};

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2400);
}

const itemLabel = (it) => it.name || `${CATEGORIES[it.category].label} · ${COLORS[it.color]?.label || ''}`;

// ---------- Zustand ----------
const state = {
  tab: 'heute',
  items: [],
  wears: [],
  trips: [],
  place: null,
  weatherToday: null,
  weatherError: null,
  manualTemp: 18,
  occasion: 'alltag',
  suggestions: [],
  current: 0,
  seen: new Set(),
  filter: 'alle',
  addQueue: [],
};

async function loadData() {
  [state.items, state.wears, state.trips] = await Promise.all([db.all('items'), db.all('wears'), db.all('trips')]);
  state.items.sort((a, b) => b.createdAt - a.createdAt);
  state.trips.sort((a, b) => a.start.localeCompare(b.start));
  state.place = await db.getSetting('place');
  state.occasion = await db.getSetting('occasion', 'alltag');
}

// Wie viele Tage ist es her, dass ein Teil getragen wurde?
function recentMap() {
  const m = new Map();
  const t = todayIso();
  for (const w of state.wears) {
    const d = daysBetween(w.date, t);
    if (d < 0 || d > 14) continue;
    for (const id of w.itemIds) if (!m.has(id) || m.get(id) > d) m.set(id, d);
  }
  return m;
}

const todaysWear = () => state.wears.find((w) => w.date === todayIso());

// ---------- Navigation ----------
const TITLES = { heute: 'Heute', schrank: 'Mein Schrank', reisen: 'Reisen', mehr: 'Mehr' };

function go(tab) {
  state.tab = tab;
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#title').textContent = TITLES[tab];
  render();
  window.scrollTo(0, 0);
}

function render() {
  ({ heute: renderToday, schrank: renderCloset, reisen: renderTrips, mehr: renderMore })[state.tab]();
}

document.querySelector('.tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (b) go(b.dataset.tab);
});

// ---------- HEUTE ----------
function weatherCtx() {
  const w = state.weatherToday;
  if (w) return { temp: dayTemp(w), rain: w.rain };
  return { temp: state.manualTemp, rain: false };
}

function computeSuggestions(reset = false) {
  if (reset) state.seen = new Set();
  const ctx = { ...weatherCtx(), occasion: state.occasion, recent: recentMap() };
  state.suggestions = suggestOutfits(state.items, ctx, 5, state.seen);
  state.suggestions.forEach((s) => state.seen.add(s.key));
  state.current = 0;
}

function piecesHtml(outfit, { swappable = false } = {}) {
  return outfitItems(outfit).map((it) => `
    <button class="piece" ${swappable ? `data-swap="${it.category}"` : `data-item="${it.id}"`} title="${esc(itemLabel(it))}">
      <img src="${it.photo}" alt="${esc(itemLabel(it))}" loading="lazy">
      <span class="tag">${CATEGORIES[it.category].icon} ${esc(itemLabel(it))}</span>
      ${swappable ? '<span class="swap">↻</span>' : ''}
    </button>`).join('');
}

function weatherHtml() {
  const w = state.weatherToday;
  if (w) {
    const [icon, text] = weather.describeCode(w.code);
    return `
      <div class="weather">
        <div class="big">${icon}</div>
        <div style="flex:1">
          <div class="temp">${w.tmax}° <span class="muted small">/ ${w.tmin}°</span></div>
          <div class="muted small">${text}${w.rain ? ' · Regen wahrscheinlich' : ''} · ${esc(state.place?.label || '')}</div>
        </div>
        <button class="linkish small" data-action="change-place">Ort ändern</button>
      </div>`;
  }
  return `
    <div class="stack">
      <div class="row between">
        <strong>🌡️ Temperatur heute: <span id="tempVal">${state.manualTemp}°</span></strong>
        <button class="linkish small" data-action="change-place">${state.place ? 'Erneut laden' : 'Ort festlegen'}</button>
      </div>
      <input type="range" min="-10" max="38" value="${state.manualTemp}" id="manualTemp" aria-label="Temperatur">
      ${state.weatherError ? `<div class="muted small">${esc(state.weatherError)} – Temperatur bitte manuell einstellen.</div>` : ''}
    </div>`;
}

function renderToday() {
  const missing = missingForOutfits(state.items);
  const occ = Object.entries(OCCASIONS).map(([k, v]) =>
    `<button class="chip ${state.occasion === k ? 'on' : ''}" data-occ="${k}">${v}</button>`).join('');

  let outfitHtml;
  if (!state.items.length) {
    outfitHtml = `
      <div class="card empty">
        <div class="emoji">📸</div>
        <h2>Fotografiere deine Kleidung</h2>
        <p class="muted">Lege ein Teil flach hin oder häng es auf, mach ein Foto – die Farbe wird automatisch erkannt.
        Ab einem Oberteil und einer Hose gibt's den ersten Outfit-Vorschlag.</p>
        <button class="btn primary" data-action="add">+ Erstes Teil hinzufügen</button>
      </div>`;
  } else if (missing.length) {
    outfitHtml = `<div class="card empty"><div class="emoji">👀</div>
      <p>Für ein Outfit fehlt noch ${missing.join(' und ')}.</p>
      <button class="btn primary" data-action="add">+ Teil hinzufügen</button></div>`;
  } else {
    if (!state.suggestions.length) computeSuggestions(true);
    const s = state.suggestions[state.current];
    const worn = todaysWear();
    if (!s) {
      outfitHtml = `<div class="card empty"><p>Keine weiteren Kombinationen gefunden.</p>
        <button class="btn" data-action="reshuffle-reset">Von vorn</button></div>`;
    } else {
      const reasons = [...new Set(s.reasons)];
      const t = Math.round(weatherCtx().temp);
      outfitHtml = `
        <div class="card">
          <div class="row between" style="margin-bottom:10px">
            <h2 style="font-size:1.1rem">Dein Outfit</h2>
            <span class="muted small">Tippe ein Teil zum Tauschen</span>
          </div>
          <div class="outfit">${piecesHtml(s.outfit, { swappable: true })}</div>
          <div class="reasons">
            <span class="reason">passt zu ~${t}°</span>
            <span class="reason">${OCCASIONS[state.occasion]}</span>
            ${reasons.map((r) => `<span class="reason">${esc(r)}</span>`).join('')}
          </div>
          <div class="row" style="margin-top:14px">
            <button class="btn ghost" style="flex:1" data-action="reshuffle">🔄 Anderes</button>
            <button class="btn primary" style="flex:1.4" data-action="wear">✓ Ziehe ich an</button>
          </div>
          ${worn ? `<p class="small worn-badge" style="margin:12px 0 0">✓ Heute eingetragen: ${worn.itemIds.length} Teile. Erneut tippen ersetzt den Eintrag.</p>` : ''}
        </div>`;
    }
  }

  view.innerHTML = `
    <div class="card">${weatherHtml()}</div>
    <div class="chips" style="margin-bottom:12px">${occ}</div>
    ${outfitHtml}
    ${state.items.length ? historyHtml() : ''}`;

  const range = $('#manualTemp');
  if (range) {
    range.addEventListener('input', () => { $('#tempVal').textContent = range.value + '°'; });
    range.addEventListener('change', () => { state.manualTemp = +range.value; computeSuggestions(true); renderToday(); });
  }
}

function historyHtml() {
  const recent = [...state.wears].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  if (!recent.length) return '';
  const byId = new Map(state.items.map((i) => [i.id, i]));
  return `<div class="section-title">Zuletzt getragen</div>
    <div class="card">${recent.map((w) => `
      <div class="row" style="margin:6px 0">
        <div class="small muted" style="width:84px;flex:none">${fmtDate(w.date)}</div>
        <div class="row" style="gap:4px;overflow:hidden">${w.itemIds.map((id) => byId.get(id)).filter(Boolean).map((it) =>
          `<img src="${it.photo}" alt="" style="width:34px;height:44px;object-fit:cover;border-radius:6px">`).join('')}</div>
      </div>`).join('')}</div>`;
}

// Ein einzelnes Teil im Vorschlag gegen die nächstbeste Alternative tauschen
function swapPiece(category) {
  const s = state.suggestions[state.current];
  if (!s) return;
  const current = s.outfit[category];
  const ctx = { ...weatherCtx(), occasion: state.occasion, recent: recentMap(),
    has: { jacke: state.items.some((i) => i.category === 'jacke'), waterproof: state.items.some((i) => i.waterproof) } };
  const options = state.items.filter((i) => i.category === category && !i.inLaundry);
  if (options.length < 2) { toast('Keine Alternative in dieser Kategorie'); return; }
  const ranked = options.map((it) => {
    const o = { ...s.outfit, [category]: it };
    return { it, score: scoreOutfit(o, ctx).score };
  }).sort((a, b) => b.score - a.score);
  s.tried ??= {};
  s.tried[category] ??= new Set([current.id]);
  let next = ranked.find((r) => !s.tried[category].has(r.it.id));
  if (!next) { s.tried[category] = new Set([current.id]); next = ranked.find((r) => r.it.id !== current.id); }
  s.tried[category].add(next.it.id);
  s.outfit = { ...s.outfit, [category]: next.it };
  s.reasons = scoreOutfit(s.outfit, ctx).reasons;
  renderToday();
}

async function wearCurrent() {
  const s = state.suggestions[state.current];
  if (!s) return;
  const date = todayIso();
  const existing = todaysWear();
  const entry = { id: existing?.id || uid(), date, itemIds: outfitItems(s.outfit).map((i) => i.id) };
  await db.put('wears', entry);
  for (const it of outfitItems(s.outfit)) {
    if (!existing?.itemIds.includes(it.id)) {
      it.wearCount = (it.wearCount || 0) + 1;
      it.lastWorn = date;
      await db.put('items', it);
    }
  }
  state.wears = await db.all('wears');
  toast('Viel Spaß mit deinem Outfit! 👌');
  renderToday();
}

async function loadWeather() {
  if (!state.place) {
    try {
      state.place = await weather.currentPosition();
      await db.setSetting('place', state.place);
    } catch (e) {
      state.weatherError = 'Kein Standort';
      return;
    }
  }
  try {
    state.weatherToday = await weather.today(state.place);
    state.weatherError = null;
  } catch (e) {
    state.weatherError = 'Wetter nicht verfügbar (offline?)';
  }
}

// ---------- ORT-AUSWAHL ----------
function openPlacePicker(onPick) {
  openSheet('Ort wählen', `
    <div class="stack">
      <button class="btn block" data-place-gps>📍 Aktuellen Standort verwenden</button>
      <input type="search" id="placeQ" placeholder="Stadt suchen, z. B. Lissabon" autocomplete="off">
      <div id="placeResults"></div>
    </div>`);
  const q = $('#placeQ');
  let timer;
  q.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (q.value.trim().length < 2) { $('#placeResults').innerHTML = ''; return; }
      try {
        const res = await weather.searchPlace(q.value.trim());
        $('#placeResults').innerHTML = res.length
          ? `<div class="results">${res.map((r, i) => `<button data-i="${i}">${esc(r.label)}</button>`).join('')}</div>`
          : '<p class="muted small">Nichts gefunden.</p>';
        $('#placeResults').onclick = (e) => {
          const b = e.target.closest('button[data-i]');
          if (b) { closeSheet(); onPick(res[+b.dataset.i]); }
        };
      } catch { $('#placeResults').innerHTML = '<p class="muted small">Suche nicht möglich (offline?).</p>'; }
    }, 300);
  });
  $('[data-place-gps]').onclick = async () => {
    try { const p = await weather.currentPosition(); closeSheet(); onPick(p); }
    catch (e) { toast(e.message); }
  };
  setTimeout(() => q.focus(), 50);
}

// ---------- SCHRANK ----------
function renderCloset() {
  const counts = {};
  state.items.forEach((i) => { counts[i.category] = (counts[i.category] || 0) + 1; });
  const filters = [['alle', `Alle (${state.items.length})`], ...Object.entries(CATEGORIES)
    .filter(([k]) => counts[k]).map(([k, v]) => [k, `${v.icon} ${v.label} (${counts[k]})`])];
  const laundryCount = state.items.filter((i) => i.inLaundry).length;
  if (laundryCount) filters.push(['waesche', `🧺 Wäsche (${laundryCount})`]);
  if (state.items.some((i) => i.favorite)) filters.push(['fav', '❤️ Favoriten']);

  const list = state.items.filter((i) =>
    state.filter === 'alle' ? true :
    state.filter === 'waesche' ? i.inLaundry :
    state.filter === 'fav' ? i.favorite : i.category === state.filter);

  view.innerHTML = state.items.length ? `
    <div class="chips" style="margin-bottom:12px">${filters.map(([k, v]) =>
      `<button class="chip ${state.filter === k ? 'on' : ''}" data-filter="${k}">${v}</button>`).join('')}</div>
    <div class="grid">${list.map((it) => `
      <button class="thumb ${it.inLaundry ? 'laundry' : ''}" data-item="${it.id}" aria-label="${esc(itemLabel(it))}">
        <img src="${it.photo}" alt="" loading="lazy">
        ${it.favorite ? '<span class="badge">❤️</span>' : it.inLaundry ? '<span class="badge">🧺</span>' : ''}
        <span class="dot" style="${swatchStyle(it.color)}"></span>
      </button>`).join('')}</div>
    ${!list.length ? '<p class="muted">Keine Teile in diesem Filter.</p>' : ''}
    <button class="fab" data-action="add">＋ Teil scannen</button>` : `
    <div class="card empty">
      <div class="emoji">🚪</div>
      <h2>Dein Schrank ist noch leer</h2>
      <p class="muted">Tipp: Fotografiere jedes Teil einzeln vor einem ruhigen, hellen Hintergrund. Du kannst auch mehrere Fotos aus der Galerie auf einmal auswählen.</p>
      <div class="stack">
        <button class="btn primary block" data-action="camera">📷 Foto aufnehmen</button>
        <button class="btn block" data-action="gallery">🖼️ Aus Galerie (mehrere möglich)</button>
      </div>
    </div>`;
}

function openAddChooser() {
  openSheet('Teil hinzufügen', `
    <div class="stack">
      <button class="btn primary block" data-action="camera">📷 Foto aufnehmen</button>
      <button class="btn block" data-action="gallery">🖼️ Aus Galerie wählen (mehrere möglich)</button>
      <p class="muted small">Am besten klappt die Farberkennung, wenn das Teil das Bild ausfüllt und vor einem einfarbigen Hintergrund liegt.</p>
    </div>`);
}

async function handleFiles(files) {
  state.addQueue = [...files];
  nextInQueue();
}

async function nextInQueue() {
  const file = state.addQueue.shift();
  if (!file) return;
  try {
    const img = await loadImage(file);
    const photo = resizeImage(img);
    const color = detectColor(img);
    openItemEditor({ id: null, photo, color, category: null, warmth: 3, occasions: ['alltag'], waterproof: false, favorite: false, name: '' });
  } catch (e) {
    toast(e.message);
    nextInQueue();
  }
}

function openItemEditor(item) {
  const isNew = !item.id;
  const draft = { ...item, occasions: [...(item.occasions || [])] };
  const remaining = state.addQueue.length;

  const html = () => `
    <div class="stack">
      <img class="photo-preview" src="${draft.photo}" alt="Foto des Kleidungsstücks">
      ${isNew ? '' : `<button class="btn ghost block small" data-ed="rephoto">📷 Foto ersetzen</button>`}
      <div class="section-title">Kategorie</div>
      <div class="chips wrap">${Object.entries(CATEGORIES).map(([k, v]) =>
        `<button class="chip ${draft.category === k ? 'on' : ''}" data-cat="${k}" title="${v.hint}">${v.icon} ${v.label}</button>`).join('')}</div>
      <div class="section-title">Farbe ${isNew ? '<span style="text-transform:none;letter-spacing:0">(automatisch erkannt – bei Bedarf ändern)</span>' : ''}</div>
      <div class="swatches">${Object.entries(COLORS).map(([k, v]) =>
        `<button class="swatch ${draft.color === k ? 'on' : ''}" data-color="${k}" style="${swatchStyle(k)}" title="${v.label}" aria-label="${v.label}"></button>`).join('')}</div>
      <div class="small muted">Gewählt: <strong>${COLORS[draft.color]?.label}</strong></div>
      <div class="section-title">Wärme</div>
      <input type="range" min="1" max="5" step="1" value="${draft.warmth}" data-ed="warmth" aria-label="Wärme">
      <div class="row between small muted"><span>☀️ luftig</span><strong id="warmthLabel">${WARMTH[draft.warmth]}</strong><span>❄️ warm</span></div>
      <div class="section-title">Passt zu</div>
      <div class="chips wrap">${Object.entries(OCCASIONS).map(([k, v]) =>
        `<button class="chip ${draft.occasions.includes(k) ? 'on' : ''}" data-occ-ed="${k}">${v}</button>`).join('')}</div>
      <label class="field"><span>Name (optional)</span><input type="text" data-ed="name" value="${esc(draft.name)}" placeholder="z. B. Lieblingsjeans"></label>
      ${['jacke', 'schuhe'].includes(draft.category) ? `<label class="switch"><span>🌧️ Wasserfest</span><input type="checkbox" data-ed="waterproof" ${draft.waterproof ? 'checked' : ''}></label>` : ''}
      <label class="switch"><span>❤️ Favorit</span><input type="checkbox" data-ed="favorite" ${draft.favorite ? 'checked' : ''}></label>
      ${isNew ? '' : `<label class="switch"><span>🧺 In der Wäsche (wird nicht vorgeschlagen)</span><input type="checkbox" data-ed="inLaundry" ${draft.inLaundry ? 'checked' : ''}></label>
        <p class="small muted">${item.wearCount ? `${item.wearCount}× getragen, zuletzt am ${fmtDate(item.lastWorn, { day: 'numeric', month: 'long' })}` : 'Noch nie getragen'}</p>`}
      <button class="btn primary block" data-ed="save" ${draft.category ? '' : 'disabled'}>${isNew ? (remaining ? `Speichern & nächstes (${remaining})` : 'Speichern') : 'Änderungen speichern'}</button>
      ${isNew && remaining ? '<button class="btn ghost block" data-ed="skip">Dieses Foto überspringen</button>' : ''}
      ${isNew ? '' : '<button class="btn danger block" data-ed="delete">Teil löschen</button>'}
    </div>`;

  openSheet(isNew ? 'Neues Teil' : itemLabel(item), html());
  const body = $('.sheet-body', sheet);
  const rerender = () => { const y = body.scrollTop; body.innerHTML = html(); body.scrollTop = y; };
  const suggestWarmth = { oberteil: 2, pulli: 4, unterteil: 3, kleid: 2, jacke: 4, schuhe: 2, accessoire: 1 };

  body.onclick = async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.cat) {
      if (isNew && draft.category === null) draft.warmth = suggestWarmth[t.dataset.cat];
      draft.category = t.dataset.cat;
      rerender();
    } else if (t.dataset.color) { draft.color = t.dataset.color; rerender(); }
    else if (t.dataset.occEd) {
      const k = t.dataset.occEd;
      draft.occasions = draft.occasions.includes(k) ? draft.occasions.filter((o) => o !== k) : [...draft.occasions, k];
      rerender();
    } else if (t.dataset.ed === 'save') {
      const toSave = { ...item, ...draft, id: draft.id || uid(), createdAt: item.createdAt || Date.now() };
      await db.put('items', toSave);
      await refreshItems();
      toast(isNew ? 'Gespeichert ✓' : 'Aktualisiert ✓');
      if (isNew && state.addQueue.length) nextInQueue(); else closeSheet();
    } else if (t.dataset.ed === 'skip') nextInQueue();
    else if (t.dataset.ed === 'delete') {
      if (!confirm('Dieses Teil wirklich löschen?')) return;
      await db.del('items', item.id);
      await refreshItems();
      closeSheet();
      toast('Gelöscht');
    } else if (t.dataset.ed === 'rephoto') {
      pickFile($('#camInput'), async (files) => {
        const img = await loadImage(files[0]);
        draft.photo = resizeImage(img);
        draft.color = detectColor(img);
        rerender();
      });
    }
  };
  body.oninput = (e) => {
    const k = e.target.dataset.ed;
    if (k === 'warmth') { draft.warmth = +e.target.value; $('#warmthLabel').textContent = WARMTH[draft.warmth]; }
    if (k === 'name') draft.name = e.target.value;
  };
  body.onchange = (e) => {
    const k = e.target.dataset.ed;
    if (['waterproof', 'favorite', 'inLaundry'].includes(k)) draft[k] = e.target.checked;
  };
}

async function refreshItems() {
  state.items = (await db.all('items')).sort((a, b) => b.createdAt - a.createdAt);
  state.suggestions = [];
  render();
}

function pickFile(input, cb) {
  input.value = '';
  input.onchange = () => { if (input.files.length) cb([...input.files]); };
  input.click();
}

// ---------- REISEN ----------
function renderTrips() {
  const t = todayIso();
  const upcoming = state.trips.filter((x) => x.end >= t);
  const past = state.trips.filter((x) => x.end < t);
  const tripCard = (x) => `
    <button class="card" data-trip="${x.id}" style="display:block;width:100%;text-align:left;border:0">
      <div class="row between">
        <div>
          <h3>${esc(x.name)}</h3>
          <div class="muted small">${fmtDate(x.start)} – ${fmtDate(x.end)} · ${x.days.length} Tage</div>
        </div>
        <div class="muted">›</div>
      </div>
      <div class="small muted" style="margin-top:6px">${x.packedIds.length} Teile im Koffer · ${x.occasions.map((o) => OCCASIONS[o]).join(', ')}</div>
    </button>`;
  view.innerHTML = `
    <button class="btn primary block" data-action="new-trip" style="margin-bottom:16px">＋ Neue Reise planen</button>
    ${upcoming.length ? upcoming.map(tripCard).join('') : `
      <div class="card empty"><div class="emoji">🧳</div>
      <p class="muted">Plane eine Reise: Ziel und Datum angeben – die App holt die Wettervorhersage (oder Vorjahreswerte),
      stellt für jeden Tag ein Outfit zusammen und erstellt eine möglichst kleine Packliste.</p></div>`}
    ${past.length ? `<div class="section-title">Vergangene Reisen</div>${past.map(tripCard).join('')}` : ''}`;
}

function openTripForm() {
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const end = new Date(); end.setDate(end.getDate() + 5);
  const f = { place: null, start: tomorrow.toLocaleDateString('sv-SE'), end: end.toLocaleDateString('sv-SE'), occasions: ['alltag'] };
  const html = () => `
    <div class="stack">
      <label class="field"><span>Reiseziel</span>
        <button class="btn ghost block" data-tf="place" style="justify-content:flex-start">${f.place ? '📍 ' + esc(f.place.label) : 'Ort suchen …'}</button></label>
      <div class="row">
        <label class="field" style="flex:1"><span>Von</span><input type="date" data-tf="start" value="${f.start}"></label>
        <label class="field" style="flex:1"><span>Bis</span><input type="date" data-tf="end" value="${f.end}"></label>
      </div>
      <div class="section-title">Was hast du vor?</div>
      <div class="chips wrap">${Object.entries(OCCASIONS).map(([k, v]) =>
        `<button class="chip ${f.occasions.includes(k) ? 'on' : ''}" data-tocc="${k}">${v}</button>`).join('')}</div>
      <p class="small muted">Die Tage werden reihum auf die gewählten Anlässe verteilt. Einzelne Tage kannst du danach anpassen.</p>
      <button class="btn primary block" data-tf="go" ${f.place ? '' : 'disabled'}>Outfits & Packliste erstellen</button>
    </div>`;
  openSheet('Neue Reise', html());
  const rerender = () => { $('.sheet-body', sheet).innerHTML = html(); };
  const onChange = (e) => { if (e.target.dataset.tf) f[e.target.dataset.tf] = e.target.value; };
  const onClick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tocc) {
      const k = b.dataset.tocc;
      f.occasions = f.occasions.includes(k) ? f.occasions.filter((o) => o !== k) : [...f.occasions, k];
      rerender();
    } else if (b.dataset.tf === 'place') {
      openPlacePicker((p) => { f.place = p; openSheet('Neue Reise', html()); rebind(); });
    } else if (b.dataset.tf === 'go') {
      if (f.end < f.start) return toast('Das Enddatum liegt vor dem Startdatum');
      if (daysBetween(f.start, f.end) > 30) return toast('Maximal 31 Tage');
      if (missingForOutfits(state.items).length) return toast('Füge zuerst Oberteile und Hosen zu deinem Schrank hinzu');
      b.disabled = true; b.innerHTML = '<span class="spinner"></span> Wetter wird geladen …';
      try {
        const days = await weather.range(f.place, f.start, f.end);
        const trip = { id: uid(), name: f.place.name || f.place.label, place: f.place, start: f.start, end: f.end,
          occasions: f.occasions.length ? f.occasions : ['alltag'], days, checked: [], createdAt: Date.now() };
        applyPlan(trip);
        await db.put('trips', trip);
        state.trips = (await db.all('trips')).sort((a, b) => a.start.localeCompare(b.start));
        closeSheet();
        renderTrips();
        openTrip(trip.id);
      } catch (err) {
        toast(err.message);
        b.disabled = false; b.textContent = 'Erneut versuchen';
      }
    }
  };
  function rebind() {
    const b2 = $('.sheet-body', sheet);
    b2.onchange = onChange; b2.onclick = onClick;
  }
  rebind();
}

function applyPlan(trip) {
  const result = planTrip(state.items, trip.days, trip.occasions);
  trip.plan = result.plan.map((p) => ({ date: p.day.date, occasion: p.occasion, ids: p.outfit ? outfitItems(p.outfit).map((i) => i.id) : [] }));
  trip.extras = result.extras.map((x) => ({ occasion: x.occasion, ids: outfitItems(x.outfit).map((i) => i.id) }));
  trip.packedIds = result.packed.map((i) => i.id);
}

function openTrip(id) {
  const trip = state.trips.find((t) => t.id === id);
  if (!trip) return;
  const byId = new Map(state.items.map((i) => [i.id, i]));
  const outfitOf = (ids) => {
    const o = {};
    ids.map((i) => byId.get(i)).filter(Boolean).forEach((it) => { o[it.category] = it; });
    return o;
  };
  const extrasList = packingExtras(trip.days, trip.occasions);
  const packed = trip.packedIds.map((i) => byId.get(i)).filter(Boolean)
    .sort((a, b) => Object.keys(CATEGORIES).indexOf(a.category) - Object.keys(CATEGORIES).indexOf(b.category));
  const checked = new Set(trip.checked || []);
  const estimated = trip.days.some((d) => d.estimated);
  const total = packed.length + extrasList.length;
  const done = [...checked].filter((k) => packed.some((p) => p.id === k) || extrasList.includes(k)).length;

  openSheet(`🧳 ${trip.name}`, `
    <div class="stack">
      <div class="muted small">${fmtDate(trip.start, { day: 'numeric', month: 'long' })} – ${fmtDate(trip.end, { day: 'numeric', month: 'long', year: 'numeric' })}
        ${estimated ? '<br>ℹ️ Für Tage außerhalb der 16-Tage-Vorhersage werden Wetterwerte vom Vorjahr verwendet.' : ''}</div>

      <div class="section-title">Packliste · ${done}/${total}</div>
      <div class="card" style="padding:6px 14px">
        ${packed.map((it) => `<label class="check ${checked.has(it.id) ? 'done' : ''}">
          <input type="checkbox" data-check="${it.id}" ${checked.has(it.id) ? 'checked' : ''}>
          <img src="${it.photo}" alt=""><span>${esc(itemLabel(it))}</span></label>`).join('')}
        ${extrasList.map((x) => `<label class="check ${checked.has(x) ? 'done' : ''}">
          <input type="checkbox" data-check="${esc(x)}" ${checked.has(x) ? 'checked' : ''}><span>${esc(x)}</span></label>`).join('')}
      </div>

      <div class="section-title">Outfits pro Tag</div>
      <div class="card">
        ${trip.plan.map((p, i) => {
          const d = trip.days[i];
          const [icon] = weather.describeCode(d.code ?? 1);
          return `<div class="trip-day">
            <div class="row between" style="margin-bottom:8px">
              <strong>${fmtDate(p.date)}</strong>
              <span class="small muted">${icon} ${d.tmax}°/${d.tmin}°${d.rain ? ' · 🌧️' : ''}</span>
            </div>
            <div class="chips" style="margin-bottom:8px">${trip.occasions.length > 1 ? trip.occasions.map((o) =>
              `<button class="chip ${p.occasion === o ? 'on' : ''}" data-dayocc="${i}:${o}">${OCCASIONS[o]}</button>`).join('') :
              `<span class="reason">${OCCASIONS[p.occasion]}</span>`}</div>
            <div class="outfit">${p.ids.length ? piecesHtml(outfitOf(p.ids)) : '<p class="muted small">Kein passendes Outfit gefunden.</p>'}</div>
          </div>`;
        }).join('')}
      </div>
      ${trip.extras?.length ? `<div class="section-title">Zusätzlich eingepackt für</div>
        <div class="card">${trip.extras.map((x) => `<div class="trip-day"><strong>${OCCASIONS[x.occasion]}</strong>
          <div class="outfit" style="margin-top:8px">${piecesHtml(outfitOf(x.ids))}</div></div>`).join('')}</div>` : ''}

      <button class="btn block" data-trip-act="replan">🔄 Neu planen (mit aktuellem Schrank)</button>
      <button class="btn danger block" data-trip-act="delete">Reise löschen</button>
    </div>`);

  const body = $('.sheet-body', sheet);
  body.onchange = async (e) => {
    const key = e.target.dataset.check;
    if (key === undefined) return;
    e.target.checked ? checked.add(key) : checked.delete(key);
    trip.checked = [...checked];
    await db.put('trips', trip);
    e.target.closest('.check').classList.toggle('done', e.target.checked);
    const n = [...checked].filter((k) => packed.some((p) => p.id === k) || extrasList.includes(k)).length;
    body.querySelector('.section-title').textContent = `Packliste · ${n}/${total}`;
  };
  body.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.dayocc) {
      const [i, occ] = b.dataset.dayocc.split(':');
      trip.days[+i].occasion = occ;
      applyPlan(trip);
      await db.put('trips', trip);
      openTrip(trip.id);
    } else if (b.dataset.tripAct === 'replan') {
      applyPlan(trip);
      await db.put('trips', trip);
      toast('Neu geplant');
      openTrip(trip.id);
    } else if (b.dataset.tripAct === 'delete') {
      if (!confirm('Reise löschen?')) return;
      await db.del('trips', trip.id);
      state.trips = state.trips.filter((t) => t.id !== trip.id);
      closeSheet();
      renderTrips();
    } else if (b.dataset.item) {
      closeSheet();
      openItemEditor(byId.get(b.dataset.item));
    }
  };
}

// ---------- MEHR ----------
function renderMore() {
  const worn = [...state.items].sort((a, b) => (b.wearCount || 0) - (a.wearCount || 0));
  const never = state.items.filter((i) => !i.wearCount);
  const thumbs = (arr) => arr.map((it) => `<button class="thumb" data-item="${it.id}" style="width:64px;flex:none"><img src="${it.photo}" alt=""></button>`).join('');
  view.innerHTML = `
    <div class="card row" style="justify-content:space-around;text-align:center">
      <div><div class="stat">${state.items.length}</div><div class="small muted">Teile</div></div>
      <div><div class="stat">${state.wears.length}</div><div class="small muted">Tage getragen</div></div>
      <div><div class="stat">${state.trips.length}</div><div class="small muted">Reisen</div></div>
    </div>
    ${worn.some((i) => i.wearCount) ? `<div class="section-title">Am häufigsten getragen</div>
      <div class="row" style="overflow-x:auto;gap:8px">${thumbs(worn.filter((i) => i.wearCount).slice(0, 8))}</div>` : ''}
    ${never.length && state.wears.length ? `<div class="section-title">Noch nie getragen (${never.length})</div>
      <div class="row" style="overflow-x:auto;gap:8px">${thumbs(never.slice(0, 12))}</div>` : ''}

    <div class="section-title">Einstellungen</div>
    <div class="card stack">
      <div class="row between"><div><strong>Standort für das Wetter</strong><div class="small muted">${esc(state.place?.label || 'Nicht festgelegt')}</div></div>
        <button class="btn" data-action="change-place">Ändern</button></div>
    </div>

    <div class="section-title">Daten</div>
    <div class="card stack">
      <p class="small muted" style="margin:0">Alle Fotos und Daten werden nur auf diesem Gerät gespeichert. Erstelle ab und zu eine Sicherung, um sie auf ein anderes Gerät zu übertragen.</p>
      <button class="btn block" data-action="export">⬇️ Sicherung exportieren</button>
      <button class="btn block" data-action="import">⬆️ Sicherung importieren</button>
      <button class="btn danger block" data-action="reset">Alle Daten löschen</button>
    </div>

    <div class="section-title">Als App installieren</div>
    <div class="card small muted">
      <p style="margin-top:0"><strong>iPhone:</strong> In Safari auf „Teilen" → „Zum Home-Bildschirm".</p>
      <p style="margin-bottom:0"><strong>Android:</strong> In Chrome auf „⋮" → „App installieren".</p>
    </div>`;
}

async function exportData() {
  const data = await db.exportAll();
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kleiderschrank-${todayIso()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- Sheet ----------
function openSheet(title, bodyHtml) {
  sheet.innerHTML = `
    <div class="sheet-head"><h2 style="font-size:1.2rem">${esc(title)}</h2>
      <button class="icon-btn" data-close aria-label="Schließen">✕</button></div>
    <div class="sheet-body">${bodyHtml}</div>`;
  if (!sheet.open) sheet.showModal();
  $('.sheet-body', sheet).scrollTop = 0;
}
function closeSheet() { if (sheet.open) sheet.close(); }
sheet.addEventListener('click', (e) => {
  if (e.target === sheet || e.target.closest('[data-close]')) { state.addQueue = []; closeSheet(); }
});
sheet.addEventListener('click', (e) => {
  const a = e.target.closest('[data-action]');
  if (a) handleAction(a.dataset.action);
});

// ---------- Globale Aktionen ----------
async function handleAction(action) {
  switch (action) {
    case 'add': openAddChooser(); break;
    case 'camera': closeSheet(); pickFile($('#camInput'), handleFiles); break;
    case 'gallery': closeSheet(); pickFile($('#galleryInput'), handleFiles); break;
    case 'reshuffle':
      state.current++;
      if (state.current >= state.suggestions.length) computeSuggestions(false);
      renderToday();
      break;
    case 'reshuffle-reset': computeSuggestions(true); renderToday(); break;
    case 'wear': wearCurrent(); break;
    case 'change-place':
      openPlacePicker(async (p) => {
        state.place = p;
        await db.setSetting('place', p);
        state.weatherToday = null;
        await loadWeather();
        computeSuggestions(true);
        render();
      });
      break;
    case 'new-trip': openTripForm(); break;
    case 'export': exportData(); break;
    case 'import':
      pickFile($('#importInput'), async ([file]) => {
        try {
          await db.importAll(JSON.parse(await file.text()));
          await loadData();
          state.suggestions = [];
          toast('Sicherung importiert ✓');
          render();
        } catch (e) { toast(e.message); }
      });
      break;
    case 'reset':
      if (!confirm('Wirklich ALLE Kleidungsstücke, Reisen und den Verlauf löschen?')) return;
      for (const s of ['items', 'wears', 'trips']) await db.clear(s);
      await loadData();
      state.suggestions = [];
      toast('Alles gelöscht');
      render();
      break;
  }
}

view.addEventListener('click', (e) => {
  const a = e.target.closest('[data-action]');
  if (a) return handleAction(a.dataset.action);
  const occ = e.target.closest('[data-occ]');
  if (occ) {
    state.occasion = occ.dataset.occ;
    db.setSetting('occasion', state.occasion);
    computeSuggestions(true);
    return renderToday();
  }
  const sw = e.target.closest('[data-swap]');
  if (sw) return swapPiece(sw.dataset.swap);
  const f = e.target.closest('[data-filter]');
  if (f) { state.filter = f.dataset.filter; return renderCloset(); }
  const it = e.target.closest('[data-item]');
  if (it) return openItemEditor(state.items.find((i) => i.id === it.dataset.item));
  const tr = e.target.closest('[data-trip]');
  if (tr) return openTrip(tr.dataset.trip);
});

// ---------- Start ----------
(async function init() {
  await loadData();
  render();
  await loadWeather();
  computeSuggestions(true);
  if (state.tab === 'heute') renderToday();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
