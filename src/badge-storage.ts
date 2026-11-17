import { BADGE_FONTS, normalizeLayout, type PaperLayout } from "./paper-layout";
import { loadSettings } from "./settings";

const TEMPLATES_KEY = "offline-checkin.badge-layouts";
export type SavedLayout = { id: string; name: string; layout: PaperLayout };

export function readLayouts(): SavedLayout[] {
  const value: unknown = JSON.parse(localStorage.getItem(TEMPLATES_KEY) ?? "[]");
  if (!Array.isArray(value)) throw new Error("Saved badge layouts cannot be read.");
  return value.filter((v) => v && typeof v.id === "string" && typeof v.name === "string")
    .slice(0, 50).map((v) => ({ id: v.id, name: v.name, layout: normalizeLayout(v.layout) }));
}

export async function changeLayouts(change: (items: SavedLayout[]) => SavedLayout[]): Promise<SavedLayout[]> {
  return navigator.locks.request(TEMPLATES_KEY, () => {
    const items = change(readLayouts());
    if (items.length > 50) throw new Error("You can save a maximum of 50 layouts.");
    const names = items.map((item) => item.name.trim().toLocaleLowerCase());
    if (names.some((name) => !name) || new Set(names).size !== names.length) {
      throw new Error("Use a different name for each layout.");
    }
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(items));
    return items;
  });
}

function guideDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("offline-checkin.badge-guides", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("guides");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function guideRequest<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await guideDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("guides", mode);
    const request = action(tx.objectStore("guides"));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? new Error("The guide photo could not be saved.")); };
  });
}

export const readGuide = (id: string) => guideRequest<Blob | undefined>("readonly", (store) => store.get(id));

export async function saveGuide(file: File): Promise<string> {
  if (file.size > 5 * 1024 * 1024) throw new Error("Use a photo of 5 MB or less.");
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const jpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => header[i] === v);
  const webp = String.fromCharCode(...header.slice(0, 4)) === "RIFF" && String.fromCharCode(...header.slice(8, 12)) === "WEBP";
  if (!jpeg && !png && !webp) throw new Error("Use a JPEG, PNG, or WebP photo.");
  const image = await createImageBitmap(file);
  try {
    if (image.width * image.height > 20_000_000) throw new Error("Use a photo of 20 megapixels or less.");
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("The guide photo could not be opened.");
    ctx.drawImage(image, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (result) => result ? resolve(result) : reject(new Error("The guide photo could not be saved.")), "image/webp", 0.85));
    const id = crypto.randomUUID();
    await guideRequest("readwrite", (store) => store.put(blob, id));
    return id;
  } finally {
    image.close();
  }
}

// Retain photos used by the current setup or a saved layout.
export async function cleanGuides(candidates: (string | undefined)[]): Promise<void> {
  for (const key of new Set(candidates)) {
    if (!key) continue;
    const used = new Set([loadSettings().paperLayout.guideId, ...readLayouts().map((item) => item.layout.guideId)]);
    if (!used.has(key)) await guideRequest("readwrite", (store) => store.delete(key));
  }
}

export function importLayout(text: string): PaperLayout {
  const value = JSON.parse(text);
  if (!value || value.version !== 1 || !value.layout) throw new Error("Use an exported badge layout JSON file.");
  const raw = value.layout;
  for (const size of [raw.widthMm, raw.heightMm]) {
    if (typeof size !== "number" || !Number.isFinite(size) || size < 50 || size > 297) {
      throw new Error("Paper width and height must be from 50 to 297 mm.");
    }
  }
  for (const field of ["name", "country"] as const) {
    const box = raw[field];
    if (!box || !BADGE_FONTS.includes(box.font)) throw new Error("The layout has an unsupported font.");
    if (![box.x, box.y, box.width, box.fontSize, box.minFontSize].every((v) => typeof v === "number" && Number.isFinite(v))) {
      throw new Error("The layout has an invalid text box.");
    }
  }
  const layout = normalizeLayout(raw);
  delete layout.guideId;
  return layout;
}

export function exportLayout(layout: PaperLayout): void {
  const printLayout = normalizeLayout(layout);
  delete printLayout.guideId;
  const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, layout: printLayout }, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "badge-layout.json";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
