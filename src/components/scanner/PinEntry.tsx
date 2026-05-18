"use client";

import { useLanguage } from "@/lib/LanguageContext";
import { useEffect, useRef, useState } from "react";
import {
  safeStorageSet,
  scannerEventKey,
  scannerTokenKey,
  type EventKind,
} from "./tokenStorage";

export type ScannerEventInfo = {
  id: string;
  name: string;
  date: string;
  venue?: string;
};

type Props = {
  eventId: string;
  kind: EventKind;
  fallbackEvent?: ScannerEventInfo;
  onAuthenticated: (token: string, event: ScannerEventInfo) => void;
  onBack?: () => void;
  showTitle?: boolean;
};

export function PinEntry({
  eventId,
  kind,
  fallbackEvent,
  onAuthenticated,
  onBack,
  showTitle = true,
}: Props) {
  const { t } = useLanguage();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pin.length < 4) return;
    setLoading(true);
    setError(null);
    try {
      const endpoint =
        kind === "concert"
          ? "/api/verify-scanner-pin"
          : "/api/guest-list/verify-pin";
      const body =
        kind === "concert"
          ? { concertId: eventId, pin }
          : { eventId, pin };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || t("scan.invalidPin"));
        setPin("");
        inputRef.current?.focus();
        return;
      }
      const eventInfo: ScannerEventInfo = {
        id: eventId,
        name: data.concert?.name ?? data.event?.name ?? fallbackEvent?.name ?? "",
        date: data.concert?.date ?? data.event?.date ?? fallbackEvent?.date ?? "",
        venue: data.concert?.venue ?? data.event?.venue ?? fallbackEvent?.venue,
      };
      safeStorageSet(scannerTokenKey(kind, eventId), data.token);
      safeStorageSet(scannerEventKey(kind, eventId), JSON.stringify(eventInfo));
      onAuthenticated(data.token, eventInfo);
    } catch (err) {
      if (typeof console !== "undefined") console.error("[PIN submit]", err);
      setError(t("scan.connectionError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto py-8 space-y-6">
      {showTitle && (
        <h1 className="text-2xl font-bold text-center">
          {kind === "guestList"
            ? t("guestList.scannerTitle")
            : t("scan.scannerHeader")}
        </h1>
      )}
      {fallbackEvent && (
        <div className="text-center">
          <p className="font-semibold text-lg">{fallbackEvent.name}</p>
          <p className="text-sm text-muted mt-1">
            {fallbackEvent.date}
            {fallbackEvent.venue ? ` · ${fallbackEvent.venue}` : ""}
          </p>
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-muted mb-2 text-center">
            {t("scan.enterPin")}
          </label>
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={pin}
            onChange={(e) =>
              setPin(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            className="w-full px-4 py-4 bg-surface border border-border rounded-xl focus:outline-none focus:border-accent-light transition-colors text-center font-mono text-3xl tracking-[0.5em]"
            placeholder="····"
          />
        </div>
        {error && (
          <div className="text-danger text-sm bg-danger/10 border border-danger/30 rounded-lg p-3 text-center">
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={pin.length < 4 || loading}
          className="w-full py-3 bg-accent hover:bg-accent-dark text-white rounded-lg font-semibold transition-colors disabled:opacity-50"
        >
          {loading ? t("scan.verifying") : t("scan.unlock")}
        </button>
      </form>
      {onBack && (
        <button
          onClick={onBack}
          className="w-full py-2 text-sm text-muted hover:text-foreground transition-colors"
        >
          {t("scan.backToEventList")}
        </button>
      )}
    </div>
  );
}
