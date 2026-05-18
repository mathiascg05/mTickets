"use client";

import { ScannerErrorBoundary } from "@/components/scanner/ScannerErrorBoundary";
import { ScannerPageHeader } from "@/components/scanner/ScannerShell";
import {
  decodeTokenExp,
  safeStorageGet,
  scannerEventKey,
  scannerTokenKey,
} from "@/components/scanner/tokenStorage";
import { db } from "@/lib/db";
import { useLanguage } from "@/lib/LanguageContext";
import { useRouter } from "@/i18n/navigation";
import { useEffect, useState } from "react";

type EventInfo = {
  id: string;
  name: string;
  date: string;
  venue?: string;
  kind: "concert" | "guestList";
};

function EventSelection({
  onSelect,
}: {
  onSelect: (event: EventInfo) => void;
}) {
  const { t } = useLanguage();
  const { isLoading, data } = db.useQuery({
    concerts: {
      $: { where: { status: "active" }, order: { createdAt: "desc" } },
    },
    guestListEvents: {
      $: { where: { status: "active" }, order: { createdAt: "desc" } },
    },
  });

  if (isLoading || !data) {
    return (
      <div className="animate-pulse text-muted text-center py-8">
        {t("scan.loadingEvents")}
      </div>
    );
  }

  const concerts = data.concerts ?? [];
  const guestListEvents = data.guestListEvents ?? [];

  if (concerts.length === 0 && guestListEvents.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted">{t("scan.noActiveEvents")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-center mb-4">
        {t("scan.selectEvent")}
      </h2>
      {concerts.map((c) => (
        <button
          key={c.id}
          onClick={() =>
            onSelect({
              id: c.id,
              name: c.name,
              date: c.date,
              venue: c.venue,
              kind: "concert",
            })
          }
          className="w-full text-left bg-surface border border-border rounded-xl p-4 hover:border-accent/50 hover:bg-surface-hover transition-colors"
        >
          <p className="font-semibold">{c.name}</p>
          <p className="text-sm text-muted mt-1">
            {c.date}
            {c.venue ? ` · ${c.venue}` : ""}
          </p>
        </button>
      ))}
      {guestListEvents.map((g) => (
        <button
          key={g.id}
          onClick={() =>
            onSelect({
              id: g.id,
              name: g.name,
              date: g.date,
              venue: g.venue,
              kind: "guestList",
            })
          }
          className="w-full text-left bg-surface border border-border rounded-xl p-4 hover:border-accent/50 hover:bg-surface-hover transition-colors"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold truncate">{g.name}</p>
              <p className="text-sm text-muted mt-1 truncate">
                {g.date}
                {g.venue ? ` · ${g.venue}` : ""}
              </p>
            </div>
            <span className="shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full bg-accent/15 text-accent-light uppercase tracking-wider">
              {t("guestList.badgeList")}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}

function deepLinkPath(event: EventInfo): string {
  return event.kind === "concert"
    ? `/scan/concert/${event.id}`
    : `/scan/guest-list/${event.id}`;
}

function findResumableEvent(): {
  id: string;
  kind: "concert" | "guestList";
} | null {
  if (typeof window === "undefined") return null;
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (!key) continue;
    const concertPrefix = "concertScannerToken:";
    const glPrefix = "glScannerToken:";
    let kind: "concert" | "guestList" | null = null;
    let id: string | null = null;
    if (key.startsWith(concertPrefix)) {
      kind = "concert";
      id = key.slice(concertPrefix.length);
    } else if (key.startsWith(glPrefix)) {
      kind = "guestList";
      id = key.slice(glPrefix.length);
    }
    if (!kind || !id) continue;
    const token = safeStorageGet(scannerTokenKey(kind, id));
    if (!token) continue;
    const exp = decodeTokenExp(token);
    if (!exp || exp < Date.now()) continue;
    const evRaw = safeStorageGet(scannerEventKey(kind, id));
    if (!evRaw) continue;
    return { id, kind };
  }
  return null;
}

export default function ScanHubPage() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const resumable = findResumableEvent();
    if (resumable) {
      router.replace(
        resumable.kind === "concert"
          ? `/scan/concert/${resumable.id}`
          : `/scan/guest-list/${resumable.id}`,
      );
      return;
    }
    setChecked(true);
  }, [router]);

  function handleSelect(event: EventInfo) {
    router.push(deepLinkPath(event));
  }

  return (
    <ScannerErrorBoundary>
      <div className="min-h-screen">
        <ScannerPageHeader />
        <main className="max-w-md mx-auto px-4 py-8">
          {checked ? <EventSelection onSelect={handleSelect} /> : null}
        </main>
      </div>
    </ScannerErrorBoundary>
  );
}
