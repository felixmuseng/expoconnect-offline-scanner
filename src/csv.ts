export type Row = Record<string, string>;
export type Csv = { headers: string[]; rows: Row[]; bom: boolean; eol: string };

export function parseCsv(text: string): Csv {
  const bom = text.charCodeAt(0) === 0xfeff;
  if (bom) text = text.slice(1);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";

  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { record.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      record.push(field); field = "";
      records.push(record); record = [];
    } else field += c;
  }
  if (field || record.length) { record.push(field); records.push(record); }

  const [headers = [], ...body] = records.map((r) => r.map((f) => f.trim()));
  const rows = body
    .filter((r) => r.some((f) => f !== ""))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
  return { headers, rows, bom, eol };
}

const quote = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function serializeCsv({ headers, rows, bom, eol }: Csv): string {
  const lines = [headers, ...rows.map((r) => headers.map((h) => r[h] ?? ""))];
  return (bom ? "﻿" : "") + lines.map((l) => l.map(quote).join(",")).join(eol) + eol;
}
