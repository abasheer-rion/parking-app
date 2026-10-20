// Property times are America/Chicago. Never use a fixed offset: DST changes it twice a year.
export const TZ = "America/Chicago";

const SHOW = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, weekday: "short", month: "short", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: true,
});
const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

export function now(): number {
  return Date.now() / 1000;
}

/** Same output as the Flask app's fmt(): "Tue Oct 20, 11:30 PM", or "n/a". */
export function fmt(ts: number | null | undefined): string {
  if (!ts) return "n/a";
  const p: Record<string, string> = {};
  for (const x of SHOW.formatToParts(new Date(Math.floor(ts) * 1000))) p[x.type] = x.value;
  const hour = p.hour === "00" ? "12" : p.hour;
  return `${p.weekday} ${p.month} ${p.day}, ${hour}:${p.minute} ${p.dayPeriod.toUpperCase()}`;
}

/** Offset of Chicago from UTC at instant ms, in ms (CDT is -5 h, CST is -6 h). */
function offsetAt(ms: number): number {
  const p: Record<string, number> = {};
  for (const x of PARTS.formatToParts(new Date(ms))) if (x.type !== "literal") p[x.type] = Number(x.value);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Chicago wall clock time to a Unix timestamp. Like Python with fold=0: an
 * ambiguous time (the repeated hour in November) takes the first, earlier one,
 * and a skipped time (March) uses the offset from before the change. */
export function chicagoToTs(y: number, mo: number, d: number, h: number, mi: number, s: number): number {
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  const before = offsetAt(naive - 86400000);
  const after = offsetAt(naive + 86400000);
  const valid = [...new Set([before, after])]
    .map((o) => naive - o)
    .filter((t) => offsetAt(t) === naive - t)
    .sort((a, b) => a - b);
  return (valid.length ? valid[0] : naive - before) / 1000;
}

/** Parses the Results page expiry "10/21/2026 11:30:00 PM" (already space-normalised and upper case).
 * Matches the Flask app's strptime("%m/%d/%Y %I:%M:%S %p"): returns null when it does not fit. */
export function parseSiteTime(s: string): number | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{1,2}):(\d{1,2}) ?(AM|PM)$/.exec(s);
  if (!m) return null;
  const [mo, d, y, hh, mi, ss] = m.slice(1, 7).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || hh < 1 || hh > 12 || mi > 59 || ss > 61) return null;
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d > dim) return null;
  const h = (hh % 12) + (m[7] === "PM" ? 12 : 0);
  return chicagoToTs(y, mo, d, h, mi, Math.min(ss, 59));
}
