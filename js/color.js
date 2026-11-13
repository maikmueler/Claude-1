// Bildverarbeitung: Foto verkleinern und Hauptfarbe des Kleidungsstücks schätzen.

export const COLORS = {
  schwarz: { label: 'Schwarz', hex: '#1d1d1f', neutral: true },
  weiss: { label: 'Weiß', hex: '#f5f5f2', neutral: true },
  grau: { label: 'Grau', hex: '#8e8e93', neutral: true },
  beige: { label: 'Beige', hex: '#d8c3a0', neutral: true },
  braun: { label: 'Braun', hex: '#7a5232', neutral: true },
  navy: { label: 'Dunkelblau', hex: '#1f2f5c', neutral: true },
  jeans: { label: 'Jeansblau', hex: '#4a6a96', neutral: true },
  blau: { label: 'Blau', hex: '#2f6fe0', hue: 220 },
  hellblau: { label: 'Hellblau', hex: '#9cc3ef', hue: 210 },
  gruen: { label: 'Grün', hex: '#3a8f4d', hue: 130 },
  oliv: { label: 'Oliv', hex: '#6b6b35', hue: 65, neutral: true },
  gelb: { label: 'Gelb', hex: '#f0c419', hue: 50 },
  orange: { label: 'Orange', hex: '#ef7d22', hue: 28 },
  rot: { label: 'Rot', hex: '#d0312d', hue: 0 },
  bordeaux: { label: 'Bordeaux', hex: '#6d1a2b', hue: 345 },
  pink: { label: 'Rosa/Pink', hex: '#ee8fb4', hue: 330 },
  lila: { label: 'Lila', hex: '#7d4fb0', hue: 275 },
  bunt: { label: 'Gemustert/Bunt', hex: 'conic-gradient(#d0312d,#f0c419,#3a8f4d,#2f6fe0,#7d4fb0,#d0312d)', pattern: true },
};

export function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild konnte nicht geladen werden')); };
    img.src = url;
  });
}

// Verkleinert das Foto auf max. `max` Pixel und gibt eine JPEG-Data-URL zurück.
export function resizeImage(img, max = 720, quality = 0.8) {
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/jpeg', quality);
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

// Ordnet eine RGB-Farbe einem der benannten Farbtöne zu.
export function nameColor(r, g, b) {
  const [h, s, l] = rgbToHsl(r, g, b);
  if (l < 0.16) return 'schwarz';
  if (l > 0.88 && s < 0.5) return 'weiss';
  if (s < 0.12) return l > 0.7 ? 'weiss' : 'grau';
  if (h >= 200 && h < 245 && s < 0.45 && l < 0.6) return l < 0.32 ? 'navy' : 'jeans';
  if (h >= 200 && h < 250 && l < 0.3) return 'navy';
  if (h >= 20 && h < 50 && s < 0.55 && l > 0.6) return 'beige';
  if (h >= 10 && h < 45 && l < 0.45) return 'braun';
  if (h >= 45 && h < 80 && s < 0.5 && l < 0.45) return 'oliv';
  if (h < 12 || h >= 345) {
    if (l < 0.32) return 'bordeaux';
    return l > 0.7 ? 'pink' : 'rot';
  }
  if (h < 40) return 'orange';
  if (h < 68) return 'gelb';
  if (h < 170) return 'gruen';
  if (h < 200) return l > 0.6 ? 'hellblau' : 'blau';
  if (h < 255) return l > 0.65 ? 'hellblau' : 'blau';
  if (h < 300) return 'lila';
  return l < 0.3 ? 'bordeaux' : 'pink';
}

// Schätzt die Hauptfarbe: Hintergrund (aus den Bildrändern) wird herausgefiltert,
// dann gewinnt die häufigste Farbe im Bildzentrum.
export function detectColor(img) {
  const N = 64;
  const c = document.createElement('canvas');
  c.width = N; c.height = N;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, N, N);
  const { data } = ctx.getImageData(0, 0, N, N);
  const px = (x, y) => { const i = (y * N + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };

  // Hintergrundfarbe = Mittelwert der Randpixel
  let br = 0, bg = 0, bb = 0, n = 0;
  for (let i = 0; i < N; i++) {
    for (const [x, y] of [[i, 0], [i, N - 1], [0, i], [N - 1, i]]) {
      const [r, g, b] = px(x, y); br += r; bg += g; bb += b; n++;
    }
  }
  br /= n; bg /= n; bb /= n;

  const counts = {};
  const m = Math.floor(N * 0.2);
  for (let y = m; y < N - m; y++) {
    for (let x = m; x < N - m; x++) {
      const [r, g, b] = px(x, y);
      const dist = Math.hypot(r - br, g - bg, b - bb);
      const weight = dist < 40 ? 0.15 : 1; // vermutlich Hintergrund
      const name = nameColor(r, g, b);
      counts[name] = (counts[name] || 0) + weight;
    }
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, [, v]) => s + v, 0);
  const [first, second] = sorted;
  // Keine eindeutige Farbe und viele bunte Töne → gemustert
  const chromatic = sorted.filter(([k]) => !COLORS[k].neutral).length;
  if (first[1] / total < 0.35 && chromatic >= 3 && second && !COLORS[second[0]].neutral) return 'bunt';
  return first[0];
}
