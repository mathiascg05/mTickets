"use client";

import { useLanguage } from "@/lib/LanguageContext";
import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

const STORAGE_KEY = "guestListScannerToken";
const STORAGE_EVENT_KEY = "guestListScannerEvent";

function extractOrderId(text: string): string | null {
  const glMatch = text.match(/^gl:([a-f0-9-]{36})$/i);
  if (glMatch) return glMatch[1];
  const urlMatch = text.match(/\/guest-ticket\/([A-Za-z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  const uuidMatch = text.match(
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
  );
  if (uuidMatch) return uuidMatch[0];
  return null;
}

function feedback(kind: "success" | "error") {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(kind === "success" ? [80] : [80, 60, 80, 60, 80]);
  }
}

type EventInfo = { id: string; name: string; date: string; venue?: string };

export default function GuestListScannerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: eventId } = use(params);
  const { t } = useLanguage();
  const [token, setToken] = useState<string | null>(null);
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [scanResult, setScanResult] = useState<
    | { type: "success"; attendee: { firstName: string; lastName: string } }
    | { type: "error"; message: string }
    | null
  >(null);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    const ev = localStorage.getItem(STORAGE_EVENT_KEY);
    if (saved && ev) {
      try {
        const parsed = JSON.parse(ev) as EventInfo;
        if (parsed.id === eventId) {
          setToken(saved);
          setEvent(parsed);
        }
      } catch {}
    }
  }, [eventId]);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setVerifying(true);
    setError(null);
    try {
      const res = await fetch("/api/guest-list/verify-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, pin }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "Invalid PIN");
        setPin("");
        return;
      }
      localStorage.setItem(STORAGE_KEY, body.token);
      localStorage.setItem(STORAGE_EVENT_KEY, JSON.stringify(body.event));
      setToken(body.token);
      setEvent(body.event);
    } catch (err) {
      setError(String(err));
    } finally {
      setVerifying(false);
    }
  }

  async function handleScan(orderId: string) {
    if (!token) return;
    try {
      const res = await fetch("/api/guest-list/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, scannerToken: token }),
      });
      const body = await res.json();
      if (!res.ok) {
        feedback("error");
        setScanResult({
          type: "error",
          message:
            body.error === "ALREADY_SCANNED"
              ? t("guestList.scanAlready")
              : body.error === "TICKET_NOT_APPROVED"
                ? t("guestList.scanNotApproved")
                : body.error === "Wrong event"
                  ? t("guestList.scanWrongEvent")
                  : body.error || t("guestList.scanFailed"),
        });
      } else {
        feedback("success");
        setScanResult({ type: "success", attendee: body.attendee });
      }
    } catch (err) {
      feedback("error");
      setScanResult({ type: "error", message: String(err) });
    }
  }

  function reset() {
    setScanResult(null);
  }

  function logout() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_EVENT_KEY);
    setToken(null);
    setEvent(null);
  }

  if (!token || !event) {
    return (
      <div className="max-w-sm mx-auto py-8 space-y-6">
        <Link href={`/admin/guest-lists/${eventId}`} className="text-sm text-accent-light hover:underline">
          ← {t("common.back")}
        </Link>
        <h1 className="text-2xl font-bold text-center">{t("guestList.scannerTitle")}</h1>
        <form onSubmit={verify} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-muted mb-2 text-center">
              {t("scan.enterPin")}
            </label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="w-full px-4 py-4 bg-surface border border-border rounded-xl text-center font-mono text-3xl tracking-[0.5em]"
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
            disabled={pin.length < 4 || verifying}
            className="w-full py-3 bg-accent hover:bg-accent-dark text-white rounded-lg font-semibold transition-colors disabled:opacity-50"
          >
            {verifying ? t("scan.verifying") : t("scan.unlock")}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{event.name}</h1>
          <p className="text-xs text-muted">{event.date}{event.venue ? ` · ${event.venue}` : ""}</p>
        </div>
        <button onClick={logout} className="text-xs text-muted hover:text-foreground">
          {t("common.logout") || "Logout"}
        </button>
      </div>

      {scanResult ? (
        <ScanResult result={scanResult} onReset={reset} t={t} />
      ) : (
        <CameraScanner onScan={handleScan} t={t} />
      )}
    </div>
  );
}

function ScanResult({
  result,
  onReset,
  t,
}: {
  result: { type: "success"; attendee: { firstName: string; lastName: string } } | { type: "error"; message: string };
  onReset: () => void;
  t: (key: string) => string;
}) {
  const isSuccess = result.type === "success";
  return (
    <div
      className={`rounded-xl p-6 text-center border ${
        isSuccess
          ? "bg-success/10 border-success/30 text-success"
          : "bg-danger/10 border-danger/30 text-danger"
      }`}
    >
      <p className="text-3xl">{isSuccess ? "✓" : "✗"}</p>
      {isSuccess && result.type === "success" ? (
        <>
          <p className="text-lg font-semibold mt-2">{t("scan.welcome")}</p>
          <p className="text-2xl font-bold mt-1">
            {result.attendee.firstName} {result.attendee.lastName}
          </p>
        </>
      ) : (
        <p className="text-lg font-semibold mt-2">
          {result.type === "error" ? result.message : ""}
        </p>
      )}
      <button
        onClick={onReset}
        className="mt-4 px-6 py-2 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium"
      >
        {t("scan.scanAgain")}
      </button>
    </div>
  );
}

function CameraScanner({
  onScan,
  t,
}: {
  onScan: (id: string) => void;
  t: (key: string) => string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const scannerRef = useRef<import("html5-qrcode").Html5Qrcode | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const start = useCallback(async () => {
    if (scannerRef.current) return;
    setStarting(true);
    setError(null);
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const sc = new Html5Qrcode("gl-qr-reader");
      scannerRef.current = sc;
      await sc.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decoded) => {
          const id = extractOrderId(decoded);
          if (id) {
            sc.stop().catch(() => {});
            scannerRef.current = null;
            onScanRef.current(id);
          }
        },
        () => {},
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t("scan.failedCamera"));
      scannerRef.current = null;
    } finally {
      setStarting(false);
    }
  }, [t]);

  useEffect(() => {
    start();
    return () => {
      const sc = scannerRef.current;
      scannerRef.current = null;
      if (sc) sc.stop().catch(() => {});
    };
  }, [start]);

  return (
    <div className="space-y-3">
      <div
        id="gl-qr-reader"
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
