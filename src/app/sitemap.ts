import type { MetadataRoute } from "next";
import { adminDb } from "@/lib/adminDb";
import { routing } from "@/i18n/routing";

const STATIC_PATHS = ["/", "/terms", "/privacy", "/terms-organizer"] as const;

function withLocalePrefix(path: string, locale: string): string {
  if (locale === routing.defaultLocale) return path === "/" ? "/" : path;
  return path === "/" ? `/${locale}` : `/${locale}${path}`;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://matickets.com";

  const entries: MetadataRoute.Sitemap = [];

  // Static pages — one entry per default locale, with `alternates.languages` for each variant
  for (const path of STATIC_PATHS) {
    const languages: Record<string, string> = {};
    for (const loc of routing.locales) {
      languages[loc] = `${baseUrl}${withLocalePrefix(path, loc)}`;
    }
    entries.push({
      url: `${baseUrl}${path}`,
      lastModified: new Date(),
      changeFrequency: path === "/" ? "weekly" : "monthly",
      priority: path === "/" ? 1.0 : 0.5,
      alternates: { languages },
    });
  }

  // Active events
  try {
    const { concerts } = await adminDb.query({
      concerts: { $: { where: { status: "active" } } },
    });
    for (const concert of concerts) {
      const path = `/events/${concert.slug}`;
      const languages: Record<string, string> = {};
      for (const loc of routing.locales) {
        languages[loc] = `${baseUrl}${withLocalePrefix(path, loc)}`;
      }
      entries.push({
        url: `${baseUrl}${path}`,
        lastModified: new Date(concert.date),
        changeFrequency: "daily",
        priority: 0.8,
        alternates: { languages },
      });
    }
  } catch (err) {
    console.error("[sitemap] Failed to fetch active concerts:", err);
  }

  return entries;
}
