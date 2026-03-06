"use client";

import { db } from "@/lib/db";
import { useEffect, useRef, useState, useCallback } from "react";

function extractOrderId(text: string): string | null {
  const urlMatch = text.match(/\/ticket\/([a-zA-Z0-9-]+)/);
  if (urlMatch) return urlMatch[1];
  const uuidMatch = text.match(
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
  );
  if (uuidMatch) return uuidMatch[0];
  return null;
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
      sessionStorage.setItem("scannerToken", data.token);
      sessionStorage.setItem("scannerConcert", JSON.stringify(data.concert));
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
  const [scanning, setScanning] = useState(false);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const startScanner = useCallback(async () => {
    if (html5QrCodeRef.current || !scannerRef.current) return;

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
            setScanning(false);
            onScanRef.current(orderId);
          }
        },
        () => {},
      );
      setScanning(true);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to start camera",
      );
    }
  }, []);

  useEffect(() => {
    return () => {
      if (html5QrCodeRef.current) {
        html5QrCodeRef.current.stop().catch(() => {});
        html5QrCodeRef.current = null;
      }
    };
  }, []);

  return (
    <div className="space-y-4">
      <div
        id="qr-reader"
        ref={scannerRef}
        className="w-full max-w-sm mx-auto rounded-xl overflow-hidden bg-black/20"
        style={{ minHeight: scanning ? undefined : "100px" }}
      />

      {error && (
        <div className="text-danger text-sm bg-danger/10 border border-danger/30 rounded-lg p-3 text-center">
          {error}
        </div>
      )}

      {!scanning && (
        <button
          onClick={startScanner}
          className="w-full py-3 bg-accent hover:bg-accent-dark text-white rounded-lg font-semibold transition-colors shadow-lg shadow-accent/20"
        >
          Start Scanner
        </button>
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
    try {
      await fetch("/api/mark-visited", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, scannerToken }),
      });
    } catch (err) {
      console.error("Failed to mark visited:", err);
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

      {isVisited && (
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 text-center">
          <p className="text-warning font-semibold">
            Already Scanned
          </p>
          <p className="text-sm text-muted mt-1">
            This ticket has already been used.
          </p>
        </div>
      )}

      <div className="bg-surface border border-border rounded-xl p-6">
        <div className="text-center mb-4">
          {isApproved && !isVisited && !isWrongEvent ? (
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
            <p className="font-medium">{isVisited ? "Yes" : "No"}</p>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        {isApproved && !isVisited && !isWrongEvent && (
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
          className="flex-1 py-3 border border-border rounded-lg font-semibold hover:bg-surface-hover transition-colors"
        >
          Scan Again
        </button>
      </div>
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
  const [manualId, setManualId] = useState("");

  function handleManualLookup(e: React.FormEvent) {
    e.preventDefault();
    const orderId = extractOrderId(manualId) || manualId.trim();
    if (orderId) {
      setScannedOrderId(orderId);
      setManualId("");
    }
  }

  return (
    <div>
      <div className="bg-surface/50 border-b border-border px-4 py-3 flex items-center justify-between mb-6">
        <div>
          <p className="font-semibold text-sm">{concert.name}</p>
          <p className="text-xs text-muted">{concert.date}{concert.venue ? ` · ${concert.venue}` : ""}</p>
        </div>
        <button
          onClick={onSwitchEvent}
          className="text-xs text-accent-light hover:underline"
        >
          Switch Event
        </button>
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
                or enter manually
              </span>
            </div>
          </div>

          <form onSubmit={handleManualLookup} className="flex gap-2">
            <input
              value={manualId}
              onChange={(e) => setManualId(e.target.value)}
              className="flex-1 px-4 py-2.5 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
              placeholder="Order ID or ticket URL"
            />
            <button
              type="submit"
              className="px-4 py-2.5 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium transition-colors text-sm"
            >
              Look Up
            </button>
          </form>
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

  // Restore session on mount
  useEffect(() => {
    const token = sessionStorage.getItem("scannerToken");
    const concertStr = sessionStorage.getItem("scannerConcert");
    if (token && concertStr) {
      try {
        const concert = JSON.parse(concertStr) as ConcertInfo;
        setScannerToken(token);
        setAuthenticatedConcert(concert);
      } catch {
        sessionStorage.removeItem("scannerToken");
        sessionStorage.removeItem("scannerConcert");
      }
    }
  }, []);

  function handleAuthenticated(token: string, concert: ConcertInfo) {
    setScannerToken(token);
    setAuthenticatedConcert(concert);
  }

  function handleSwitchEvent() {
    sessionStorage.removeItem("scannerToken");
    sessionStorage.removeItem("scannerConcert");
    setScannerToken(null);
    setAuthenticatedConcert(null);
    setSelectedConcert(null);
  }

  // Determine which state to show
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
