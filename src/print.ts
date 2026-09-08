// Badge printing over WebUSB using ESC/POS. Falls back to a log line when no printer is connected.
import type { Row } from "./csv";
import { COL } from "./store";

let device: USBDevice | null = null;
let endpoint = 1;

export const supported = "usb" in navigator;
export const printerName = () => (device ? `${device.manufacturerName ?? ""} ${device.productName ?? "USB printer"}`.trim() : null);

export async function connectPrinter() {
  const d = await navigator.usb.requestDevice({ filters: [] });
  await d.open();
  if (d.configuration === null) await d.selectConfiguration(1);
  const iface =
    d.configuration!.interfaces.find((i) => i.alternates[0].interfaceClass === 7) ?? d.configuration!.interfaces[0];
  await d.claimInterface(iface.interfaceNumber);
  endpoint = iface.alternates[0].endpoints.find((e) => e.direction === "out")!.endpointNumber;
  device = d;
}

export async function disconnectPrinter() {
  await device?.close();
  device = null;
}

const enc = new TextEncoder();
const ESC = 0x1b, GS = 0x1d;
const b = (...xs: (number | string)[]) => xs.flatMap((x) => (typeof x === "string" ? [...enc.encode(x)] : [x]));

function escpos(row: Row): Uint8Array<ArrayBuffer> {
  const id = row[COL.id];
  return Uint8Array.from([
    ...b(ESC, 0x40), // init
    ...b(ESC, 0x61, 1), // center
    ...b(GS, 0x21, 0x11), // double size
    ...b(row[COL.name], "\n"),
    ...b(GS, 0x21, 0x00),
    ...b(row[COL.title], "\n", row[COL.company], "\n\n"),
    // QR: model 2, size 6, error correction M, store, print
    ...b(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 50, 0),
    ...b(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, 6),
    ...b(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 49),
    ...b(GS, 0x28, 0x6b, id.length + 3, 0, 0x31, 0x50, 48, id),
    ...b(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 48),
    ...b(id, "\n\n\n"),
    ...b(GS, 0x56, 0), // cut
  ]);
}

export async function printBadge(row: Row): Promise<string> {
  const stamp = new Date().toLocaleTimeString();
  const who = `${row[COL.id]} ${row[COL.name]}`;
  if (!device) return `[${stamp}] MOCK print (no printer connected): ${who}`;
  const res = await device.transferOut(endpoint, escpos(row));
  return `[${stamp}] USB print ${res.status}: ${who} (${res.bytesWritten} bytes)`;
}
