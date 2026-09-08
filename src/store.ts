export type Row = Record<string, string | number | boolean | null>;

export type Dataset = {
  fileName: string;
  headers: string[];
  idColumn: string;
  rows: Row[];
  checkins: Record<string, string>; // id -> ISO timestamp
};

const KEY = "offline-checkin:dataset";

export function load(): Dataset | null {
  const raw = localStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as Dataset) : null;
}

export function save(ds: Dataset | null) {
  if (ds) localStorage.setItem(KEY, JSON.stringify(ds));
  else localStorage.removeItem(KEY);
}

export function findById(ds: Dataset, id: string): Row | undefined {
  const want = id.trim().toLowerCase();
  return ds.rows.find((r) => String(r[ds.idColumn] ?? "").trim().toLowerCase() === want);
}

export function guessIdColumn(headers: string[]): string {
  return headers.find((h) => /id|qr|code|ticket/i.test(h)) ?? headers[0];
}
