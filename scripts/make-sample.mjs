// Generates sample/attendee_list.csv and sample/qr/*.png for testing.
import { mkdirSync, writeFileSync } from "node:fs";
import QRCode from "qrcode";

const headers = ["Attendee ID", "Full Name", "Email", "Company", "Job Title", "CheckIn Time"];
const rows = [
  ["10001", "Budi Santoso", "budi@majujaya.id", "PT Maju Jaya", "CEO"],
  ["10002", "Siti Rahma", "siti@sinarabadi.id", "CV Sinar Abadi", "HR Manager"],
  ["10003", "Andi Wijaya", "andi@nusantaratech.id", "PT Nusantara Tech", "Engineer"],
  ["10004", "Dewi Lestari", "dewi@wellbeingchampions.sg", "Wellbeing Champions", "Speaker, Wellbeing"],
  ["10005", "Rizky Pratama", "rizky@cahayadigital.id", "PT Cahaya Digital", "Marketing Lead"],
];

const q = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const csv = [headers, ...rows.map((r) => [...r, ""])].map((r) => r.map(q).join(",")).join("\r\n") + "\r\n";

mkdirSync("sample/qr", { recursive: true });
writeFileSync("sample/attendee_list.csv", csv);
for (const [id] of rows) await QRCode.toFile(`sample/qr/${id}.png`, id, { width: 400 });
console.log(`Wrote sample/attendee_list.csv and ${rows.length} QR PNGs`);
