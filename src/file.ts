// Opens the CSV once, remembers the handle across reloads, writes back in place.
const DB = "offline-checkin";
const STORE = "handles";

function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const store = (await db()).transaction(STORE, mode).objectStore(STORE);
  return new Promise((res, rej) => {
    const req = op(store);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export const supported = typeof window.showOpenFilePicker === "function";

export async function pickCsv(): Promise<FileSystemFileHandle> {
  const [handle] = await window.showOpenFilePicker({
    types: [{ description: "CSV", accept: { "text/csv": [".csv"] } }],
    multiple: false,
  });
  await idb("readwrite", (s) => s.put(handle, "csv"));
  return handle;
}

export const savedHandle = () => idb<FileSystemFileHandle | undefined>("readonly", (s) => s.get("csv"));
export const forgetHandle = () => idb("readwrite", (s) => s.delete("csv"));

export async function hasPermission(h: FileSystemFileHandle, ask: boolean) {
  const opts = { mode: "readwrite" as const };
  if ((await h.queryPermission(opts)) === "granted") return true;
  return ask && (await h.requestPermission(opts)) === "granted";
}

export const readText = async (h: FileSystemFileHandle) => (await h.getFile()).text();

let chain = Promise.resolve();
export function writeText(h: FileSystemFileHandle, text: string): Promise<void> {
  chain = chain.then(async () => {
    const w = await h.createWritable();
    await w.write(text);
    await w.close();
  });
  return chain;
}
