// Printer settings, persisted so a reload keeps the operator's setup.
import { defaultPaperLayout, normalizeLayout, type PaperLayout } from "./paper-layout";

export type Engine = "tspl" | "escpos" | "paper";

export type Settings = {
  engine: Engine;
  widthMm: number;
  heightMm: number;
  gapMm: number;
  density: number; // TSPL DENSITY 0~15
  speed: number; // TSPL SPEED, inches/sec
  qrCell: number; // TSPL QRCODE cell width 1~10
  copies: number;
  paperLayout: PaperLayout;
};

export const DEFAULTS: Settings = {
  engine: "tspl",
  widthMm: 50,
  heightMm: 35,
  gapMm: 2,
  density: 10,
  speed: 4,
  qrCell: 5,
  copies: 1,
  paperLayout: defaultPaperLayout(),
};

// Label presets from the benchmark app (qr.rnrizki.my.id).
export const PRESETS: { label: string; widthMm: number; heightMm: number }[] = [
  { label: "50 × 35 mm", widthMm: 50, heightMm: 35 },
  { label: "50 × 40 mm", widthMm: 50, heightMm: 40 },
  { label: "60 × 40 mm", widthMm: 60, heightMm: 40 },
  { label: "70 × 50 mm", widthMm: 70, heightMm: 50 },
  { label: "80 × 50 mm", widthMm: 80, heightMm: 50 },
  { label: "100 × 50 mm", widthMm: 100, heightMm: 50 },
  { label: "100 × 70 mm", widthMm: 100, heightMm: 70 },
  { label: "100 × 100 mm", widthMm: 100, heightMm: 100 },
  { label: "100 × 150 mm", widthMm: 100, heightMm: 150 },
];

export const SETTINGS_KEY = "offline-checkin.printer";

const num = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

export function loadSettings(): Settings {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    const raw = (parsed && typeof parsed === "object" ? parsed : {}) as Partial<Settings>;
    return {
      engine: raw.engine === "escpos" || raw.engine === "paper" ? raw.engine : DEFAULTS.engine,
      widthMm: num(raw.widthMm, DEFAULTS.widthMm, 10, 120),
      heightMm: num(raw.heightMm, DEFAULTS.heightMm, 10, 300),
      gapMm: num(raw.gapMm, DEFAULTS.gapMm, 0, 10),
      density: num(raw.density, DEFAULTS.density, 0, 15),
      speed: num(raw.speed, DEFAULTS.speed, 1, 12),
      qrCell: num(raw.qrCell, DEFAULTS.qrCell, 1, 10),
      copies: num(raw.copies, DEFAULTS.copies, 1, 9),
      paperLayout: normalizeLayout(raw.paperLayout),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
