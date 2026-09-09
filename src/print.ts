// Badge printing over WebUSB. TSPL (label printers, e.g. Xprinter XP-420B) or
// ESC/POS (receipt printers). Falls back to a log line when nothing is connected.
import type { Row } from "./csv";
import { COL } from "./store";
import type { Settings } from "./settings";
import QRCode from "qrcode";

export const supported = "usb" in navigator;

const DPMM = 8; // 203 dpi
const CLASS_PRINTER = 7;
// Vendor IDs of the common Chinese thermal printers, from the benchmark app.
const VENDORS = [0x0483, 0x0416, 0x6868, 0x28e9, 0x1a86, 0x0fe6, 0x04b8];

let device: USBDevice | null = null;
let iface = 0;
let endpoint = 1;
let packet = 64;
let onChange: (() => void) | null = null;

export const setOnChange = (fn: (() => void) | null) => {
  onChange = fn;
};

export const printerName = () =>
  device ? `${device.manufacturerName ?? ""} ${device.productName ?? "USB printer"}`.trim() : null;

export const connected = () => device !== null;

async function claim(d: USBDevice) {
  if (!d.opened) await d.open();
  if (d.configuration === null) await d.selectConfiguration(1);
  const config = d.configuration!;
  const target =
    config.interfaces.find((i) => i.alternates.some((a) => a.interfaceClass === CLASS_PRINTER)) ??
    config.interfaces.find((i) => i.alternates.some((a) => a.endpoints.some((e) => e.direction === "out")));
  if (!target) throw new Error("No printable interface on this device");
  const alt =
    target.alternates.find((a) => a.endpoints.some((e) => e.direction === "out")) ?? target.alternates[0];
  const out = alt.endpoints.find((e) => e.direction === "out");
  if (!out) throw new Error("Printer exposes no OUT endpoint");
  if (!target.claimed) await d.claimInterface(target.interfaceNumber);
  if (alt.alternateSetting !== 0) await d.selectAlternateInterface(target.interfaceNumber, alt.alternateSetting);
  device = d;
  iface = target.interfaceNumber;
  endpoint = out.endpointNumber;
  packet = out.packetSize || 64;
}

// Picks up a printer the browser already has permission for, so a reload does
// not need another device-picker click.
export async function restorePrinter(): Promise<boolean> {
  if (!supported) return false;
  const [d] = await navigator.usb.getDevices();
  if (!d) return false;
  try {
    await claim(d);
    return true;
  } catch {
    return false;
  }
}

export async function connectPrinter() {
  const d = await navigator.usb.requestDevice({
    filters: [{ classCode: CLASS_PRINTER }, ...VENDORS.map((vendorId) => ({ vendorId }))],
  });
  await claim(d);
}

export async function disconnectPrinter() {
  const d = device;
  device = null;
  if (!d) return;
  try {
    await d.releaseInterface(iface);
  } catch {
    // Already gone; closing is what matters.
  }
  await d.close();
}

if (supported) {
  navigator.usb.addEventListener("disconnect", (e) => {
    if (e.device === device) {
      device = null;
      onChange?.();
    }
  });
}

// USB out-transfers are capped per packet; a long label overruns one transfer.
async function write(bytes: Uint8Array<ArrayBuffer>): Promise<number> {
  if (!device) throw new Error("No printer connected");
  const size = Math.max(packet, 1) * 8;
  let sent = 0;
  for (let i = 0; i < bytes.length; i += size) {
    const chunk = bytes.slice(i, i + size);
    let res = await device.transferOut(endpoint, chunk);
    if (res.status === "stall") {
      await device.clearHalt("out", endpoint);
      res = await device.transferOut(endpoint, chunk);
    }
    if (res.status !== "ok") throw new Error(`Printer rejected data (${res.status})`);
    sent += res.bytesWritten;
  }
  return sent;
}

const enc = new TextEncoder();
const bytes = (s: string) => Uint8Array.from(enc.encode(s)) as Uint8Array<ArrayBuffer>;

