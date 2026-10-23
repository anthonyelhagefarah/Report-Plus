// Almacenamiento local (IndexedDB). Todo queda en el teléfono, sin servidor.
const DB = (() => {
  const NAME = 'reportplus';
  const VERSION = 1;
  let dbp;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('settings');
        db.createObjectStore('clients', { keyPath: 'id' });
        db.createObjectStore('reports', { keyPath: 'id' }).createIndex('clientId', 'clientId');
        db.createObjectStore('items', { keyPath: 'id' }).createIndex('reportId', 'reportId');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let result;
      Promise.resolve(fn(s)).then(r => { result = r; });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
    });
  }

  const wrap = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

  return {
    uid: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    get: (store, key) => tx(store, 'readonly', s => wrap(s.get(key))),
    all: (store) => tx(store, 'readonly', s => wrap(s.getAll())),
    byIndex: (store, index, value) => tx(store, 'readonly', s => wrap(s.index(index).getAll(value))),
    put: (store, value, key) => tx(store, 'readwrite', s => wrap(key === undefined ? s.put(value) : s.put(value, key))),
    del: (store, key) => tx(store, 'readwrite', s => wrap(s.delete(key))),
    async getSettings() {
      return (await this.get('settings', 'company')) || { name: '', contact: '', email: '', phone: '', logo: null };
    },
    saveSettings(v) { return this.put('settings', v, 'company'); },
    async deleteReport(id) {
      for (const it of await this.byIndex('items', 'reportId', id)) await this.del('items', it.id);
      await this.del('reports', id);
    },
    async deleteClient(id) {
      for (const r of await this.byIndex('reports', 'clientId', id)) await this.deleteReport(r.id);
      await this.del('clients', id);
    },
  };
})();
