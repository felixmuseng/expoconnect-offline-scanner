// Generates sample/attendee_list.xlsx and sample/qr/*.png for testing.
import * as XLSX from "xlsx";
import { mkdirSync, writeFileSync } from "node:fs";
import QRCode from "qrcode";

const rows = [
  { id: "ATT-1001", name: "Budi Santoso", company: "PT Maju Jaya", email: "budi@majujaya.id", ticket: "VIP" },
  { id: "ATT-1002", name: "Siti Rahma", company: "CV Sinar Abadi", email: "siti@sinarabadi.id", ticket: "Regular" },
  { id: "ATT-1003", name: "Andi Wijaya", company: "PT Nusantara Tech", email: "andi@nusantaratech.id", ticket: "Regular" },
  { id: "ATT-1004", name: "Dewi Lestari", company: "Wellbeing Champions", email: "dewi@wellbeingchampions.sg", ticket: "Speaker" },
  { id: "ATT-1005", name: "Rizky Pratama", company: "PT Cahaya Digital", email: "rizky@cahayadigital.id", ticket: "VIP" },
];

mkdirSync("sample/qr", { recursive: true });
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "attendees");
writeFileSync("sample/attendee_list.xlsx", XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

for (const r of rows) await QRCode.toFile(`sample/qr/${r.id}.png`, r.id, { width: 400 });
console.log(`Wrote sample/attendee_list.xlsx and ${rows.length} QR PNGs`);
