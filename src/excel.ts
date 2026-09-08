import * as XLSX from "xlsx";
import type { Dataset, Row } from "./store";
import { guessIdColumn } from "./store";

export async function importExcel(file: File): Promise<Dataset> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Row>(sheet, { defval: null });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  if (!headers.length) throw new Error("First sheet is empty");
  return { fileName: file.name, headers, idColumn: guessIdColumn(headers), rows, checkins: {} };
}

export function exportExcel(ds: Dataset) {
  const out = ds.rows.map((r) => {
    const id = String(r[ds.idColumn] ?? "");
    const at = ds.checkins[id];
    return { ...r, checked_in: at ? "YES" : "NO", checked_in_at: at ?? "" };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(out), "checkin");
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  XLSX.writeFile(wb, `checkin_result_${stamp}.xlsx`);
}
