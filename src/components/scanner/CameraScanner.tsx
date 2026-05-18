"use client";

import { useLanguage } from "@/lib/LanguageContext";
import { useCallback, useEffect, useRef, useState } from "react";

// html5-qrcode's stop() throws synchronously when the scanner is not
// running (instead of returning a rejected promise). Wrap both the
// sync throw and async rejection so a failed start (denied camera, in-
// app webview without getUserMedia, etc.) doesn't bubble up.
function safeStopScanner(
  sc: import("html5-qrcode").Html5Qrcode | null,
): void {
  if (!sc) return;
  try {
    const p = sc.stop();
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch {
    // ignore — scanner was never running
  }
}

export function CameraScanner({
  onScan,
  extractOrderId,
  readerId = "qr-reader",
}: {
  onScan: (id: string) => void;
  extractOrderId: (decoded: string) => string | null;
}  & { readerId?: string }) {
  const { t } = useLanguage();
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const scannerRef = useRef<import("html5-qrcode").Html5Qrcode | null>(null);
  const startedRef = useRef(false);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const extractRef = useRef(extractOrderId);
  extractRef.current = extractOrderId;
  // Capture `t` in a ref so the `start` callback below stays stable
  // across renders. Without this, `useLanguage` returns a fresh `t`
  // function on every render, which would invalidate `useCallback`,
  // which would invalidate the auto-start `useEffect` — turning a
  // single camera failure into an infinite retry loop (visible as the
  // error message flickering on and off).
  const tRef = useRef(t);
  tRef.current = t;
  const readerIdRef = useRef(readerId);
  readerIdRef.current = readerId;

  const start = useCallback(async () => {
    if (scannerRef.current) return;
    setStarting(true);
    setError(null);
    let sc: import("html5-qrcode").Html5Qrcode | null = null;
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      sc = new Html5Qrcode(readerIdRef.current);
      scannerRef.current = sc;
      await sc.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decoded) => {
          const id = extractRef.current(decoded);
          if (id) {
            safeStopScanner(scannerRef.current);
            scannerRef.current = null;
            startedRef.current = false;
            onScanRef.current(id);
          }
        },
        () => {},
      );
      startedRef.current = true;
    } catch (err) {
      if (typeof console !== "undefined") console.error("[camera start]", err);
      setError(
        err instanceof Error ? err.message : tRef.current("scan.failedCamera"),
      );
      if (startedRef.current) safeStopScanner(sc);
      scannerRef.current = null;
      startedRef.current = false;
    } finally {
      setStarting(false);
    }
  }, []);

  useEffect(() => {
    start();
    return () => {
      const sc = scannerRef.current;
      const wasStarted = startedRef.current;
      scannerRef.current = null;
      startedRef.current = false;
      if (wasStarted) safeStopScanner(sc);
    };
  }, [start]);

  return (
    <div className="space-y-3">
      <div
        id={readerId}
        className="w-full max-w-sm mx-auto rounded-xl overflow-hidden bg-black/20"
        style={{ minHeight: "260px" }}
      />
      {error && (
        <div className="space-y-2">
          <div className="text-danger text-sm bg-danger/10 border border-danger/30 rounded-lg p-3 text-center">
            {error}
          </div>
          <button
            onClick={start}
            disabled={starting}
            className="w-full py-3 bg-accent hover:bg-accent-dark text-white rounded-lg font-semibold disabled:opacity-50"
          >
            {starting ? t("scan.starting") : t("scan.retryCamera")}
          </button>
        </div>
      )}
    </div>
  );
}
