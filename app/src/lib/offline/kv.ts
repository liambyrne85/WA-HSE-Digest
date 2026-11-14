// Tiny IndexedDB key/value store (photos make localStorage too small). Falls back to memory.
const DB_NAME = 'fieldops-offline';
const STORE = 'kv';
let dbp: Promise<IDBDatabase> | null = null;
const memory = new Map<string, unknown>();

function open(): Promise<IDBDatabase> | null {
  if (typeof indexedDB === 'undefined') return null;
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()!;
  return new Promise<T>((res, rej) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  try { if (open()) return (await tx('readonly', (s) => s.get(key))) as T | undefined; } catch { /* fall through */ }
  return memory.get(key) as T | undefined;
}
export async function kvSet(key: string, value: unknown) {
  try { if (open()) { await tx('readwrite', (s) => s.put(value, key)); return; } } catch { /* fall through */ }
  memory.set(key, value);
}
export async function kvDel(key: string) {
  try { if (open()) { await tx('readwrite', (s) => s.delete(key)); return; } } catch { /* fall through */ }
  memory.delete(key);
}
export async function kvKeys(prefix: string): Promise<string[]> {
  try {
    if (open()) return ((await tx('readonly', (s) => s.getAllKeys())) as IDBValidKey[]).map(String).filter((k) => k.startsWith(prefix));
  } catch { /* fall through */ }
  return [...memory.keys()].filter((k) => k.startsWith(prefix));
}
