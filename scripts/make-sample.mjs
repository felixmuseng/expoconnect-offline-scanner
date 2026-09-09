// Generates sample/attendee_list.csv and sample/qr/*.png for testing.
import { mkdirSync, writeFileSync } from "node:fs";
import QRCode from "qrcode";

const headers = ["Attendee ID", "Full Name", "Email", "Company", "Job Title", "CheckIn Time"];
// Attendee IDs are UUIDs because that is what the server exports and what its
// importer accepts back; fixed values keep sample/qr/*.png stable across runs.
const rows = [
  ["3f2504e0-4f89-41d3-9a0c-0305e82c3301", "Budi Santoso", "budi@majujaya.id", "PT Maju Jaya", "CEO"],
  ["3f2504e0-4f89-41d3-9a0c-0305e82c3302", "Siti Rahma", "siti@sinarabadi.id", "CV Sinar Abadi", "HR Manager"],
  ["3f2504e0-4f89-41d3-9a0c-0305e82c3303", "Andi Wijaya", "andi@nusantaratech.id", "PT Nusantara Tech", "Engineer"],
  ["3f2504e0-4f89-41d3-9a0c-0305e82c3304", "Dewi Lestari", "dewi@wellbeingchampions.sg", "Wellbeing Champions", "Speaker, Wellbeing"],
  ["3f2504e0-4f89-41d3-9a0c-0305e82c3305", "Rizky Pratama", "rizky@cahayadigital.id", "PT Cahaya Digital", "Marketing Lead"],
];

const q = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
// Leading BOM, like the server export, so the scanner writes one back too and
// Excel opens the names as UTF-8 without an import wizard.
const csv = "﻿" + [headers, ...rows.map((r) => [...r, ""])].map((r) => r.map(q).join(",")).join("\r\n") + "\r\n";

mkdirSync("sample/qr", { recursive: true });
writeFileSync("sample/attendee_list.csv", csv);
for (const [id] of rows) await QRCode.toFile(`sample/qr/${id}.png`, id, { width: 400 });
console.log(`Wrote sample/attendee_list.csv and ${rows.length} QR PNGs`);
