// Tiny promise wrapper around IndexedDB, with a localStorage fallback for
// browsers/modes where IndexedDB is unavailable (e.g. some private windows).

const DB_NAME = 'supersplit';
const DB_VERSION = 1;
export const STORES = ['groups', 'expenses', 'payments', 'settings'];

let dbPromise = null;
let fallback = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('groups')) {
        db.createObjectStore('groups', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('expenses')) {
        const s = db.createObjectStore('expenses', { keyPath: 'id' });
        s.createIndex('groupId', 'groupId', { unique: false });
      }
      if (!db.objectStoreNames.contains('payments')) {
        const s = db.createObjectStore('payments', { keyPath: 'id' });
        s.createIndex('groupId', 'groupId', { unique: false });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
  return dbPromise;
}

// ---------------------------------------------------------------- fallback

function makeFallback() {
  const KEY = 'supersplit:fallback';
  let data;
  try {
    data = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    data = null;
  }
  if (!data) data = {};
  for (const s of STORES) if (!data[s]) data[s] = {};
  const flush = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      /* storage full or blocked, so keep going in memory */
    }
  };
  return {
    async getAll(store) {
      return Object.values(data[store] || {});
    },
    async get(store, key) {
      return (data[store] || {})[key] ?? null;
    },
    async put(store, value, key) {
      const id = store === 'settings' ? value.key : value.id;
      data[store][key ?? id] = value;
      flush();
      return value;
    },
    async del(store, key) {
      delete data[store][key];
      flush();
    },
    async putMany(store, values) {
      for (const v of values) await this.put(store, v);
    },
    async delMany(store, keys) {
      for (const k of keys) delete data[store][k];
      flush();
    },
    async clearAll() {
      for (const s of STORES) data[s] = {};
      flush();
    },
  };
}

// ------------------------------------------------------------------ public

/** Resolves once storage is usable; picks the fallback if IndexedDB fails. */
export async function ready() {
  if (fallback) return { mode: 'localStorage' };
  try {
    await openDb();
    return { mode: 'indexeddb' };
  } catch (err) {
    console.warn('IndexedDB unavailable, falling back to localStorage:', err);
    fallback = makeFallback();
    return { mode: 'localStorage' };
  }
}

function tx(storeNames, mode) {
  return openDb().then((db) => db.transaction(storeNames, mode));
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function getAll(store) {
  if (fallback) return fallback.getAll(store);
  const t = await tx(store, 'readonly');
  return wrap(t.objectStore(store).getAll());
}

export async function get(store, key) {
  if (fallback) return fallback.get(store, key);
  const t = await tx(store, 'readonly');
  return wrap(t.objectStore(store).get(key));
}

export async function put(store, value) {
  if (fallback) return fallback.put(store, value);
  const t = await tx(store, 'readwrite');
  t.objectStore(store).put(value);
  await done(t);
  return value;
}

export async function putMany(store, values) {
  if (!values.length) return;
  if (fallback) return fallback.putMany(store, values);
  const t = await tx(store, 'readwrite');
  const os = t.objectStore(store);
  for (const v of values) os.put(v);
  await done(t);
}

export async function del(store, key) {
  if (fallback) return fallback.del(store, key);
  const t = await tx(store, 'readwrite');
  t.objectStore(store).delete(key);
  await done(t);
}

export async function delMany(store, keys) {
  if (!keys.length) return;
  if (fallback) return fallback.delMany(store, keys);
  const t = await tx(store, 'readwrite');
  const os = t.objectStore(store);
  for (const k of keys) os.delete(k);
  await done(t);
}

/** Wipe everything (used by "reset app" and by data import). */
export async function clearAll() {
  if (fallback) return fallback.clearAll();
  const t = await tx(STORES, 'readwrite');
  for (const s of STORES) t.objectStore(s).clear();
  await done(t);
}

/** Ask the browser to keep our data around when storage pressure hits. */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      return await navigator.storage.persist();
    }
  } catch {
    /* not fatal */
  }
  return false;
}
