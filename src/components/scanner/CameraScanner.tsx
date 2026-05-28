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

// RangeCameraCapability isn't re-exported from the package root, so derive
// it from the publicly exported CameraCapabilities type.
type ZoomFeature = ReturnType<
  import("html5-qrcode").CameraCapabilities["zoomFeature"]
>;

type ZoomState =
  | { supported: false }
  | { supported: true; min: number; max: number; value: number };

// Visible zoom step. Device step() is often a tiny value (e.g. 0.1) that
// would make the +/- buttons feel unresponsive, so we use a coarser step
// and clamp to the device range. apply() accepts any value within range.
const ZOOM_STEP = 0.5;
// Default zoom applied on start (when supported). Holding the phone farther
// than the iPhone ~20cm minimum focus distance while the QR still fills the
// frame is what lets it actually focus on close-range screen-to-screen scans.
const DEFAULT_ZOOM = 2;

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
  const [zoom, setZoom] = useState<ZoomState>({ supported: false });
  const scannerRef = useRef<import("html5-qrcode").Html5Qrcode | null>(null);
  const zoomRef = useRef<ZoomFeature | null>(null);
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
    setZoom({ supported: false });
    zoomRef.current = null;
    let sc: import("html5-qrcode").Html5Qrcode | null = null;
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      // Native BarcodeDetector is far faster than the JS ZXing fallback on
      // browsers that support it (Chrome/Android); a no-op on iOS Safari.
      sc = new Html5Qrcode(readerIdRef.current, {
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        verbose: false,
      });
      scannerRef.current = sc;
      await sc.start(
        {
          // Higher capture resolution lets the decoder read the QR from a
          // greater (focusable) distance and from slightly soft frames.
          // focusMode:continuous nudges Android autofocus; ignored on iOS.
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          advanced: [
            { focusMode: "continuous" },
          ] as unknown as MediaTrackConstraintSet[],
        },
        {
          fps: 10,
          // Adaptive box (~70% of the shorter side) keeps a generous decode
          // region now that the frame is higher resolution.
          qrbox: (vw, vh) => {
            const m = Math.floor(Math.min(vw, vh) * 0.7);
            return { width: m, height: m };
          },
        },
        (decoded) => {
          const id = extractRef.current(decoded);
          if (id) {
            safeStopScanner(scannerRef.current);
            scannerRef.current = null;
            zoomRef.current = null;
            startedRef.current = false;
            onScanRef.current(id);
          }
        },
        () => {},
      );
      startedRef.current = true;

      // Apply a sensible default zoom + expose manual controls where the
      // platform supports it (iOS Safari 17+, Android). Graceful no-op
      // otherwise — controls simply won't render.
      try {
        const zf = sc.getRunningTrackCameraCapabilities().zoomFeature();
        if (zf.isSupported() && zf.max() > zf.min()) {
          zoomRef.current = zf;
          const min = zf.min();
          const max = zf.max();
          const target = Math.min(max, Math.max(min, DEFAULT_ZOOM));
          await zf.apply(target);
          setZoom({ supported: true, min, max, value: target });
        }
      } catch {
        // zoom not available on this device — leave it unsupported
      }
    } catch (err) {
      if (typeof console !== "undefined") console.error("[camera start]", err);
      setError(
        err instanceof Error ? err.message : tRef.current("scan.failedCamera"),
      );
      if (startedRef.current) safeStopScanner(sc);
      scannerRef.current = null;
      zoomRef.current = null;
      startedRef.current = false;
      setZoom({ supported: false });
    } finally {
      setStarting(false);
    }
  }, []);

  const adjustZoom = useCallback((delta: number) => {
    const zf = zoomRef.current;
    if (!zf) return;
    setZoom((z) => {
      if (!z.supported) return z;
      const next =
        Math.round(Math.min(z.max, Math.max(z.min, z.value + delta)) * 100) /
        100;
      if (next === z.value) return z;
      // Idempotent apply — safe even if React invokes this updater twice.
      void zf.apply(next).catch(() => {});
      return { ...z, value: next };
    });
  }, []);

  useEffect(() => {
    start();
    return () => {
      const sc = scannerRef.current;
      const wasStarted = startedRef.current;
      scannerRef.current = null;
      zoomRef.current = null;
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

      {zoom.supported && (
        <div className="flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => adjustZoom(-ZOOM_STEP)}
            disabled={zoom.value <= zoom.min}
            aria-label={t("scan.zoomOut")}
            className="w-11 h-11 rounded-full bg-surface border border-border text-xl font-bold leading-none disabled:opacity-40"
          >
            −
          </button>
          <span className="text-xs text-muted tabular-nums min-w-16 text-center">
            {t("scan.zoomLabel")} {zoom.value.toFixed(1)}×
          </span>
          <button
            type="button"
            onClick={() => adjustZoom(ZOOM_STEP)}
            disabled={zoom.value >= zoom.max}
            aria-label={t("scan.zoomIn")}
            className="w-11 h-11 rounded-full bg-surface border border-border text-xl font-bold leading-none disabled:opacity-40"
          >
            +
          </button>
        </div>
      )}

      <p className="text-xs text-muted text-center">{t("scan.focusHint")}</p>

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
