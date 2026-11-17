const pad = (n: number) => String(n).padStart(2, "0");

export function isoLocal(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

export const ymdLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const isoUtc = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;

export function localMidnight(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
