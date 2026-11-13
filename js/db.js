// Kleine IndexedDB-Hülle: alle Daten bleiben lokal auf dem Gerät.
const DB_NAME = 'kleiderschrank';
const DB_VERSION = 1;
const STORES = ['items', 'wears', 'trips', 'settings'];

let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const result = fn(s);
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
    t.onerror = () => reject(t.error);
  });
}

export const db = {
  all: (store) => tx(store, 'readonly', (s) => s.getAll()),
  get: (store, id) => tx(store, 'readonly', (s) => s.get(id)),
  put: (store, value) => tx(store, 'readwrite', (s) => s.put(value)),
  del: (store, id) => tx(store, 'readwrite', (s) => s.delete(id)),
  clear: (store) => tx(store, 'readwrite', (s) => s.clear()),

  async getSetting(key, fallback = null) {
    const row = await this.get('settings', key);
    return row ? row.value : fallback;
  },
  setSetting(key, value) {
    return this.put('settings', { id: key, value });
  },

  async exportAll() {
    const out = { app: 'kleiderschrank', version: 1, exportedAt: new Date().toISOString() };
    for (const s of STORES) out[s] = await this.all(s);
    return out;
  },
  async importAll(data) {
    if (!data || data.app !== 'kleiderschrank') throw new Error('Keine gültige Sicherungsdatei');
    for (const s of STORES) {
      if (!Array.isArray(data[s])) continue;
      await this.clear(s);
      for (const row of data[s]) await this.put(s, row);
    }
  },
};

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
