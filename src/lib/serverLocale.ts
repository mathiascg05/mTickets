import { NextRequest } from "next/server";
import { routing, type Locale } from "@/i18n/routing";

const SUPPORTED = routing.locales as readonly string[];

function isLocale(value: string | undefined | null): value is Locale {
  return !!value && SUPPORTED.includes(value);
}

export function detectLocale(req: NextRequest): Locale {
  const cookieLocale = req.cookies.get("NEXT_LOCALE")?.value;
  if (isLocale(cookieLocale)) return cookieLocale;

  const accept = req.headers.get("accept-language") || "";
  const preferred = accept.split(",")[0]?.trim().slice(0, 2).toLowerCase();
  if (isLocale(preferred)) return preferred;

  return routing.defaultLocale as Locale;
}

export function resolveEmailLang(
  orderLang: string | undefined | null,
  concertDefault: string | undefined | null,
): Locale {
  if (isLocale(orderLang)) return orderLang;
  if (isLocale(concertDefault)) return concertDefault;
  return routing.defaultLocale as Locale;
}
