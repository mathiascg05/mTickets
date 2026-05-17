"use client";

import { db } from "@/lib/db";
import { useLanguage } from "@/lib/LanguageContext";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";

const STORAGE_TOKEN_KEY = "scannerToken";
const STORAGE_EVENT_KEY = "scannerEvent";

function extractConcertOrderId(text: string): string | null {
  const urlMatch = text.match(/\/ticket\/([a-zA-Z0-9-]+)/);
  if (urlMatch) return urlMatch[1];
  const uuidMatch = text.match(
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
  );
  if (uuidMatch) return uuidMatch[0];
  return null;
}

function extractGuestOrderId(text: string): string | null {
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

function decodeTokenExp(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    const b64 = parts[0].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded));
    if (typeof payload.exp === "number") return payload.exp;
  } catch {}
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
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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

type EventInfo = {
  id: string;
  name: string;
  date: string;
  venue?: string;
  kind: "concert" | "guestList";
};

// ── State 1: Event Selection ────────────────────────────────────────────────

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
    return <div className="animate-pulse text-muted text-center py-8">{t("scan.loadingEvents")}</div>;
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
      <h2 className="text-lg font-semibold text-center mb-4">{t("scan.selectEvent")}</h2>
      {concerts.map((c) => (
        <button
          key={c.id}
          onClick={() =>
            onSelect({ id: c.id, name: c.name, date: c.date, venue: c.venue, kind: "concert" })
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
            onSelect({ id: g.id, name: g.name, date: g.date, venue: g.venue, kind: "guestList" })
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

// ── State 2: PIN Entry ──────────────────────────────────────────────────────

function PinEntry({
  event,
  onAuthenticated,
  onBack,
}: {
  event: EventInfo;
  onAuthenticated: (token: string, event: EventInfo) => void;
  onBack: () => void;
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
      const endpoint =
        event.kind === "concert"
          ? "/api/verify-scanner-pin"
          : "/api/guest-list/verify-pin";
      const body =
        event.kind === "concert"
          ? { concertId: event.id, pin }
          : { eventId: event.id, pin };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || t("scan.invalidPin"));
        setPin("");
        inputRef.current?.focus();
        return;
      }

      const data = await res.json();
      const eventInfo: EventInfo = {
        id: event.id,
        name: data.concert?.name ?? data.event?.name ?? event.name,
        date: data.concert?.date ?? data.event?.date ?? event.date,
        venue: data.concert?.venue ?? data.event?.venue ?? event.venue,
        kind: event.kind,
      };
      localStorage.setItem(STORAGE_TOKEN_KEY, data.token);
      localStorage.setItem(STORAGE_EVENT_KEY, JSON.stringify(eventInfo));
      onAuthenticated(data.token, eventInfo);
    } catch {
      setError(t("scan.connectionError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-lg font-semibold">{event.name}</h2>
        <p className="text-sm text-muted mt-1">
          {event.date}
          {event.venue ? ` · ${event.venue}` : ""}
        </p>
      </div>

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
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
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

      <button
        onClick={onBack}
        className="w-full py-2 text-sm text-muted hover:text-foreground transition-colors"
      >
        {t("scan.backToEventList")}
      </button>
    </div>
  );
}

// ── Scanner View (QR camera) ────────────────────────────────────────────────

function ScannerView({ onScan }: { onScan: (text: string) => void }) {
  const { t } = useLanguage();
  const scannerRef = useRef<HTMLDivElement>(null);
  const html5QrCodeRef = useRef<import("html5-qrcode").Html5Qrcode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const startScanner = useCallback(async () => {
    if (html5QrCodeRef.current || !scannerRef.current) return;
    setStarting(true);
    setError(null);
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode("qr-reader");
      html5QrCodeRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          scanner.stop().catch(() => {});
          html5QrCodeRef.current = null;
          onScanRef.current(decodedText);
        },
        () => {},
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("scan.failedCamera"),
      );
      html5QrCodeRef.current = null;
    } finally {
      setStarting(false);
    }
  }, [t]);

  useEffect(() => {
    startScanner();
    return () => {
      const scanner = html5QrCodeRef.current;
      html5QrCodeRef.current = null;
      if (scanner) {
        scanner.stop().catch(() => {});
      }
    };
  }, [startScanner]);

  return (
    <div className="space-y-4">
      <div
        id="qr-reader"
        ref={scannerRef}
        className="w-full max-w-sm mx-auto rounded-xl overflow-hidden bg-black/20"
        style={{ minHeight: "260px" }}
      />

      {error && (
        <div className="space-y-3">
          <div className="text-danger text-sm bg-danger/10 border border-danger/30 rounded-lg p-3 text-center">
            {error}
          </div>
          <button
            onClick={startScanner}
            disabled={starting}
            className="w-full py-3 bg-accent hover:bg-accent-dark text-white rounded-lg font-semibold transition-colors disabled:opacity-50"
          >
            {starting ? t("scan.starting") : t("scan.retryCamera")}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Concert Ticket Info (uses db.useQuery — orders are publicly viewable) ──

function ConcertTicketInfo({
  orderId,
  onReset,
  scannerToken,
  scopedConcertId,
}: {
  orderId: string;
  onReset: () => void;
  scannerToken: string;
  scopedConcertId: string;
}) {
  const { t } = useLanguage();
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  const [markSuccess, setMarkSuccess] = useState(false);
  const { isLoading, data } = db.useQuery({
    orders: {
      $: { where: { id: orderId } },
      ticketType: {
        concert: {},
      },
    },
  });

  if (isLoading || !data) {
    return <div className="animate-pulse text-muted">{t("scan.lookingUp")}</div>;
  }

  const order = data.orders[0];

  if (!order) {
    return (
      <div className="bg-danger/10 border border-danger/30 rounded-xl p-6 text-center">
        <p className="text-danger font-semibold text-lg">{t("scan.ticketNotFound")}</p>
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
  const concert = ticketType?.concert;
  const isWrongEvent = concert?.id !== scopedConcertId;

  async function markVisited() {
    setMarking(true);
    setMarkError(null);
    try {
      const res = await fetch("/api/mark-visited", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, scannerToken }),
      });
      if (!res.ok) {
        let msg = t("scan.markFailed");
        try {
          const data = await res.json();
          msg = data.error || msg;
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

  return (
    <div className="space-y-4">
      {isWrongEvent && (
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 text-center">
          <p className="text-warning font-semibold">
            {t("scan.wrongEvent")}
          </p>
          <p className="text-sm text-muted mt-1">
            {t("scan.wrongEventDescBefore")}<strong>{concert?.name || t("scan.anotherEvent")}</strong>{t("scan.wrongEventDescAfter")}
          </p>
        </div>
      )}

      {!isApproved && (
        <div className="bg-danger/10 border border-danger/30 rounded-xl p-4 text-center">
          <p className="text-danger font-semibold">
            {t("scan.notApproved")}
          </p>
          <p className="text-sm text-muted mt-1">
            {t("scan.notApprovedDescBefore")}<strong>{order.status}</strong>
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
          <p className="text-success font-semibold">
            {t("scan.entrySuccess")}
          </p>
          <p className="text-sm text-muted mt-1">
            {order.firstName} {order.lastName} · {ticketType?.name || t("scan.ticketFallback")}
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
          <h3 className="text-xl font-bold">{concert?.name || t("scan.eventFallback")}</h3>
          <p className="text-muted">{ticketType?.name || t("scan.ticketFallback")}</p>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm border-t border-border pt-4">
          <div>
            <p className="text-muted">{t("scan.fieldName")}</p>
            <p className="font-medium">{order.firstName} {order.lastName}</p>
          </div>
          <div>
            <p className="text-muted">{t("scan.fieldEmail")}</p>
            <p className="font-medium">{order.email}</p>
          </div>
          <div>
            <p className="text-muted">{t("scan.fieldCedula")}</p>
            <p className="font-medium">{order.cedula}</p>
          </div>
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
            <p className="font-medium">{(isVisited || markSuccess) ? t("scan.yes") : t("scan.no")}</p>
          </div>
        </div>
      </div>

      {(() => {
        const showMarkButton = isApproved && !isVisited && !isWrongEvent && !markSuccess;
        const scanAgainPrimary = !showMarkButton;
        return (
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
        );
      })()}
    </div>
  );
}

// ── Concert Manual Search ───────────────────────────────────────────────────

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

function ConcertManualSearch({
  concertId,
  onSelect,
}: {
  concertId: string;
  onSelect: (orderId: string) => void;
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");

  const { data } = db.useQuery({
    concerts: {
      $: { where: { id: concertId } },
      ticketTypes: {
        orders: {},
      },
    },
  });

  const allOrders: SearchableOrder[] = useMemo(() => {
    const concert = data?.concerts?.[0];
    if (!concert) return [];
    return concert.ticketTypes.flatMap((tt) =>
      tt.orders.map((o) => ({
        id: o.id,
        firstName: o.firstName,
        lastName: o.lastName,
        cedula: o.cedula,
        orderNumber: o.orderNumber ?? undefined,
        status: o.status,
        visited: o.visited,
        ticketTypeName: tt.name,
      })),
    );
  }, [data]);

  const trimmed = query.trim();
  const results: SearchableOrder[] = useMemo(() => {
    if (!trimmed) return [];
    const direct = extractConcertOrderId(trimmed);
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
    const direct = extractConcertOrderId(trimmed) || (/^[a-f0-9-]{6,}$/i.test(trimmed) ? trimmed : null);
    if (direct && results.length === 0) {
      onSelect(direct);
      setQuery("");
    }
  }

  return (
    <SearchUI
      query={query}
      setQuery={setQuery}
      handleSubmit={handleSubmit}
      results={results}
      trimmed={trimmed}
      onSelect={onSelect}
      t={t}
    />
  );
}

function SearchUI({
  query,
  setQuery,
  handleSubmit,
  results,
  trimmed,
  onSelect,
  t,
}: {
  query: string;
  setQuery: (s: string) => void;
  handleSubmit: (e: React.FormEvent) => void;
  results: SearchableOrder[];
  trimmed: string;
  onSelect: (orderId: string) => void;
  t: (k: string, p?: Record<string, string | number>) => string;
}) {
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

// ── Concert Authenticated Scanner ───────────────────────────────────────────

function ConcertAuthenticatedScanner({
  event,
  scannerToken,
}: {
  event: EventInfo;
  scannerToken: string;
}) {
  const { t } = useLanguage();
  const [scannedOrderId, setScannedOrderId] = useState<string | null>(null);

  const { data: countData } = db.useQuery({
    orders: {
      $: { where: { "ticketType.concert.id": event.id } },
    },
  });
  const counts = useMemo(() => {
    const orders = countData?.orders ?? [];
    const approved = orders.filter((o) => o.status === "approved");
    const scanned = approved.filter((o) => o.visited);
    return { scanned: scanned.length, total: approved.length };
  }, [countData]);

  return (
    <ScannerShell
      event={event}
      counts={counts}
      scannedContent={
        scannedOrderId ? (
          <ConcertTicketInfo
            orderId={scannedOrderId}
            onReset={() => setScannedOrderId(null)}
            scannerToken={scannerToken}
            scopedConcertId={event.id}
          />
        ) : null
      }
      onScannerRead={(decoded) => {
        const id = extractConcertOrderId(decoded);
        if (id) setScannedOrderId(id);
      }}
      manualSearch={<ConcertManualSearch concertId={event.id} onSelect={setScannedOrderId} />}
    />
  );
}

// ── Guest List Ticket Info ──────────────────────────────────────────────────

type GuestOrder = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  cedula: string;
  status: string;
  visited: boolean;
  visitedAt: number | null;
  orderNumber: string | null;
  ticketType: { id: string; name: string } | null;
};

function GuestListTicketInfo({
  order,
  onReset,
  scannerToken,
  onMarked,
}: {
  order: GuestOrder | undefined;
  onReset: () => void;
  scannerToken: string;
  onMarked: () => void;
}) {
  const { t } = useLanguage();
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  const [markSuccess, setMarkSuccess] = useState(false);

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

  async function markVisited() {
    if (!order) return;
    setMarking(true);
    setMarkError(null);
    try {
      const res = await fetch("/api/guest-list/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id, scannerToken }),
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
      onMarked();
    } catch {
      setMarkError(t("scan.offline"));
      playFeedback("error");
    } finally {
      setMarking(false);
    }
  }

  const isApproved = order.status === "approved";
  const isVisited = order.visited;
  const showMarkButton = isApproved && !isVisited && !markSuccess;
  const scanAgainPrimary = !showMarkButton;

  return (
    <div className="space-y-4">
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
            {order.ticketType?.name ? ` · ${order.ticketType.name}` : ""}
          </p>
        </div>
      )}

      <div className="bg-surface border border-border rounded-xl p-6">
        <div className="text-center mb-4">
          {(isApproved && !isVisited) || markSuccess ? (
            <div className="text-5xl mb-2 text-success">{"✓"}</div>
          ) : null}
          {order.orderNumber && (
            <p className="text-sm font-mono font-bold text-accent-light tracking-wide mb-1">
              {order.orderNumber}
            </p>
          )}
          {order.ticketType?.name && (
            <p className="text-muted">{order.ticketType.name}</p>
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

// ── Guest List Manual Search ────────────────────────────────────────────────

function GuestListManualSearch({
  orders,
  onSelect,
}: {
  orders: GuestOrder[];
  onSelect: (orderId: string) => void;
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");

  const trimmed = query.trim();
  const results: SearchableOrder[] = useMemo(() => {
    if (!trimmed) return [];
    const direct = extractGuestOrderId(trimmed);
    if (direct) {
      const hit = orders.find((o) => o.id === direct);
      if (hit) {
        return [{
          id: hit.id,
          firstName: hit.firstName,
          lastName: hit.lastName,
          cedula: hit.cedula,
          orderNumber: hit.orderNumber ?? undefined,
          status: hit.status,
          visited: hit.visited,
          ticketTypeName: hit.ticketType?.name,
        }];
      }
    }
    const q = normalize(trimmed);
    return orders
      .filter((o) => {
        const name = normalize(`${o.firstName ?? ""} ${o.lastName ?? ""}`);
        const cedula = normalize(o.cedula ?? "");
        const orderNum = normalize(o.orderNumber ?? "");
        return name.includes(q) || cedula.includes(q) || orderNum.includes(q);
      })
      .slice(0, 10)
      .map((o) => ({
        id: o.id,
        firstName: o.firstName,
        lastName: o.lastName,
        cedula: o.cedula,
        orderNumber: o.orderNumber ?? undefined,
        status: o.status,
        visited: o.visited,
        ticketTypeName: o.ticketType?.name,
      }));
  }, [orders, trimmed]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (results.length === 1) {
      onSelect(results[0].id);
      setQuery("");
      return;
    }
    const direct =
      extractGuestOrderId(trimmed) ||
      (/^[a-f0-9-]{6,}$/i.test(trimmed) ? trimmed : null);
    if (direct && results.length === 0) {
      onSelect(direct);
      setQuery("");
    }
  }

  return (
    <SearchUI
      query={query}
      setQuery={setQuery}
      handleSubmit={handleSubmit}
      results={results}
      trimmed={trimmed}
      onSelect={onSelect}
      t={t}
    />
  );
}

// ── Guest List Authenticated Scanner ────────────────────────────────────────

function GuestListAuthenticatedScanner({
  event,
  scannerToken,
  onUnauthorized,
}: {
  event: EventInfo;
  scannerToken: string;
  onUnauthorized: () => void;
}) {
  const { t } = useLanguage();
  const [scannedOrderId, setScannedOrderId] = useState<string | null>(null);
  const [orders, setOrders] = useState<GuestOrder[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/guest-list/scan/data", {
        headers: { Authorization: `Bearer ${scannerToken}` },
      });
      if (!res.ok) {
        if (res.status === 401) {
          onUnauthorized();
          return;
        }
        setLoadError(t("scan.connectionError"));
        return;
      }
      const body = await res.json();
      setOrders(body.orders ?? []);
      setLoadError(null);
    } catch {
      setLoadError(t("scan.connectionError"));
    }
  }, [scannerToken, onUnauthorized, t]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const counts = useMemo(() => {
    const approved = orders.filter((o) => o.status === "approved");
    const scanned = approved.filter((o) => o.visited);
    return { scanned: scanned.length, total: approved.length };
  }, [orders]);

  const selectedOrder = scannedOrderId
    ? orders.find((o) => o.id === scannedOrderId)
    : undefined;

  return (
    <ScannerShell
      event={event}
      counts={counts}
      loadError={loadError}
      scannedContent={
        scannedOrderId ? (
          <GuestListTicketInfo
            order={selectedOrder}
            onReset={() => setScannedOrderId(null)}
            scannerToken={scannerToken}
            onMarked={() => {
              fetchData();
            }}
          />
        ) : null
      }
      onScannerRead={(decoded) => {
        const id = extractGuestOrderId(decoded);
        if (id) setScannedOrderId(id);
      }}
      manualSearch={<GuestListManualSearch orders={orders} onSelect={setScannedOrderId} />}
    />
  );
}

// ── Shared Scanner Shell (header + camera + manual search) ──────────────────

function ScannerShell({
  event,
  counts,
  scannedContent,
  onScannerRead,
  manualSearch,
  loadError,
}: {
  event: EventInfo;
  counts: { scanned: number; total: number };
  scannedContent: React.ReactNode;
  onScannerRead: (decoded: string) => void;
  manualSearch: React.ReactNode;
  loadError?: string | null;
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
          <ScannerView onScan={onScannerRead} />

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

// ── Main Page ───────────────────────────────────────────────────────────────

export default function ScanPage() {
  const { t } = useLanguage();
  const [selectedEvent, setSelectedEvent] = useState<EventInfo | null>(null);
  const [scannerToken, setScannerToken] = useState<string | null>(null);
  const [authenticatedEvent, setAuthenticatedEvent] = useState<EventInfo | null>(null);

  // Restore session on mount (localStorage + TTL validation)
  useEffect(() => {
    const token = localStorage.getItem(STORAGE_TOKEN_KEY);
    const eventStr = localStorage.getItem(STORAGE_EVENT_KEY);
    if (!token || !eventStr) return;

    const exp = decodeTokenExp(token);
    if (!exp || exp < Date.now()) {
      localStorage.removeItem(STORAGE_TOKEN_KEY);
      localStorage.removeItem(STORAGE_EVENT_KEY);
      return;
    }

    try {
      const event = JSON.parse(eventStr) as EventInfo;
      if (!event.kind) return;
      setScannerToken(token);
      setAuthenticatedEvent(event);
    } catch {
      localStorage.removeItem(STORAGE_TOKEN_KEY);
      localStorage.removeItem(STORAGE_EVENT_KEY);
    }
  }, []);

  function handleAuthenticated(token: string, event: EventInfo) {
    setScannerToken(token);
    setAuthenticatedEvent(event);
  }

  function handleSwitchEvent() {
    localStorage.removeItem(STORAGE_TOKEN_KEY);
    localStorage.removeItem(STORAGE_EVENT_KEY);
    setScannerToken(null);
    setAuthenticatedEvent(null);
    setSelectedEvent(null);
  }

  const isAuthenticated = scannerToken && authenticatedEvent;

  return (
    <div className="min-h-screen">
      <header className="bg-accent text-white sticky top-0 z-10 shadow-md">
        <div className="max-w-md mx-auto px-4 py-4 flex items-center justify-between">
          <span className="text-xl font-bold tracking-wide">ma<span className="text-white/60">Tickets</span></span>
          <div className="flex items-center gap-3">
            {isAuthenticated && (
              <button
                onClick={handleSwitchEvent}
                className="text-xs text-white/70 hover:text-white underline"
              >
                {t("scan.headerSwitch")}
              </button>
            )}
            <span className="text-sm text-white/60">{t("scan.scannerHeader")}</span>
          </div>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-8">
        {isAuthenticated ? (
          authenticatedEvent.kind === "concert" ? (
            <ConcertAuthenticatedScanner
              event={authenticatedEvent}
              scannerToken={scannerToken}
            />
          ) : (
            <GuestListAuthenticatedScanner
              event={authenticatedEvent}
              scannerToken={scannerToken}
              onUnauthorized={handleSwitchEvent}
            />
          )
        ) : selectedEvent ? (
          <PinEntry
            event={selectedEvent}
            onAuthenticated={handleAuthenticated}
            onBack={() => setSelectedEvent(null)}
          />
        ) : (
          <EventSelection onSelect={setSelectedEvent} />
        )}
      </main>
    </div>
  );
}
