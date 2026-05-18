"use client";

import { ConcertAuthenticatedScanner } from "@/components/scanner/concert/ConcertAuthenticatedScanner";
import { PinEntry, type ScannerEventInfo } from "@/components/scanner/PinEntry";
import { ScannerErrorBoundary } from "@/components/scanner/ScannerErrorBoundary";
import { ScannerPageHeader } from "@/components/scanner/ScannerShell";
import {
  decodeTokenExp,
  safeStorageGet,
  safeStorageRemove,
  scannerEventKey,
  scannerTokenKey,
} from "@/components/scanner/tokenStorage";
import { use, useEffect, useState } from "react";

export default function ConcertScannerDeepLinkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: concertId } = use(params);
  const [token, setToken] = useState<string | null>(null);
  const [event, setEvent] = useState<ScannerEventInfo | null>(null);

  useEffect(() => {
    try {
      const tokenKey = scannerTokenKey("concert", concertId);
      const eventStorageKey = scannerEventKey("concert", concertId);
      const saved = safeStorageGet(tokenKey);
      const ev = safeStorageGet(eventStorageKey);
      if (!saved || !ev) return;
      const exp = decodeTokenExp(saved);
      if (!exp || exp < Date.now()) {
        safeStorageRemove(tokenKey);
        safeStorageRemove(eventStorageKey);
        return;
      }
      const parsed = JSON.parse(ev) as ScannerEventInfo;
      if (parsed && parsed.id === concertId) {
        setToken(saved);
        setEvent(parsed);
      }
    } catch (err) {
      if (typeof console !== "undefined")
        console.error("[scanner restore]", err);
    }
  }, [concertId]);

  function logout() {
    safeStorageRemove(scannerTokenKey("concert", concertId));
    safeStorageRemove(scannerEventKey("concert", concertId));
    setToken(null);
    setEvent(null);
  }

  return (
    <ScannerErrorBoundary>
      <div className="min-h-screen">
        <ScannerPageHeader onSwitchEvent={token ? logout : undefined} />
        <main className="max-w-md mx-auto px-4 py-8">
          {!token || !event ? (
            <PinEntry
              eventId={concertId}
              kind="concert"
              onAuthenticated={(tok, ev) => {
                setToken(tok);
                setEvent(ev);
              }}
            />
          ) : (
            <ConcertAuthenticatedScanner
              event={event}
              scannerToken={token}
              onLogout={logout}
            />
          )}
        </main>
      </div>
    </ScannerErrorBoundary>
  );
}
