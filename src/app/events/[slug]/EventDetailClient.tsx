"use client";

import EventTheme from "@/components/EventTheme";
import { db } from "@/lib/db";
import { getAvailability, getTodayString } from "@/lib/phases";
import type { Phase } from "@/lib/phases";
import { QUEUE_THRESHOLD } from "@/lib/queueConstants";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, useCallback } from "react";

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function EventDetailClient() {
  const params = useParams();
  const slugParam = params.slug as string;

  const { isLoading, error, data } = db.useQuery({
    concerts: {
      $: { where: { slug: slugParam } },
      ticketTypes: {
        orders: {
          $: { where: { or: [{ status: "approved" }, { status: "pending" }] } },
        },
        phases: {
          $: { order: { sortOrder: "asc" } },
        },
        reservations: {},
        queueEntries: {},
      },
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-danger">Error: {error.message}</div>
      </div>
    );
  }

  const concert = data.concerts[0];
  if (!concert) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted">Event not found</div>
      </div>
    );
  }

  return (
    <EventTheme concert={concert}>
    <div className="min-h-screen">
      <header className="bg-accent text-white sticky top-0 z-10 shadow-md">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          {concert.logoUrl ? (
            <img src={concert.logoUrl} alt={concert.name} className="h-8 w-auto object-contain" />
          ) : (
            <span className="text-xl font-bold tracking-wide">ma<span className="text-white/60">Tickets</span></span>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
        <div className="bg-surface border border-border rounded-2xl overflow-hidden shadow-lg">
          {concert.flyerUrl ? (
            <div className="relative max-h-[480px] overflow-hidden bg-black/90">
              {/* Blurred background fill */}
              <img
                src={concert.flyerUrl}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl opacity-60"
              />
              {/* Sharp centered image */}
              <img
                src={concert.flyerUrl}
                alt={concert.name}
                className="relative w-full max-h-[480px] object-contain"
              />
            </div>
          ) : (
            <div className="h-48 bg-gradient-to-br from-accent-dark via-accent to-accent-light flex items-center justify-center relative">
              <span className="text-7xl opacity-20 relative z-10">{"\uD83C\uDFB5"}</span>
            </div>
          )}

          <div className="p-6 sm:p-8">
            <h1 className="text-3xl sm:text-4xl font-bold mb-4">
              {concert.name}
            </h1>

            <div className="flex flex-wrap gap-4 text-muted mb-6">
              <div className="flex items-center gap-2">
                <span>{"\uD83D\uDCC5"}</span>
                <span>{formatDate(concert.date)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span>{"\uD83D\uDCCD"}</span>
                <span>{concert.venue}</span>
              </div>
            </div>

            <p className="text-foreground/80 leading-relaxed mb-8 whitespace-pre-wrap">
              {concert.description}
            </p>

            <h2 className="text-2xl font-semibold mb-4">Tickets</h2>

            {concert.ticketTypes.filter((tt) => tt.visibility !== "hidden").length === 0 ? (
              <p className="text-muted">
                No tickets available for this event yet.
              </p>
            ) : (
              <div className="space-y-4">
                {concert.ticketTypes
                  .filter((tt) => tt.visibility !== "hidden")
                  .map((ticketType) => (
                  <TicketTypeRow
                    key={ticketType.id}
                    ticketType={ticketType}
                  />
                ))}
              </div>
            )}

            <FindMyTickets concertId={concert.id} />
          </div>
        </div>
      </main>
    </div>
    </EventTheme>
  );
}

function TicketTypeRow({
  ticketType,
}: {
  ticketType: {
    id: string;
    name: string;
    price: number;
    quantity: number;
    description?: string;
    visibility?: string;
    hideAvailability?: boolean;
    orders: { id: string; status: string; phaseId?: string }[];
    phases: Phase[];
    reservations: { id: string; quantity: number; expiresAt: number; phaseId?: string }[];
    queueEntries: { id: string; status: string; expiresAt: number }[];
  };
}) {
  const [qty, setQty] = useState(1);

  const now = Date.now();
  const today = getTodayString();
  const activeReservations = (ticketType.reservations || []).filter(
    (r) => r.expiresAt > now,
  );
  const availability = getAvailability(ticketType, ticketType.phases || [], ticketType.orders, today, activeReservations);
  const { price, available, totalCapacity, activePhase } = availability;
  const soldOut = ticketType.visibility === "soldOutOverride" || availability.soldOut;
  const maxQty = Math.min(available, 5);

  // Queue detection
  const queueEntries = ticketType.queueEntries || [];
  const activeWaiters = queueEntries.filter(
    (e) => e.status === "waiting" && e.expiresAt > now,
  ).length;
  const admittedEntries = queueEntries.filter(
    (e) => e.status === "admitted" && e.expiresAt > now,
  ).length;
  const activeBuyers = activeReservations.length + admittedEntries;
  const queueActive = activeBuyers >= QUEUE_THRESHOLD || activeWaiters > 0;

  const basePath = queueActive
    ? `/queue/${ticketType.id}`
    : `/buy/${ticketType.id}`;
  const buyHref = activePhase
    ? `${basePath}?qty=${qty}&phaseId=${activePhase.id}`
    : `${basePath}?qty=${qty}`;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 border border-border rounded-xl hover:border-accent/40 transition-colors">
      <div className="flex-1">
        <h3 className="font-semibold text-lg">{ticketType.name}</h3>
        {activePhase && (
          <p className="text-xs font-medium text-accent-light mt-0.5">
            {activePhase.name}
          </p>
        )}
        {ticketType.description && (
          <p className="text-muted text-sm mt-1">{ticketType.description}</p>
        )}
        {ticketType.visibility !== "soldOutOverride" && !ticketType.hideAvailability && (
          <p className="text-sm text-muted mt-1">
            {available} of {totalCapacity} available
          </p>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-2xl font-bold text-accent-light">
          ${price.toFixed(2)}
        </span>
        {soldOut ? (
          <span className="px-4 py-2 bg-muted/20 text-muted rounded-lg font-medium">
            Agotado
          </span>
        ) : (
          <>
            <select
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              className="px-3 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
            >
              {Array.from({ length: maxQty }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <Link
              href={buyHref}
              className="px-6 py-2.5 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium transition-colors shadow-lg shadow-accent/20"
            >
              Buy
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

type OrderSummary = {
  id: string;
  orderNumber: string | null;
  firstName: string;
  lastName: string;
  status: string;
  ticketTypeName: string;
  createdAt: number;
};

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-yellow-100 text-yellow-800" },
  approved: { label: "Approved", className: "bg-green-100 text-green-800" },
  rejected: { label: "Rejected", className: "bg-red-100 text-red-800" },
  cancelled: { label: "Cancelled", className: "bg-gray-100 text-gray-500" },
};

function FindMyTickets({ concertId }: { concertId: string }) {
  const [email, setEmail] = useState("");
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resendCooldowns, setResendCooldowns] = useState<Record<string, number>>({});

  const handleLookup = useCallback(async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    setLoading(true);
    setError("");
    setOrders(null);
    try {
      const res = await fetch("/api/lookup-tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, concertId }),
      });
      if (res.status === 429) {
        setError("Too many requests. Please wait a moment and try again.");
        return;
      }
      const data = await res.json();
      setOrders(data.orders ?? []);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [email, concertId]);

  const handleResend = useCallback(async (orderId: string) => {
    const trimmed = email.trim().toLowerCase();
    setResendCooldowns((prev) => ({ ...prev, [orderId]: Date.now() + 60_000 }));
    try {
      const res = await fetch("/api/resend-ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, email: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to resend ticket.");
        setResendCooldowns((prev) => {
          const next = { ...prev };
          delete next[orderId];
          return next;
        });
      }
    } catch {
      setError("Failed to resend ticket.");
      setResendCooldowns((prev) => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
    }
  }, [email]);

  const isOnCooldown = (orderId: string) => {
    const until = resendCooldowns[orderId];
    return until ? Date.now() < until : false;
  };

  return (
    <div className="border-t border-border mt-10 pt-8">
      <h2 className="text-2xl font-semibold mb-2">Find My Tickets</h2>
      <p className="text-muted text-sm mb-4">
        Lost your confirmation email? Enter your email to look up your orders.
      </p>

      <div className="flex gap-3">
        <input
          type="email"
          placeholder="your@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleLookup()}
          className="flex-1 px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
        />
        <button
          onClick={handleLookup}
          disabled={loading || !email.trim()}
          className="px-6 py-2.5 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          {loading ? "Looking up..." : "Look Up"}
        </button>
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-500">{error}</p>
      )}

      {orders !== null && orders.length === 0 && (
        <p className="mt-4 text-sm text-muted">
          No orders found for this email.
        </p>
      )}

      {orders !== null && orders.length > 0 && (
        <div className="mt-4 space-y-3">
          {orders.map((order) => {
            const badge = STATUS_BADGES[order.status] ?? STATUS_BADGES.pending;
            const cooldown = isOnCooldown(order.id);
            return (
              <div
                key={order.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border border-border rounded-xl"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {order.orderNumber && (
                      <span className="font-mono text-sm font-semibold">
                        {order.orderNumber}
                      </span>
                    )}
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badge.className}`}>
                      {badge.label}
                    </span>
                  </div>
                  <p className="text-sm text-muted mt-1">
                    {order.firstName} {order.lastName} &middot; {order.ticketTypeName}
                  </p>
                </div>
                {order.status === "approved" && (
                  <button
                    onClick={() => handleResend(order.id)}
                    disabled={cooldown}
                    className="px-4 py-2 text-sm font-medium bg-accent/10 text-accent rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                  >
                    {cooldown ? "Sent!" : "Resend Email"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
