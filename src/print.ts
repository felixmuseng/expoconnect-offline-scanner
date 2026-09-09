// Badge printing over WebUSB. TSPL (label printers, e.g. Xprinter XP-420B) or
// ESC/POS (receipt printers). Falls back to a log line when nothing is connected.
import type { Row } from "./csv";
import { COL } from "./store";
import type { Settings } from "./settings";

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

/* ---------- TSPL ---------- */

// TSPL delimits arguments with double quotes, so they cannot appear inside one.
const tsplText = (s: string) => s.replace(/["\\]/g, "'").replace(/[\r\n]+/g, " ").trim();

// Widest built-in font whose text still fits the line, then hard-truncate.
function fit(text: string, maxDots: number, fonts: [string, number][]): string {
  const clean = tsplText(text);
  for (const [font, charW] of fonts) {
    const max = Math.floor(maxDots / charW);
    if (clean.length <= max) return `"${font}",0,1,1,"${clean}"`;
  }
  const [font, charW] = fonts[fonts.length - 1];
  return `"${font}",0,1,1,"${clean.slice(0, Math.floor(maxDots / charW))}"`;
}

function tspl(row: Row, s: Settings): Uint8Array<ArrayBuffer> {
  const w = Math.round(s.widthMm * DPMM);
  const h = Math.round(s.heightMm * DPMM);
  const m = 16; // margin, dots
  const inner = w - m * 2;

  // A UUID needs QR version 3 (29 modules) at ECC M; shrink the cell to fit.
  const modules = 29;
  const cell = Math.max(1, Math.min(s.qrCell, Math.floor((h - m - 112) / modules)));
  const qr = modules * cell;
  const qrY = h - m - qr;

  const idText = tsplText(row[COL.id]);
  const idX = m + qr + 12;
  const idPerLine = Math.max(1, Math.floor((w - m - idX) / 8));

  const lines = [
    `SIZE ${s.widthMm} mm,${s.heightMm} mm`,
    `GAP ${s.gapMm} mm,0 mm`,
    "DIRECTION 1",
    `DENSITY ${s.density}`,
    `SPEED ${s.speed}`,
    "CLS",
    `TEXT ${m},${m},${fit(row[COL.name], inner, [["4", 24], ["3", 16], ["2", 12]])}`,
    `TEXT ${m},${m + 40},${fit(row[COL.title], inner, [["2", 12], ["1", 8]])}`,
    `TEXT ${m},${m + 66},${fit(row[COL.company], inner, [["2", 12], ["1", 8]])}`,
    `QRCODE ${m},${qrY},M,${cell},A,0,"${idText}"`,
  ];
  for (let i = 0; i * idPerLine < idText.length; i++) {
    lines.push(`TEXT ${idX},${qrY + i * 16},"1",0,1,1,"${idText.slice(i * idPerLine, (i + 1) * idPerLine)}"`);
  }
  lines.push(`PRINT 1,${s.copies}`);
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
    ...b(GS, 0x21, 0x11), // double size
    ...b(row[COL.name], "\n"),
    ...b(GS, 0x21, 0x00),
    ...b(row[COL.title], "\n", row[COL.company], "\n\n"),
    // QR: model 2, cell size, error correction M, store, print
    ...b(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 50, 0),
    ...b(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, Math.max(1, Math.min(8, s.qrCell))),
    ...b(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 49),
    ...b(GS, 0x28, 0x6b, id.length + 3, 0, 0x31, 0x50, 48, id),
    ...b(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 48),
    ...b(id, "\n\n\n"),
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
