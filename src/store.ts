import type { Row } from "./csv";

export const COL = {
  id: "Attendee ID",
  name: "Full Name",
  email: "Email",
  company: "Company",
  title: "Job Title",
  time: "CheckIn Time",
} as const;

export const REQUIRED = Object.values(COL);

const norm = (s: string) => s.trim().toLowerCase();

export const findById = (rows: Row[], id: string) => rows.find((r) => norm(r[COL.id]) === norm(id));

export function search(rows: Row[], q: string, limit = 20): Row[] {
  const n = norm(q);
  if (n.length < 2) return [];
  return rows.filter((r) => norm(r[COL.name]).includes(n) || norm(r[COL.email]).includes(n)).slice(0, limit);
}

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
