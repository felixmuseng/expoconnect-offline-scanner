import type { Csv, Row } from "./csv";

export const COL = {
  id: "Attendee ID",
  name: "Full Name",
  email: "Email",
  phone: "Phone Number",
  company: "Company",
  title: "Job Title",
  country: "Country",
  time: "CheckIn Time",
  tier: "Tier",
} as const;

export const REQUIRED = [COL.id, COL.name, COL.email, COL.phone, COL.company, COL.title, COL.country, COL.time];

const norm = (s: string) => s.trim().toLowerCase();
const normTier = (s: string) => s.trim().toUpperCase();

export const findById = (rows: Row[], id: string) => rows.find((r) => norm(r[COL.id]) === norm(id));
export const isVipTier = (value: string | undefined) => normTier(value ?? "") === "VIP";

export function withOptionalColumns(csv: Csv): Csv {
  let result = csv;
  for (const [column, after] of [[COL.phone, COL.email], [COL.country, COL.title]]) {
    if (result.headers.includes(column)) continue;
    const index = result.headers.indexOf(after);
    const insertAt = index >= 0 ? index + 1 : result.headers.length;
    const headers = [...result.headers.slice(0, insertAt), column, ...result.headers.slice(insertAt)];
    const rows = result.rows.map((row) => ({ ...row, [column]: "" }));
    result = { ...result, headers, rows };
  }
  return result;
}

export function validateTier(headers: string[], rows: Row[]): string | null {
  if (!headers.includes(COL.tier)) return null;
  const badRow = rows.findIndex((row) => {
    const tier = normTier(row[COL.tier] ?? "");
    return tier !== "" && tier !== "VIP";
  });
  return badRow >= 0 ? `${COL.tier} must be empty or VIP. Row ${badRow + 2} has "${rows[badRow][COL.tier]}".` : null;
}

export type SearchQueries = {
  name: string;
  email: string;
  company: string;
};

const hasQuery = (q: string) => norm(q).length >= 2;

export function search(rows: Row[], q: SearchQueries): Row[] {
  const terms = {
    name: norm(q.name),
    email: norm(q.email),
    company: norm(q.company),
  };
  const active = {
    name: terms.name.length >= 2,
    email: terms.email.length >= 2,
    company: terms.company.length >= 2,
  };
  if (!active.name && !active.email && !active.company) return [];

  const hits: Row[] = [];
  for (const row of rows) {
    const match =
      (!active.name || norm(row[COL.name]).includes(terms.name)) &&
      (!active.email || norm(row[COL.email]).includes(terms.email)) &&
      (!active.company || norm(row[COL.company]).includes(terms.company));
    if (match) hits.push(row);
  }
  return hits;
}

export const hasSearchQuery = (q: SearchQueries) => hasQuery(q.name) || hasQuery(q.email) || hasQuery(q.company);

// The importer reads a bare "YYYY-MM-DD HH:mm:ss" as WIB, so write WIB rather
// than whatever the laptop clock is set to — otherwise a machine on SGT or UTC
// logs an hour the server then reads as the wrong instant.
export function now(d = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Jakarta",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}
