"use client";

import { useLanguage } from "@/lib/LanguageContext";
import type { ReactNode } from "react";
import type { ScannerEventInfo } from "./PinEntry";

export function ScannerShell({
  event,
  counts,
  scannedContent,
  cameraSlot,
  manualSearch,
  loadError,
  onLogout,
}: {
  event: ScannerEventInfo;
  counts: { scanned: number; total: number };
  scannedContent: ReactNode;
  cameraSlot: ReactNode;
  manualSearch: ReactNode;
  loadError?: string | null;
  onLogout?: () => void;
}) {
  const { t } = useLanguage();

  return (
    <div>
      <div className="bg-surface/50 border-b border-border px-4 py-3 flex items-center justify-between mb-6 rounded-xl">
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate">{event.name}</p>
          <p className="text-xs text-muted truncate">
            {event.date}
            {event.venue ? ` · ${event.venue}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            <p className="text-base font-bold leading-none tabular-nums">
              {counts.scanned}
              <span className="text-muted font-normal">/{counts.total}</span>
            </p>
            <p className="text-[10px] uppercase tracking-widest text-muted mt-0.5">
              {t("scan.headerEntered")}
            </p>
          </div>
          {onLogout && (
            <button
              onClick={onLogout}
              className="text-xs text-accent-light hover:underline"
            >
              {t("admin.signOut")}
            </button>
          )}
        </div>
      </div>

      {loadError && (
        <div className="text-danger text-sm bg-danger/10 border border-danger/30 rounded-lg p-3 text-center mb-4">
          {loadError}
        </div>
      )}

      <h1 className="text-2xl font-bold text-center mb-6">
        {t("scan.scanTicket")}
      </h1>

      {scannedContent ? (
        scannedContent
      ) : (
        <div className="space-y-6">
          {cameraSlot}

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-background text-muted">
                {t("scan.orSearchManually")}
              </span>
            </div>
          </div>

          {manualSearch}
        </div>
      )}
    </div>
  );
}

export function ScannerPageHeader({
  onSwitchEvent,
}: {
  onSwitchEvent?: () => void;
}) {
  const { t } = useLanguage();
  return (
    <header className="bg-accent text-white sticky top-0 z-10 shadow-md">
      <div className="max-w-md mx-auto px-4 py-4 flex items-center justify-between">
        <span className="text-xl font-bold tracking-wide">
          ma<span className="text-white/60">Tickets</span>
        </span>
        <div className="flex items-center gap-3">
          {onSwitchEvent && (
            <button
              onClick={onSwitchEvent}
              className="text-xs text-white/70 hover:text-white underline"
            >
              {t("scan.headerSwitch")}
            </button>
          )}
          <span className="text-sm text-white/60">
            {t("scan.scannerHeader")}
          </span>
        </div>
      </div>
    </header>
  );
}
