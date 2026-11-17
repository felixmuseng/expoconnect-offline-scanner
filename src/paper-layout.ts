export const BADGE_FONTS = ["Inter", "Geist", "Manrope", "Roboto", "Lora", "Oswald"] as const;
export type BadgeFont = (typeof BADGE_FONTS)[number];
export type BadgeField = "name" | "country";
export type TextBox = {
  x: number;
  y: number;
  width: number;
  font: BadgeFont;
  fontSize: number;
  minFontSize: number;
  bold: boolean;
  align: "left" | "center" | "right";
  color: string;
};
export type PaperLayout = {
  widthMm: number;
  heightMm: number;
  name: TextBox;
  country: TextBox;
  guideId?: string;
  guideOpacity: number;
};

export const PAPER_PRESETS = [
  { label: "100 × 150 mm", widthMm: 100, heightMm: 150 },
  { label: "A6 (105 × 148 mm)", widthMm: 105, heightMm: 148 },
  { label: "A5 (148 × 210 mm)", widthMm: 148, heightMm: 210 },
  { label: "4 × 6 in", widthMm: 101.6, heightMm: 152.4 },
  { label: "CR80 card (54 × 85.6 mm)", widthMm: 54, heightMm: 85.6 },
];
export const PX_PER_MM = 96 / 25.4;
const MM_PER_PT = 25.4 / 72;
export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const number = (v: unknown, fallback: number, min: number, max: number) =>
  clamp(typeof v === "number" && Number.isFinite(v) ? v : fallback, min, max);
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

export function defaultPaperLayout(): PaperLayout {
  const box: TextBox = { x: 5, y: 55, width: 90, font: "Inter", fontSize: 18,
    minFontSize: 10, bold: false, align: "center", color: "#000000" };
  return { widthMm: 100, heightMm: 150, country: box,
    name: { ...box, y: 68, fontSize: 36, minFontSize: 12, bold: true }, guideOpacity: 0.6 };
}

// Each box reserves one line at its minimum size, with a 1 mm gap.
export const minimumHeight = (b: TextBox) => b.minFontSize * MM_PER_PT * 1.15;
export function normalizeLayout(value: unknown): PaperLayout {
  const raw = object(value);
  const fallback = defaultPaperLayout();
  const widthMm = number(raw.widthMm, fallback.widthMm, 50, 297);
  const heightMm = number(raw.heightMm, fallback.heightMm, 50, 297);
  const readBox = (field: BadgeField): TextBox => {
    const b = object(raw[field]);
    const d = fallback[field];
    const width = number(b.width, d.width, 10, widthMm);
    const minFontSize = number(b.minFontSize, d.minFontSize, 6, 48);
    return {
      x: number(b.x, d.x, 0, widthMm - width),
      y: number(b.y, d.y, 0, heightMm - minFontSize * MM_PER_PT * 1.15),
      width, minFontSize,
      fontSize: number(b.fontSize, d.fontSize, minFontSize, 120),
      font: BADGE_FONTS.includes(b.font as BadgeFont) ? b.font as BadgeFont : d.font,
      bold: typeof b.bold === "boolean" ? b.bold : d.bold,
      align: b.align === "left" || b.align === "right" ? b.align : "center",
      color: typeof b.color === "string" && /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : d.color,
    };
  };
  const result: PaperLayout = { widthMm, heightMm, name: readBox("name"), country: readBox("country"),
    guideOpacity: number(raw.guideOpacity, 0.6, 0, 1) };
  if (typeof raw.guideId === "string" && /^[\w-]{1,80}$/.test(raw.guideId)) result.guideId = raw.guideId;
  const [top, bottom] = result.name.y < result.country.y
    ? [result.name, result.country] : [result.country, result.name];
  if (top.x < bottom.x + bottom.width && bottom.x < top.x + top.width) {
    const requiredY = top.y + minimumHeight(top) + 1;
    if (bottom.y < requiredY) {
      bottom.y = Math.min(requiredY, heightMm - minimumHeight(bottom));
      top.y = Math.max(0, Math.min(top.y, bottom.y - minimumHeight(top) - 1));
    }
  }
  return result;
}

