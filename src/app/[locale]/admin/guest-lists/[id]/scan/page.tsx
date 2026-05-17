"use client";

import { db } from "@/lib/db";
import { useLanguage } from "@/lib/LanguageContext";
import {
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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

// Distinct haptic + audio feedback for scanner outcomes.
// Vibration is Android-only; WebAudio works on iOS Safari.
function playFeedback(kind: "success" | "error") {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(kind === "success" ? [80] : [80, 60, 80, 60, 80]);
  }
  if (typeof window === "undefined") return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = kind === "success" ? 880 : 220;
    osc.type = "sine";
    osc.connect(gain).connect(ctx.destination);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
    if (kind === "error") {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.frequency.value = 165;
      osc2.type = "sine";
      osc2.connect(gain2).connect(ctx.destination);
      gain2.gain.setValueAtTime(0.001, ctx.currentTime + 0.18);
      gain2.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.2);
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
      osc2.start(ctx.currentTime + 0.18);
      osc2.stop(ctx.currentTime + 0.45);
    }
  } catch {}
}

type EventInfo = { id: string; name: string; date: string; venue?: string };

// ── PIN Entry ───────────────────────────────────────────────────────────────

function PinEntry({
  eventId,
  onAuthenticated,
}: {
  eventId: string;
  onAuthenticated: (token: string, event: EventInfo) => void;
}) {
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
      const res = await fetch("/api/guest-list/verify-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, pin }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || t("scan.invalidPin"));
        setPin("");
        inputRef.current?.focus();
        return;
      }
      localStorage.setItem(STORAGE_KEY, body.token);
      localStorage.setItem(STORAGE_EVENT_KEY, JSON.stringify(body.event));
      onAuthenticated(body.token, body.event);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto py-8 space-y-6">
      <Link
        href={`/admin/guest-lists/${eventId}`}
        className="text-sm text-accent-light hover:underline"
      >
        ← {t("common.back")}
      </Link>
      <h1 className="text-2xl font-bold text-center">
        {t("guestList.scannerTitle")}
      </h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-muted mb-2 text-center">
            {t("scan.enterPin")}
          </label>
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) =>
              setPin(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
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
          disabled={pin.length < 4 || loading}
          className="w-full py-3 bg-accent hover:bg-accent-dark text-white rounded-lg font-semibold transition-colors disabled:opacity-50"
        >
          {loading ? t("scan.verifying") : t("scan.unlock")}
        </button>
      </form>
    </div>
  );
}

// ── Camera ──────────────────────────────────────────────────────────────────

