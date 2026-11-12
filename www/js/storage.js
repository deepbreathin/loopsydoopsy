// IndexedDB: projects (each a full workspace: settings, pads, song) and recorded takes.
// The open project is saved continuously; `meta.current` remembers which one it is.
const DB = 'loopsydoopsy';
let dbp;

function db() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = (e) => {
      const d = req.result;
      if (e.oldVersion < 1) {
        d.createObjectStore('board');
        d.createObjectStore('takes', { keyPath: 'id' });
      }
      if (e.oldVersion < 2) {
        d.createObjectStore('projects', { keyPath: 'id' });
        d.createObjectStore('meta');
        // Bring the single board from version 1 across as the first project.
        const tx = req.transaction;
        const get = tx.objectStore('board').get('current');
        get.onsuccess = () => {
          if (!get.result) return;
          const id = Date.now();
          tx.objectStore('projects').put({ id, name: 'My first loops', updated: id, ...get.result });
          tx.objectStore('meta').put(id, 'current');
        };
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function run(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const saveProject = (p) => run('projects', 'readwrite', (s) => s.put(p));
export const loadProject = (id) => run('projects', 'readonly', (s) => s.get(id));
export const deleteProject = (id) => run('projects', 'readwrite', (s) => s.delete(id));
export const getCurrentId = () => run('meta', 'readonly', (s) => s.get('current'));
export const setCurrentId = (id) => run('meta', 'readwrite', (s) => s.put(id, 'current'));

// Name, date and pad count of each project, newest first (audio isn't kept in memory).
export async function listProjects() {
  const d = await db();
  return new Promise((resolve, reject) => {
    const out = [];
    const req = d.transaction('projects').objectStore('projects').openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve(out.sort((a, b) => b.updated - a.updated));
      const { id, name, updated, pads } = c.value;
      out.push({ id, name, updated, padCount: (pads || []).filter(Boolean).length });
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export const saveTake = (take) => run('takes', 'readwrite', (s) => s.put(take));
export const deleteTake = (id) => run('takes', 'readwrite', (s) => s.delete(id));
export const getTake = (id) => run('takes', 'readonly', (s) => s.get(id));
export const listTakes = () => run('takes', 'readonly', (s) => s.getAll());