export function resizeLayout(layout: PaperLayout, widthMm: number, heightMm: number): PaperLayout {
  const scaleBox = (b: TextBox) => ({ ...b, x: b.x * widthMm / layout.widthMm,
    y: b.y * heightMm / layout.heightMm, width: b.width * widthMm / layout.widthMm });
  return normalizeLayout({ ...layout, widthMm, heightMm, name: scaleBox(layout.name), country: scaleBox(layout.country) });
}

export function boxHeight(layout: PaperLayout, field: BadgeField): number {
  const box = layout[field];
  const other = layout[field === "name" ? "country" : "name"];
  const overlapsX = box.x < other.x + other.width && other.x < box.x + box.width;
  const edge = overlapsX && other.y > box.y ? other.y - 1 : layout.heightMm;
  return Math.max(0, edge - box.y);
}

export function snapBox(layout: PaperLayout, field: BadgeField, box: TextBox): { box: TextBox; x?: number; y?: number } {
  const other = layout[field === "name" ? "country" : "name"];
  const result: { box: TextBox; x?: number; y?: number } = { box: { ...box } };
  for (const [guide, offset] of [[layout.widthMm / 2, box.width / 2], [other.x + other.width / 2, box.width / 2], [other.x, 0]]) {
    if (Math.abs(box.x + offset - guide) <= 1.5) {
      result.box.x = guide - offset;
      result.x = guide;
      break;
    }
  }
  for (const guide of [layout.heightMm / 2, other.y]) {
    if (Math.abs(box.y - guide) <= 1.5) {
      result.box.y = guide;
      result.y = guide;
      break;
    }
  }
  return result;
}

// The public path stays relative to the app, including a packaged folder.
export function badgeFontUrl(font: BadgeFont): string {
  return new URL(`fonts/${font}.ttf`, document.baseURI).href;
}

export const printFontCss = () => BADGE_FONTS.map((font) =>
  `@font-face{font-family:"${font}";src:url("${badgeFontUrl(font)}") format("truetype");font-style:normal;font-weight:100 900;font-display:block;}`
).join("\n");

export async function loadBadgeFonts(doc: Document, layout: PaperLayout, texts: Record<BadgeField, string>) {
  for (const field of ["name", "country"] as const) {
    const b = layout[field];
    const faces = await doc.fonts.load(`${b.bold ? 700 : 400} ${b.fontSize}pt "${b.font}"`, texts[field] || "Badge");
    if (!faces.length) throw new Error(`The ${b.font} badge font is not available. Reload the app.`);
  }
  await doc.fonts.ready;
}

// Wrap by words first, and split very long words by Unicode characters.
function wrapText(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= width) { line = next; continue; }
    if (line) { lines.push(line); line = ""; }
    for (const char of Array.from(word)) {
      if (line && ctx.measureText(line + char).width > width) { lines.push(line); line = ""; }
      line += char;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function fitText(doc: Document, text: string, box: TextBox, heightMm: number) {
  const ctx = doc.createElement("canvas").getContext("2d");
  if (!ctx) throw new Error("The badge text cannot be measured in this browser.");
  const width = box.width * PX_PER_MM;
  const height = heightMm * PX_PER_MM;
  let size = box.fontSize;
  let lines: string[] = [];
  for (;;) {
    ctx.font = `${box.bold ? 700 : 400} ${size * 96 / 72}px "${box.font}"`;
    lines = wrapText(ctx, text, width);
    if ((lines.length * size * 96 / 72 * 1.15 <= height && lines.every((line) => ctx.measureText(line).width <= width)) || size <= box.minFontSize) break;
    size = Math.max(box.minFontSize, size - 0.5);
  }
  const maxLines = Math.max(0, Math.floor((height + 0.001) / (size * 96 / 72 * 1.15)));
  const truncated = lines.length > maxLines || lines.some((line) => ctx.measureText(line).width > width);
  if (maxLines === 0) return { text: "", size, truncated: Boolean(text) };
  lines = lines.slice(0, maxLines);
  if (truncated && lines.length) {
    const last = Array.from(lines[lines.length - 1]);
    while (last.length && ctx.measureText(last.join("") + "…").width > width) last.pop();
    lines[lines.length - 1] = last.join("") + "…";
  }
  return { text: lines.join("\n"), size, truncated };
}
