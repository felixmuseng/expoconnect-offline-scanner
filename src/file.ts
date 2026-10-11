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

const isStaleStateError = (e: unknown) =>
  e instanceof DOMException &&
  /state cached in an interface object|state had changed since it was read from disk/i.test(e.message);

const staleStateMessage =
  "The CSV changed on disk after this app opened it. Close other apps that edit this file, then close and open the CSV again.";

type WritableOptions = FileSystemCreateWritableOptions & { mode?: "exclusive" | "siloed" };

const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));

async function staleRetry<T>(op: () => Promise<T>): Promise<T> {
  let stale = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await op();
    } catch (e) {
      if (!isStaleStateError(e)) throw e;
      stale = true;
      await wait(50 * (attempt + 1));
    }
  }
  if (stale) throw new Error(staleStateMessage);
  throw new Error("The CSV could not be read or saved.");
}

const readFresh = async (h: FileSystemFileHandle) => (await h.getFile()).text();

export const readText = async (h: FileSystemFileHandle) => staleRetry(() => readFresh(h));

async function writeFresh(h: FileSystemFileHandle, text: string): Promise<void> {
  const w = await h.createWritable({ keepExistingData: false, mode: "exclusive" } as WritableOptions);
  try {
    await w.write(text);
    await w.close();
  } catch (e) {
    try {
      await w.abort();
    } catch {
      // The writer can already be closed after a failed close call.
    }
    throw e;
  }
}

let chain = Promise.resolve();
export function writeText(h: FileSystemFileHandle, text: string): Promise<void> {
  const run = chain.catch(() => undefined).then(() => staleRetry(() => writeFresh(h, text)));
  chain = run;
  return run;
}

export function updateText<T>(h: FileSystemFileHandle, update: (text: string) => Promise<{ text: string; value: T }>): Promise<T> {
  const run = chain
    .catch(() => undefined)
    .then(() =>
      staleRetry(async () => {
        const current = await readFresh(h);
        const next = await update(current);
        await writeFresh(h, next.text);
        return next.value;
      })
    );
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}
