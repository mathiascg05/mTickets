"use client";

import { db } from "@/lib/db";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";

const STORAGE_TOKEN_KEY = "scannerToken";
const STORAGE_CONCERT_KEY = "scannerConcert";

function extractOrderId(text: string): string | null {
  const urlMatch = text.match(/\/ticket\/([a-zA-Z0-9-]+)/);
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
    // Second tone for error (descending pattern)
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

type ConcertInfo = {
  id: string;
  name: string;
  date: string;
  venue?: string;
};

// ── State 1: Event Selection ────────────────────────────────────────────────

function EventSelection({
  onSelect,
}: {
  onSelect: (concert: ConcertInfo) => void;
}) {
  const { isLoading, data } = db.useQuery({
    concerts: {
      $: { where: { status: "active" }, order: { createdAt: "desc" } },
    },
  });

  if (isLoading || !data) {
    return <div className="animate-pulse text-muted text-center py-8">Loading events...</div>;
  }

  const concerts = data.concerts ?? [];

  if (concerts.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted">No active events found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-center mb-4">Select Event</h2>
      {concerts.map((c) => (
        <button
          key={c.id}
          onClick={() =>
            onSelect({ id: c.id, name: c.name, date: c.date, venue: c.venue })
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
    </div>
  );
}

// ── State 2: PIN Entry ──────────────────────────────────────────────────────

function PinEntry({
  concert,
  onAuthenticated,
  onBack,
}: {
  concert: ConcertInfo;
  onAuthenticated: (token: string, concert: ConcertInfo) => void;
  onBack: () => void;
}) {
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
      const res = await fetch("/api/verify-scanner-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ concertId: concert.id, pin }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Invalid PIN");
        setPin("");
        inputRef.current?.focus();
        return;
      }

      const data = await res.json();
      localStorage.setItem(STORAGE_TOKEN_KEY, data.token);
      localStorage.setItem(STORAGE_CONCERT_KEY, JSON.stringify(data.concert));
      onAuthenticated(data.token, data.concert);
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-lg font-semibold">{concert.name}</h2>
        <p className="text-sm text-muted mt-1">
          {concert.date}
          {concert.venue ? ` · ${concert.venue}` : ""}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-muted mb-2 text-center">
            Enter Scanner PIN
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
          {loading ? "Verifying..." : "Unlock Scanner"}
        </button>
      </form>

      <button
        onClick={onBack}
        className="w-full py-2 text-sm text-muted hover:text-foreground transition-colors"
      >
        Back to event list
      </button>
    </div>
  );
}

// ── Scanner View (QR camera) ────────────────────────────────────────────────

function ScannerView({ onScan }: { onScan: (orderId: string) => void }) {
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
          const orderId = extractOrderId(decodedText);
          if (orderId) {
            scanner.stop().catch(() => {});
            html5QrCodeRef.current = null;
            onScanRef.current(orderId);
          }
        },
        () => {},
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to start camera. Check camera permissions.",
      );
      html5QrCodeRef.current = null;
    } finally {
      setStarting(false);
    }
  }, []);

  // Auto-start scanner on mount
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
            {starting ? "Starting..." : "Retry Camera"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Ticket Info (scanned result) ────────────────────────────────────────────

function TicketInfo({
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
    return <div className="animate-pulse text-muted">Looking up ticket...</div>;
  }

  const order = data.orders[0];

  if (!order) {
    return (
      <div className="bg-danger/10 border border-danger/30 rounded-xl p-6 text-center">
        <p className="text-danger font-semibold text-lg">Ticket Not Found</p>
        <p className="text-muted text-sm mt-2">
          No ticket found with this ID.
        </p>
        <button
          onClick={onReset}
          className="mt-4 px-6 py-2 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium transition-colors"
        >
          Scan Again
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
        let msg = "Error al marcar entrada";
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
      setMarkError("Sin conexión. Intenta de nuevo.");
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
            Wrong Event
          </p>
          <p className="text-sm text-muted mt-1">
            This ticket is for <strong>{concert?.name || "another event"}</strong>, not the event you&apos;re scanning for.
          </p>
        </div>
      )}

      {!isApproved && (
        <div className="bg-danger/10 border border-danger/30 rounded-xl p-4 text-center">
          <p className="text-danger font-semibold">
            Not Approved
          </p>
          <p className="text-sm text-muted mt-1">
            This ticket has status: <strong>{order.status}</strong>
          </p>
        </div>
      )}

      {isVisited && !markSuccess && (
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 text-center">
          <p className="text-warning font-semibold">
            Already Scanned
          </p>
          <p className="text-sm text-muted mt-1">
            This ticket has already been used.
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
            ¡Entrada registrada!
          </p>
          <p className="text-sm text-muted mt-1">
            {order.firstName} {order.lastName} · {ticketType?.name || "Ticket"}
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
          <h3 className="text-xl font-bold">{concert?.name || "Event"}</h3>
          <p className="text-muted">{ticketType?.name || "Ticket"}</p>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm border-t border-border pt-4">
          <div>
            <p className="text-muted">Name</p>
            <p className="font-medium">{order.firstName} {order.lastName}</p>
          </div>
          <div>
            <p className="text-muted">Email</p>
            <p className="font-medium">{order.email}</p>
          </div>
          <div>
            <p className="text-muted">Cedula</p>
            <p className="font-medium">{order.cedula}</p>
          </div>
          <div>
            <p className="text-muted">Status</p>
            <p
              className={`font-medium ${isApproved ? "text-success" : "text-danger"}`}
            >
              {order.status}
            </p>
          </div>
          <div>
            <p className="text-muted">Visited</p>
            <p className="font-medium">{(isVisited || markSuccess) ? "Yes" : "No"}</p>
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
                {marking ? "Marking..." : "Mark as Visited"}
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
              Scan Again
            </button>
          </div>
        );
      })()}
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
  concertId,
  onSelect,
}: {
  concertId: string;
  onSelect: (orderId: string) => void;
}) {
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
    // First, allow direct UUID/URL lookup as before
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
    // If query is a raw UUID/URL but not in list, still let it through
    const direct = extractOrderId(trimmed) || (/^[a-f0-9-]{6,}$/i.test(trimmed) ? trimmed : null);
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
          placeholder="Nombre, cédula, # de orden o ID"
        />
        <button
          type="submit"
          disabled={!trimmed}
          className="px-4 py-2.5 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium transition-colors text-sm disabled:opacity-50"
        >
          Buscar
        </button>
      </form>

      {trimmed && results.length === 0 && (
        <p className="text-sm text-muted text-center py-2">
          Sin resultados para &ldquo;{trimmed}&rdquo;.
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
                    {o.cedula} · {o.ticketTypeName}
                    {o.orderNumber ? ` · ${o.orderNumber}` : ""}
                  </p>
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1">
                  {o.visited && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-warning/15 text-warning">
                      VISITED
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

// ── State 3: Authenticated Scanner ──────────────────────────────────────────

function AuthenticatedScanner({
  concert,
  scannerToken,
  onSwitchEvent,
}: {
  concert: ConcertInfo;
  scannerToken: string;
  onSwitchEvent: () => void;
}) {
  const [scannedOrderId, setScannedOrderId] = useState<string | null>(null);

  // Real-time counter: approved tickets / scanned
  const { data: countData } = db.useQuery({
    orders: {
      $: { where: { "ticketType.concert.id": concert.id } },
    },
  });
  const counts = useMemo(() => {
    const orders = countData?.orders ?? [];
    const approved = orders.filter((o) => o.status === "approved");
    const scanned = approved.filter((o) => o.visited);
    return { scanned: scanned.length, total: approved.length };
  }, [countData]);

  return (
    <div>
      <div className="bg-surface/50 border-b border-border px-4 py-3 flex items-center justify-between mb-6">
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate">{concert.name}</p>
          <p className="text-xs text-muted truncate">
            {concert.date}
            {concert.venue ? ` · ${concert.venue}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            <p className="text-base font-bold leading-none tabular-nums">
              {counts.scanned}
              <span className="text-muted font-normal">/{counts.total}</span>
            </p>
            <p className="text-[10px] uppercase tracking-widest text-muted mt-0.5">
              Entrados
            </p>
          </div>
          <button
            onClick={onSwitchEvent}
            className="text-xs text-accent-light hover:underline"
          >
            Switch
          </button>
        </div>
      </div>

      <h1 className="text-2xl font-bold text-center mb-6">
        Scan Ticket
      </h1>

      {scannedOrderId ? (
        <TicketInfo
          orderId={scannedOrderId}
          onReset={() => setScannedOrderId(null)}
          scannerToken={scannerToken}
          scopedConcertId={concert.id}
        />
      ) : (
        <div className="space-y-6">
          <ScannerView onScan={setScannedOrderId} />

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-background text-muted">
                o busca manualmente
              </span>
            </div>
          </div>

          <ManualSearch concertId={concert.id} onSelect={setScannedOrderId} />
        </div>
      )}
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function ScanPage() {
  const [selectedConcert, setSelectedConcert] = useState<ConcertInfo | null>(null);
  const [scannerToken, setScannerToken] = useState<string | null>(null);
  const [authenticatedConcert, setAuthenticatedConcert] = useState<ConcertInfo | null>(null);

  // Restore session on mount (localStorage + TTL validation)
  useEffect(() => {
    const token = localStorage.getItem(STORAGE_TOKEN_KEY);
    const concertStr = localStorage.getItem(STORAGE_CONCERT_KEY);
    if (!token || !concertStr) return;

    const exp = decodeTokenExp(token);
    if (!exp || exp < Date.now()) {
      localStorage.removeItem(STORAGE_TOKEN_KEY);
      localStorage.removeItem(STORAGE_CONCERT_KEY);
      return;
    }

    try {
      const concert = JSON.parse(concertStr) as ConcertInfo;
      setScannerToken(token);
      setAuthenticatedConcert(concert);
    } catch {
      localStorage.removeItem(STORAGE_TOKEN_KEY);
      localStorage.removeItem(STORAGE_CONCERT_KEY);
    }
  }, []);

  function handleAuthenticated(token: string, concert: ConcertInfo) {
    setScannerToken(token);
    setAuthenticatedConcert(concert);
  }

  function handleSwitchEvent() {
    localStorage.removeItem(STORAGE_TOKEN_KEY);
    localStorage.removeItem(STORAGE_CONCERT_KEY);
    setScannerToken(null);
    setAuthenticatedConcert(null);
    setSelectedConcert(null);
  }

  const isAuthenticated = scannerToken && authenticatedConcert;

  return (
    <div className="min-h-screen">
      <header className="bg-accent text-white sticky top-0 z-10 shadow-md">
        <div className="max-w-md mx-auto px-4 py-4 flex items-center justify-between">
          <span className="text-xl font-bold tracking-wide">ma<span className="text-white/60">Tickets</span></span>
          <span className="text-sm text-white/60">Scanner</span>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-8">
        {isAuthenticated ? (
          <AuthenticatedScanner
            concert={authenticatedConcert}
            scannerToken={scannerToken}
            onSwitchEvent={handleSwitchEvent}
          />
        ) : selectedConcert ? (
          <PinEntry
            concert={selectedConcert}
            onAuthenticated={handleAuthenticated}
            onBack={() => setSelectedConcert(null)}
          />
        ) : (
          <EventSelection onSelect={setSelectedConcert} />
        )}
      </main>
    </div>
  );
}