// One line under the name: "Job Title @ Company", as the web badge prints it.
function roleCompany(row: Row): string {
  const role = row[COL.title]?.trim() || "Attendee";
  const company = row[COL.company]?.trim();
  return company ? `${role} @ ${company}` : role;
}

/* ---------- TSPL ---------- */

// The label is drawn on a canvas and sent as one bitmap. Printer-side QR and
// fonts vary between clones, so anything positioned around them lands off
// centre; a bitmap prints exactly what the preview shows.

const DOTS_PER_PT = (DPMM * 25.4) / 72;
const FAMILY = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const font = (px: number, weight: string) => `${weight} ${px}px ${FAMILY}`;

// Same type scale as the web badge: point size follows the label width, so a
// short name does not blow up to the biggest size.
function typeScale(widthMm: number) {
  const namePt = Math.min(13, Math.max(7, widthMm * 0.2));
  return { name: namePt * DOTS_PER_PT, role: namePt * 0.7 * DOTS_PER_PT };
}

// Greedy word wrap. Null when the text needs more than `max` lines at this size.
function wrap(ctx: CanvasRenderingContext2D, text: string, maxDots: number, max: number): string[] | null {
  const fits = (s: string) => ctx.measureText(s).width <= maxDots;
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!fits(word)) return null;
    const next = line ? `${line} ${word}` : word;
    if (fits(next)) line = next;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out.length && out.length <= max ? out : null;
}

// Largest size at or under the target that wraps inside `max` lines; below the
// floor the text is cut with an ellipsis instead of shrunk further.
function block(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxDots: number,
  target: number,
  max: number,
  weight: string,
) {
  const clean = text.replace(/[\r\n]+/g, " ").trim();
  const floor = 12;
  for (let px = Math.round(target); px >= floor; px -= 2) {
    ctx.font = font(px, weight);
    const lines = wrap(ctx, clean, maxDots, max);
    if (lines) return { px, weight, lines, step: Math.round(px * 1.15) };
  }
  ctx.font = font(floor, weight);
  let cut = clean;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxDots) cut = cut.slice(0, -1);
  return { px: floor, weight, lines: [cut === clean ? clean : `${cut}…`], step: Math.round(floor * 1.15) };
}

// Draws one label at printer resolution: QR on top, name, then role, the whole
// stack centred both ways. The QR takes every dot the text leaves, capped at
// the 60 mm the web template allows.
export function renderLabel(row: Row, s: Settings): HTMLCanvasElement {
  const w = Math.round(s.widthMm * DPMM);
  const h = Math.round(s.heightMm * DPMM);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);

  const m = 16; // margin, dots
  const inner = w - m * 2;
  const size = typeScale(s.widthMm);
  const name = block(ctx, row[COL.name], inner, size.name, 2, "bold");
  const role = block(ctx, roleCompany(row), inner, size.role, 2, "normal");
  const gap = 8; // QR to name
  const lead = 4; // name to role
  const text = name.lines.length * name.step + lead + role.lines.length * role.step;

  const qr = QRCode.create(row[COL.id], { errorCorrectionLevel: "M" }).modules;
  const room = Math.min(inner, 60 * DPMM, h - m * 2 - gap - text);
  const cell = Math.max(1, Math.floor(room / qr.size));
  const qrDots = qr.size * cell;

  const top = Math.max(m, Math.floor((h - (qrDots + gap + text)) / 2));
  const left = Math.floor((w - qrDots) / 2);
  ctx.fillStyle = "#000";
  for (let r = 0; r < qr.size; r++)
    for (let c = 0; c < qr.size; c++)
      if (qr.get(r, c)) ctx.fillRect(left + c * cell, top + r * cell, cell, cell);

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  let y = top + qrDots + gap;
  for (const bl of [name, role]) {
    ctx.font = font(bl.px, bl.weight);
    for (const line of bl.lines) {
      ctx.fillText(line, w / 2, y);
      y += bl.step;
    }
    y += lead;
  }
  return canvas;
}

