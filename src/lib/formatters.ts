import { dateLocale, type Lang } from "./i18n";

const DEFAULT_OPTS: Intl.DateTimeFormatOptions = {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
};

export function formatEventDate(
  date: string | Date,
  lang: Lang,
  opts?: Intl.DateTimeFormatOptions,
): string {
  return new Date(date).toLocaleDateString(dateLocale(lang), opts ?? DEFAULT_OPTS);
}

/**
 * Venezuela runs on a fixed UTC-4 offset (no DST), but we go through Intl
 * anyway so the day boundary stays correct if that ever changes.
 */
export const VE_TIME_ZONE = "America/Caracas";

// "en-CA" formats as YYYY-MM-DD, which is exactly the day key we want.
const CARACAS_DAY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: VE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Epoch ms -> "YYYY-MM-DD" as seen in Venezuela. */
export function toCaracasDay(ts: number): string {
  return CARACAS_DAY_FMT.format(new Date(ts));
}

/** Today's "YYYY-MM-DD" in Venezuela. */
export function caracasToday(): string {
  return toCaracasDay(Date.now());
}

// Day strings are anchored at UTC noon so that adding days can never trip over
// a timezone boundary.
function dayToUtcNoon(day: string): number {
  return Date.parse(`${day}T12:00:00Z`);
}

/** "YYYY-MM-DD" + n days -> "YYYY-MM-DD". */
export function addDays(day: string, n: number): string {
  const d = new Date(dayToUtcNoon(day) + n * 86400000);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((dayToUtcNoon(to) - dayToUtcNoon(from)) / 86400000);
}
