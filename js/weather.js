// Wetter über Open-Meteo (kostenlos, kein API-Schlüssel nötig).

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const GEO = 'https://geocoding-api.open-meteo.com/v1/search';

const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);

export function describeCode(code) {
  if (code === 0) return ['☀️', 'Sonnig'];
  if (code <= 2) return ['🌤️', 'Leicht bewölkt'];
  if (code === 3) return ['☁️', 'Bewölkt'];
  if (code <= 48) return ['🌫️', 'Nebel'];
  if (SNOW_CODES.has(code)) return ['🌨️', 'Schnee'];
  if (code >= 95) return ['⛈️', 'Gewitter'];
  if (RAIN_CODES.has(code)) return ['🌧️', 'Regen'];
  return ['🌥️', 'Wechselhaft'];
}

export async function searchPlace(name) {
  const url = `${GEO}?name=${encodeURIComponent(name)}&count=6&language=de&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Ortssuche fehlgeschlagen');
  const data = await res.json();
  return (data.results || []).map((r) => ({
    name: r.name,
    label: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
    lat: r.latitude,
    lon: r.longitude,
  }));
}

export function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Standort nicht verfügbar'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, label: 'Aktueller Standort' }),
      () => reject(new Error('Standortzugriff verweigert')),
      { timeout: 8000, maximumAge: 30 * 60 * 1000 },
    );
  });
}

const iso = (d) => d.toISOString().slice(0, 10);

function rows(daily, rainFn) {
  return daily.time.map((date, i) => ({
    date,
    tmax: Math.round(daily.temperature_2m_max[i]),
    tmin: Math.round(daily.temperature_2m_min[i]),
    code: daily.weather_code?.[i] ?? null,
    rain: rainFn(i),
  }));
}

async function forecast(place, start, end) {
  const url = `${FORECAST}?latitude=${place.lat}&longitude=${place.lon}` +
    '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code' +
    `&timezone=auto&start_date=${start}&end_date=${end}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Wetter konnte nicht geladen werden');
  const { daily } = await res.json();
  return rows(daily, (i) =>
    (daily.precipitation_probability_max[i] ?? 0) >= 50 || RAIN_CODES.has(daily.weather_code[i]));
}

// Für Termine außerhalb der 16-Tage-Vorhersage: Werte vom gleichen Zeitraum im Vorjahr.
async function lastYear(place, start, end) {
  const shift = (s) => { const d = new Date(s); d.setFullYear(d.getFullYear() - 1); return iso(d); };
  const url = `${ARCHIVE}?latitude=${place.lat}&longitude=${place.lon}` +
    '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code' +
    `&timezone=auto&start_date=${shift(start)}&end_date=${shift(end)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Klimadaten konnten nicht geladen werden');
  const { daily } = await res.json();
  const out = rows(daily, (i) => (daily.precipitation_sum[i] ?? 0) >= 2);
  const s = new Date(start);
  return out.map((r, i) => {
    const d = new Date(s); d.setDate(s.getDate() + i);
    return { ...r, date: iso(d), estimated: true };
  });
}

export async function today(place) {
  const d = iso(new Date());
  const [w] = await forecast(place, d, d);
  return w;
}

/** Wetter für einen Zeitraum – Vorhersage wenn möglich, sonst Vorjahreswerte. */
export async function range(place, start, end) {
  const limit = new Date(); limit.setDate(limit.getDate() + 15);
  const out = [];
  const fcEnd = new Date(end) <= limit ? end : iso(limit);
  if (new Date(start) <= limit) out.push(...await forecast(place, start, fcEnd));
  if (new Date(end) > limit) {
    const s = new Date(start) > limit ? start : (() => { const d = new Date(fcEnd); d.setDate(d.getDate() + 1); return iso(d); })();
    out.push(...await lastYear(place, s, end));
  }
  return out;
}
