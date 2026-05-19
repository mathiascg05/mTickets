"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLanguage } from "@/lib/LanguageContext";

const CHUNK_ERROR_REGEX =
  /ChunkLoadError|Loading chunk|Loading CSS chunk|Failed to fetch dynamically imported module/i;
const RELOAD_COUNT_KEY = "chunkReloadCount";
const RELOAD_TS_KEY = "chunkReloadTs";
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [0, 3000, 8000];
const RESET_AFTER_MS = 10 * 60 * 1000;

function readCount(): number {
  if (typeof window === "undefined") return 0;
  try {
    const count = parseInt(sessionStorage.getItem(RELOAD_COUNT_KEY) ?? "0", 10);
    const ts = parseInt(sessionStorage.getItem(RELOAD_TS_KEY) ?? "0", 10);
    if (!Number.isFinite(count) || count < 0) return 0;
    if (ts && Date.now() - ts > RESET_AFTER_MS) return 0;
    return count;
  } catch {
    return 0;
  }
}

function clearReloadState() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(RELOAD_COUNT_KEY);
    sessionStorage.removeItem(RELOAD_TS_KEY);
  } catch {}
}

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
  const [attemptCount, setAttemptCount] = useState<number>(() => readCount());
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isChunkError) {
      clearReloadState();
      return;
    }

    const count = readCount();
    if (count >= MAX_ATTEMPTS) {
      // Out of automatic attempts — show the manual screen with the
      // nuclear-cache button so the user can break out.
      setAttemptCount(count);
      return;
    }

    const nextCount = count + 1;
    try {
      sessionStorage.setItem(RELOAD_COUNT_KEY, String(nextCount));
      sessionStorage.setItem(RELOAD_TS_KEY, String(Date.now()));
    } catch {}
    setAttemptCount(nextCount);
    setReloading(true);

    const delay = BACKOFF_MS[count] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
    timeoutRef.current = setTimeout(() => {
      void doReload(nextCount);
    }, delay);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [isChunkError]);

  async function doReload(attempt: number) {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("_r", Date.now().toString(36));
    if (attempt >= 2) url.searchParams.set("_rv", String(attempt));
    if (attempt >= 3) {
      url.searchParams.set("_nocache", "1");
      try {
        await fetch(window.location.href, { cache: "reload" });
      } catch {}
    }
    window.location.replace(url.toString());
  }

  function handleReset() {
    clearReloadState();
    setAttemptCount(0);
    reset();
  }

  async function handleNuclear() {
    if (typeof window === "undefined") return;
    setReloading(true);
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {}
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
    } catch {}
    try {
      sessionStorage.clear();
    } catch {}
    window.location.href = "/?_nuclear=" + Date.now();
  }

  if (reloading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted">{t("common.loading")}</div>
      </div>
    );
  }

  const showNuclear = isChunkError && attemptCount >= MAX_ATTEMPTS;

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
          <div className="flex flex-wrap gap-3 justify-center">
            <button
              onClick={handleReset}
              className="px-6 py-3 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium transition-colors shadow-lg shadow-accent/20"
            >
              {t("error.tryAgain")}
            </button>
            {showNuclear && (
              <button
                onClick={handleNuclear}
                className="px-6 py-3 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg font-medium transition-colors shadow-lg shadow-yellow-600/20"
              >
                {t("error.clearCache")}
              </button>
            )}
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
