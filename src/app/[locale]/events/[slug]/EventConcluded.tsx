"use client";

import Link from "next/link";
import { useStorageUrl } from "@/lib/useStorageUrl";
import { useLanguage, LanguageToggle } from "@/lib/LanguageContext";
import { dateLocale, type Lang } from "@/lib/i18n";

type Concert = {
  name: string;
  date: string;
  venue?: string;
  logoPath?: string;
  flyerPath?: string;
};

function formatDate(dateStr: string, lang: Lang): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(dateLocale(lang), {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default function EventConcluded({ concert }: { concert: Concert }) {
  const { t, lang } = useLanguage();
  const logoUrl = useStorageUrl(concert.logoPath);
  const flyerUrl = useStorageUrl(concert.flyerPath);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-accent/95 backdrop-blur-sm text-white border-b border-white/10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold tracking-wide">
            ma<span className="text-white/50">Tickets</span>
          </Link>
          <LanguageToggle className="border-white/20 text-white/70 hover:text-white" />
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="max-w-md w-full bg-surface border border-border rounded-2xl p-8 text-center shadow-sm">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={concert.name}
              className="h-20 w-auto object-contain mx-auto mb-6"
            />
          ) : flyerUrl ? (
            <img
              src={flyerUrl}
              alt={concert.name}
              className="w-full max-h-48 object-cover rounded-lg mb-6"
            />
          ) : null}

          <div className="inline-block px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-300 mb-4">
            {t("public.eventConcluded.badge")}
          </div>

          <h1 className="text-2xl font-bold mb-2">{concert.name}</h1>
          <p className="text-sm text-muted mb-1">{formatDate(concert.date, lang)}</p>
          {concert.venue && (
            <p className="text-sm text-muted mb-6">{concert.venue}</p>
          )}

          <h2 className="text-lg font-semibold mt-6 mb-2">
            {t("public.eventConcluded.title")}
          </h2>
          <p className="text-sm text-muted mb-6">
            {t("public.eventConcluded.body")}
          </p>

          <Link
            href="/"
            className="inline-block px-5 py-2.5 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium transition-colors text-sm"
          >
            {t("public.eventConcluded.cta")}
          </Link>
        </div>
      </main>
    </div>
  );
}
