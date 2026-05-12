import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["es", "en"],
  defaultLocale: "es",
  // Spanish (default) URLs stay clean (matickets.com/events/X);
  // English URLs are prefixed (matickets.com/en/events/X).
  // Organizer-shared links keep working unchanged.
  localePrefix: "as-needed",
  localeDetection: true,
});

export type Locale = (typeof routing.locales)[number];
