// Tiny IndexedDB wrapper: one store for the board (settings + pads), one for recorded takes.
const DB = 'loopsydoopsy';
let dbp;

function db() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('board');
      req.result.createObjectStore('takes', { keyPath: 'id' });
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

export const saveBoard = (board) => run('board', 'readwrite', (s) => s.put(board, 'current'));
export const loadBoard = () => run('board', 'readonly', (s) => s.get('current'));
export const saveTake = (take) => run('takes', 'readwrite', (s) => s.put(take));
export const deleteTake = (id) => run('takes', 'readwrite', (s) => s.delete(id));
export const listTakes = () => run('takes', 'readonly', (s) => s.getAll());
