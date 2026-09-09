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

// TSPL delimits arguments with double quotes, so they cannot appear inside one.
const tsplText = (s: string) => s.replace(/["\\]/g, "'").replace(/[\r\n]+/g, " ").trim();

// Built-in bitmap fonts, tallest first: name, char width, char height in dots.
// Font 5 is left out: the Xprinter clones render it uppercase-only.
const FONTS: [string, number, number][] = [
  ["4", 24, 32],
  ["3", 16, 24],
  ["2", 12, 20],
  ["1", 8, 12],
];

const DOTS_PER_PT = (DPMM * 25.4) / 72;

// Same type scale as the web badge: point size follows the label width, so a
// short name does not blow up to the biggest font.
const nameDots = (widthMm: number) => Math.min(13, Math.max(7, widthMm * 0.2)) * DOTS_PER_PT;

// Greedy word wrap. Null when the text needs more than `max` lines at this font.
function wrap(text: string, maxDots: number, charW: number, max: number): string[] | null {
  const per = Math.max(1, Math.floor(maxDots / charW));
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (word.length > per) return null;
    const next = line ? `${line} ${word}` : word;
    if (next.length <= per) line = next;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out.length && out.length <= max ? out : null;
}

// Tallest font at or under the target size that wraps inside `max` lines.
function block(text: string, maxDots: number, targetDots: number, max: number) {
  const clean = tsplText(text);
  const start = Math.max(0, FONTS.findIndex(([, , charH]) => charH <= targetDots));
  for (let i = start; i < FONTS.length; i++) {
    const [font, charW, charH] = FONTS[i];
    const lines = wrap(clean, maxDots, charW, max);
    if (lines) return { font, charW, charH, lines };
  }
  const [font, charW, charH] = FONTS[FONTS.length - 1];
  return { font, charW, charH, lines: [clean.slice(0, Math.max(1, Math.floor(maxDots / charW)))] };
}

function tspl(row: Row, s: Settings): Uint8Array<ArrayBuffer> {
  const w = Math.round(s.widthMm * DPMM);
  const h = Math.round(s.heightMm * DPMM);
  const m = 16; // side margin, dots
  const mv = 10; // top and bottom margin, dots
  const inner = w - m * 2;

  const name = block(row[COL.name], inner, nameDots(s.widthMm), 2);
  // Role is the next font down from the name, so it reads as smaller.
  const role = block(roleCompany(row), inner, name.charH - 1, 2);
  const gap = 8; // QR to name
  const lead = 6; // name to role
  const nameStep = Math.round(name.charH * 1.15);
  const roleStep = Math.round(role.charH * 1.1);
  const text = name.lines.length * nameStep + lead + role.lines.length * roleStep;

  // The printer picks the smallest QR version that holds the payload, and so
  // does the encoder here; its module count is what the printed code measures.
  // The QR then takes every dot the text leaves, capped at the web template's 60 mm.
  const id = tsplText(row[COL.id]);
  const modules = QRCode.create(id, { errorCorrectionLevel: "M" }).modules.size;
  const room = Math.min(inner, 60 * DPMM, h - mv * 2 - gap - text);
  const cell = Math.max(1, Math.min(10, Math.floor(room / modules)));
  const qr = modules * cell;

  // Centre the whole stack on the label, QR on top.
  const top = Math.max(mv, Math.floor((h - (qr + gap + text)) / 2));
  const mid = (width: number) => Math.max(m, Math.floor((w - width) / 2));
  const nameY = top + qr + gap;
  const roleY = nameY + name.lines.length * nameStep + lead;
  const centred = (bl: ReturnType<typeof block>, y0: number, step: number) =>
    bl.lines.map(
      (t, i) => `TEXT ${mid(t.length * bl.charW)},${y0 + i * step},"${bl.font}",0,1,1,"${t}"`,
    );

  const lines = [
    `SIZE ${s.widthMm} mm,${s.heightMm} mm`,
    `GAP ${s.gapMm} mm,0 mm`,
    "DIRECTION 1",
    "REFERENCE 0,0",
    `DENSITY ${s.density}`,
    `SPEED ${s.speed}`,
    "CLS",
    `QRCODE ${mid(qr)},${top},M,${cell},A,0,"${id}"`,
    ...centred(name, nameY, nameStep),
    ...centred(role, roleY, roleStep),
    `PRINT 1,${s.copies}`,
  ];
  return bytes(lines.join("\r\n") + "\r\n");
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

const SAMPLE: Row = {
  [COL.id]: "0badbadb-adba-4dba-8bad-badbadbadbad",
  [COL.name]: "Test Badge",
  [COL.email]: "test@example.com",
  [COL.company]: "Offline Check-in",
  [COL.title]: "Printer Test",
  [COL.time]: "",
};

export async function testPrint(s: Settings): Promise<string> {
  return printBadge(SAMPLE, s);
}
