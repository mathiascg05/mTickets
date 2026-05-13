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