// TSPL BITMAP: one bit per dot, 1 = blank, 0 = black, rows padded to a byte.
function bitmap(canvas: HTMLCanvasElement): { widthBytes: number; data: Uint8Array } {
  const { width, height } = canvas;
  const px = canvas.getContext("2d")!.getImageData(0, 0, width, height).data;
  const widthBytes = Math.ceil(width / 8);
  const data = new Uint8Array(widthBytes * height).fill(0xff);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
      if (lum < 128) data[y * widthBytes + (x >> 3)] &= ~(0x80 >> (x & 7));
    }
  return { widthBytes, data };
}

function tspl(row: Row, s: Settings): Uint8Array<ArrayBuffer> {
  const canvas = renderLabel(row, s);
  const { widthBytes, data } = bitmap(canvas);
  const head = bytes(
    [
      `SIZE ${s.widthMm} mm,${s.heightMm} mm`,
      `GAP ${s.gapMm} mm,0 mm`,
      "DIRECTION 1",
      `DENSITY ${s.density}`,
      `SPEED ${s.speed}`,
      "CLS",
      `BITMAP 0,0,${widthBytes},${canvas.height},0,`,
    ].join("\r\n"),
  );
  const tail = bytes(`\r\nPRINT 1,${s.copies}\r\n`);
  const out = new Uint8Array(head.length + data.length + tail.length);
  out.set(head, 0);
  out.set(data, head.length);
  out.set(tail, head.length + data.length);
  return out;
}

/* ---------- ESC/POS ---------- */

const ESC = 0x1b,
  GS = 0x1d;
const b = (...xs: (number | string)[]) => xs.flatMap((x) => (typeof x === "string" ? [...enc.encode(x)] : [x]));

function escpos(row: Row, s: Settings): Uint8Array<ArrayBuffer> {
  const id = row[COL.id];
  const one = [
    ...b(ESC, 0x40), // init
    ...b(ESC, 0x61, 1), // center
    // QR: model 2, cell size, error correction M, store, print
    ...b(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 50, 0),
    ...b(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, Math.max(1, Math.min(8, s.qrCell))),
    ...b(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 49),
    ...b(GS, 0x28, 0x6b, id.length + 3, 0, 0x31, 0x50, 48, id),
    ...b(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 48),
    ...b("\n"),
    ...b(ESC, 0x45, 1), // bold
    ...b(GS, 0x21, 0x11), // double size
    ...b(row[COL.name], "\n"),
    ...b(GS, 0x21, 0x00),
    ...b(ESC, 0x45, 0),
    ...b(roleCompany(row), "\n\n\n"),
    ...b(GS, 0x56, 0), // cut
  ];
  return Uint8Array.from(Array.from({ length: s.copies }, () => one).flat());
}

/* ---------- entry points ---------- */

export const render = (row: Row, s: Settings) => (s.engine === "tspl" ? tspl(row, s) : escpos(row, s));

export async function printBadge(row: Row, s: Settings): Promise<string> {
  const stamp = new Date().toLocaleTimeString();
  const who = `${row[COL.id]} ${row[COL.name]}`;
  const payload = render(row, s);
  if (!device) return `[${stamp}] MOCK ${s.engine.toUpperCase()} (no printer connected): ${who}`;
  const sent = await write(payload);
  return `[${stamp}] ${s.engine.toUpperCase()} print ok: ${who} (${sent} bytes)`;
}

export const SAMPLE: Row = {
  [COL.id]: "00000000-0000-4000-8000-000000000000",
  [COL.name]: "Test Badge",
  [COL.email]: "test@example.com",
  [COL.company]: "Offline Check-in",
  [COL.title]: "Printer Test",
  [COL.time]: "",
};

export async function testPrint(s: Settings): Promise<string> {
  return printBadge(SAMPLE, s);
}
