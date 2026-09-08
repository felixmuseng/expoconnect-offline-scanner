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

export function now(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