function CameraScanner({ onScan }: { onScan: (id: string) => void }) {
  const { t } = useLanguage();
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

// ── Ticket Info (after scan) ────────────────────────────────────────────────

function TicketInfo({
  orderId,
  onReset,
  scannerToken,
  scopedEventId,
}: {
  orderId: string;
  onReset: () => void;
  scannerToken: string;
  scopedEventId: string;
}) {
  const { t } = useLanguage();
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  const [markSuccess, setMarkSuccess] = useState(false);
  const { isLoading, data } = db.useQuery({
    guestListOrders: {
      $: { where: { id: orderId } },
      ticketType: {},
      entry: { event: {} },
    },
  });

  if (isLoading || !data) {
    return (
      <div className="animate-pulse text-muted">{t("scan.lookingUp")}</div>
    );
  }

  const order = data.guestListOrders[0];

  if (!order) {
    return (
      <div className="bg-danger/10 border border-danger/30 rounded-xl p-6 text-center">
        <p className="text-danger font-semibold text-lg">
          {t("scan.ticketNotFound")}
        </p>
        <p className="text-muted text-sm mt-2">
          {t("scan.ticketNotFoundDesc")}
        </p>
        <button
          onClick={onReset}
          className="mt-4 px-6 py-2 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium transition-colors"
        >
          {t("scan.scanAgain")}
        </button>
      </div>
    );
  }

  const ticketType = order.ticketType;
  const entry = order.entry;
  const event = entry?.event;
  const isWrongEvent = event?.id !== scopedEventId;

  async function markVisited() {
    setMarking(true);
    setMarkError(null);
    try {
      const res = await fetch("/api/guest-list/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, scannerToken }),
      });
      if (!res.ok) {
        let msg = t("scan.markFailed");
        try {
          const body = await res.json();
          if (body.error === "ALREADY_SCANNED") {
            msg = t("scan.alreadyScanned");
          } else if (body.error === "TICKET_NOT_APPROVED") {
            msg = t("scan.notApproved");
          } else if (body.error === "Wrong event") {
            msg = t("guestList.scanWrongEvent");
          } else if (body.error) {
            msg = body.error;
          }
        } catch {}
        setMarkError(msg);
        playFeedback("error");
        return;
      }
      setMarkSuccess(true);
      playFeedback("success");
    } catch {
      setMarkError(t("scan.offline"));
      playFeedback("error");
    } finally {
      setMarking(false);
    }
  }

  const isApproved = order.status === "approved";
  const isVisited = order.visited;
  const showMarkButton =
    isApproved && !isVisited && !isWrongEvent && !markSuccess;
  const scanAgainPrimary = !showMarkButton;

  return (
    <div className="space-y-4">
      {isWrongEvent && (
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 text-center">
          <p className="text-warning font-semibold">{t("scan.wrongEvent")}</p>
          <p className="text-sm text-muted mt-1">
            {t("scan.wrongEventDescBefore")}
            <strong>{event?.name || t("scan.anotherEvent")}</strong>
            {t("scan.wrongEventDescAfter")}
          </p>
        </div>
      )}

      {!isApproved && (
        <div className="bg-danger/10 border border-danger/30 rounded-xl p-4 text-center">
          <p className="text-danger font-semibold">{t("scan.notApproved")}</p>
          <p className="text-sm text-muted mt-1">
            {t("scan.notApprovedDescBefore")}
            <strong>{order.status}</strong>
          </p>
        </div>
      )}

      {isVisited && !markSuccess && (
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 text-center">
          <p className="text-warning font-semibold">
            {t("scan.alreadyScanned")}
          </p>
          <p className="text-sm text-muted mt-1">
            {t("scan.alreadyScannedDesc")}
          </p>
        </div>
      )}

      {markError && (
        <div className="bg-danger/10 border border-danger/30 rounded-xl p-4 text-center">
          <p className="text-danger font-semibold text-sm">{markError}</p>
        </div>
      )}

      {markSuccess && (
        <div className="bg-success/10 border border-success/30 rounded-xl p-4 text-center">
          <p className="text-success font-semibold">{t("scan.entrySuccess")}</p>
          <p className="text-sm text-muted mt-1">
            {order.firstName} {order.lastName}
            {ticketType?.name ? ` · ${ticketType.name}` : ""}
          </p>
        </div>
      )}

      <div className="bg-surface border border-border rounded-xl p-6">
        <div className="text-center mb-4">
          {(isApproved && !isVisited && !isWrongEvent) || markSuccess ? (
            <div className="text-5xl mb-2 text-success">{"✓"}</div>
          ) : null}
          {order.orderNumber && (
            <p className="text-sm font-mono font-bold text-accent-light tracking-wide mb-1">
              {order.orderNumber}
            </p>
          )}
          <h3 className="text-xl font-bold">
            {event?.name || t("scan.eventFallback")}
          </h3>
          {ticketType?.name && (
            <p className="text-muted">{ticketType.name}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm border-t border-border pt-4">
          <div>
            <p className="text-muted">{t("scan.fieldName")}</p>
            <p className="font-medium">
              {order.firstName} {order.lastName}
            </p>
          </div>
          <div>
            <p className="text-muted">{t("scan.fieldEmail")}</p>
            <p className="font-medium">{order.email}</p>
          </div>
          {order.cedula && (
            <div>
              <p className="text-muted">{t("scan.fieldCedula")}</p>
              <p className="font-medium">{order.cedula}</p>
            </div>
          )}
          <div>
            <p className="text-muted">{t("scan.fieldStatus")}</p>
            <p
              className={`font-medium ${isApproved ? "text-success" : "text-danger"}`}
            >
              {order.status}
            </p>
          </div>
          <div>
            <p className="text-muted">{t("scan.fieldVisited")}</p>
            <p className="font-medium">
              {isVisited || markSuccess ? t("scan.yes") : t("scan.no")}
            </p>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        {showMarkButton && (
          <button
            onClick={markVisited}
            disabled={marking}
            className="flex-1 py-3 bg-success hover:bg-success/80 text-white rounded-lg font-semibold transition-colors disabled:opacity-50"
          >
            {marking ? t("scan.marking") : t("scan.markVisited")}
          </button>
        )}
        <button
          onClick={onReset}
          className={`flex-1 py-3 rounded-lg font-semibold transition-colors ${
            scanAgainPrimary
              ? "bg-accent hover:bg-accent-dark text-white"
              : "border border-border hover:bg-surface-hover"
          }`}
        >
          {t("scan.scanAgain")}
        </button>
      </div>
    </div>
  );
}

// ── Manual Search ───────────────────────────────────────────────────────────

type SearchableOrder = {
  id: string;
  firstName?: string;
  lastName?: string;
  cedula?: string;
  orderNumber?: string;
  status?: string;
  visited?: boolean;
  ticketTypeName?: string;
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function ManualSearch({
  eventId,
  onSelect,
}: {
  eventId: string;
  onSelect: (orderId: string) => void;
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");

  const { data } = db.useQuery({
    guestListOrders: {
      $: { where: { "entry.event.id": eventId } },
      ticketType: {},
    },
  });

  const allOrders: SearchableOrder[] = useMemo(() => {
    const orders = data?.guestListOrders ?? [];
    return orders.map((o) => ({
      id: o.id,
      firstName: o.firstName,
      lastName: o.lastName,
      cedula: o.cedula,
      orderNumber: o.orderNumber ?? undefined,
      status: o.status,
      visited: o.visited,
      ticketTypeName: o.ticketType?.name,
    }));
  }, [data]);

  const trimmed = query.trim();
  const results: SearchableOrder[] = useMemo(() => {
    if (!trimmed) return [];
    const direct = extractOrderId(trimmed);
    if (direct) {
      const hit = allOrders.find((o) => o.id === direct);
      if (hit) return [hit];
    }
    const q = normalize(trimmed);
    return allOrders
      .filter((o) => {
        const name = normalize(`${o.firstName ?? ""} ${o.lastName ?? ""}`);
        const cedula = normalize(o.cedula ?? "");
        const orderNum = normalize(o.orderNumber ?? "");
        return name.includes(q) || cedula.includes(q) || orderNum.includes(q);
      })
      .slice(0, 10);
  }, [allOrders, trimmed]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (results.length === 1) {
      onSelect(results[0].id);
      setQuery("");
      return;
    }
    const direct =
      extractOrderId(trimmed) ||
      (/^[a-f0-9-]{6,}$/i.test(trimmed) ? trimmed : null);
    if (direct && results.length === 0) {
      onSelect(direct);
      setQuery("");
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 px-4 py-2.5 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
          placeholder={t("scan.searchPlaceholder")}
        />
        <button
          type="submit"
          disabled={!trimmed}
          className="px-4 py-2.5 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium transition-colors text-sm disabled:opacity-50"
        >
          {t("scan.search")}
        </button>
      </form>

      {trimmed && results.length === 0 && (
        <p className="text-sm text-muted text-center py-2">
          {t("scan.noResults", { query: trimmed })}
        </p>
      )}

      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((o) => (
            <button
              key={o.id}
              onClick={() => {
                onSelect(o.id);
                setQuery("");
              }}
              className="w-full text-left bg-surface border border-border rounded-lg p-3 hover:border-accent/50 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">
                    {o.firstName} {o.lastName}
                  </p>
                  <p className="text-xs text-muted truncate">
                    {o.cedula}
                    {o.ticketTypeName ? ` · ${o.ticketTypeName}` : ""}
                    {o.orderNumber ? ` · ${o.orderNumber}` : ""}
                  </p>
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1">
                  {o.visited && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-warning/15 text-warning">
                      {t("scan.badgeVisited")}
                    </span>
                  )}
                  {o.status && o.status !== "approved" && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-danger/15 text-danger uppercase">
                      {o.status}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Authenticated Scanner ───────────────────────────────────────────────────

function AuthenticatedScanner({
  event,
  scannerToken,
  onLogout,
}: {
  event: EventInfo;
  scannerToken: string;
  onLogout: () => void;
}) {
  const { t } = useLanguage();
  const [scannedOrderId, setScannedOrderId] = useState<string | null>(null);

  const { data: countData } = db.useQuery({
    guestListOrders: {
      $: { where: { "entry.event.id": event.id } },
    },
  });
  const counts = useMemo(() => {
    const orders = countData?.guestListOrders ?? [];
    const approved = orders.filter((o) => o.status === "approved");
    const scanned = approved.filter((o) => o.visited);
    return { scanned: scanned.length, total: approved.length };
  }, [countData]);

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
          <button
            onClick={onLogout}
            className="text-xs text-accent-light hover:underline"
          >
            {t("common.logout") || "Logout"}
          </button>
        </div>
      </div>

      <h1 className="text-2xl font-bold text-center mb-6">
        {t("scan.scanTicket")}
      </h1>

      {scannedOrderId ? (
        <TicketInfo
          orderId={scannedOrderId}
          onReset={() => setScannedOrderId(null)}
          scannerToken={scannerToken}
          scopedEventId={event.id}
        />
      ) : (
        <div className="space-y-6">
          <CameraScanner onScan={setScannedOrderId} />

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

          <ManualSearch eventId={event.id} onSelect={setScannedOrderId} />
        </div>
      )}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function GuestListScannerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: eventId } = use(params);
  const [token, setToken] = useState<string | null>(null);
  const [event, setEvent] = useState<EventInfo | null>(null);

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

  function logout() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_EVENT_KEY);
    setToken(null);
    setEvent(null);
  }

  if (!token || !event) {
    return (
      <PinEntry
        eventId={eventId}
        onAuthenticated={(tok, ev) => {
          setToken(tok);
          setEvent(ev);
        }}
      />
    );
  }

  return (
    <div className="max-w-md mx-auto py-6">
      <AuthenticatedScanner
        event={event}
        scannerToken={token}
        onLogout={logout}
      />
    </div>
  );
}
