"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/LanguageContext";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useLanguage();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-accent text-white sticky top-0 z-10 shadow-md">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold tracking-wide">
            ma<span className="text-white/60">Tickets</span>
          </Link>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-6xl mb-4 opacity-30">!</p>
          <h1 className="text-2xl font-bold mb-2">{t("error.title")}</h1>
          <p className="text-muted mb-8">{t("error.message")}</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={reset}
              className="px-6 py-3 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium transition-colors shadow-lg shadow-accent/20"
            >
              {t("error.tryAgain")}
            </button>
            <Link
              href="/"
              className="px-6 py-3 border border-border hover:border-accent/40 rounded-lg font-medium transition-colors"
            >
              {t("error.backHome")}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
