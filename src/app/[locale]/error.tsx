"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLanguage } from "@/lib/LanguageContext";

const CHUNK_ERROR_REGEX =
  /ChunkLoadError|Loading chunk|Loading CSS chunk|Failed to fetch dynamically imported module/i;
const RELOAD_FLAG = "chunkReloadAttempted";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useLanguage();
  const isChunkError =
    CHUNK_ERROR_REGEX.test(error.message) || CHUNK_ERROR_REGEX.test(error.name);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isChunkError) {
      sessionStorage.removeItem(RELOAD_FLAG);
      return;
    }
    if (sessionStorage.getItem(RELOAD_FLAG)) {
      // Already attempted in this session — fall through to the cartel below
      // so the user can manually retry instead of getting stuck on a spinner.
      return;
    }
    sessionStorage.setItem(RELOAD_FLAG, "1");
    setReloading(true);
    // Cache-bust to force fresh HTML/chunks; reload() can be served from cache.
    const url = new URL(window.location.href);
    url.searchParams.set("_r", Date.now().toString(36));
    window.location.replace(url.toString());
  }, [isChunkError]);

  if (reloading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted">{t("common.loading")}</div>
      </div>
    );
  }

  function handleReset() {
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(RELOAD_FLAG);
    }
    reset();
  }

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
              onClick={handleReset}
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
