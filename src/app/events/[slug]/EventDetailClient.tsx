"use client";

import EventTheme from "@/components/EventTheme";
import { db } from "@/lib/db";
import { useStorageUrl } from "@/lib/useStorageUrl";
import { useLanguage, LanguageToggle } from "@/lib/LanguageContext";
import { getAvailability, getTodayString } from "@/lib/phases";
import type { Phase } from "@/lib/phases";
import { QUEUE_THRESHOLD } from "@/lib/queueConstants";
import { isAuthorizedForConcert } from "@/lib/authHelpers";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, useCallback } from "react";
import emailSpellChecker from "@zootools/email-spell-checker";

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function EventPresence({ concertId }: { concertId: string }) {
  const room = db.room("eventPage", concertId);
  db.rooms.usePresence(room, {
    peers: [],
    user: false,
    initialPresence: { joinedAt: Date.now() },
  });
  return null;
}

export default function EventDetailClient() {
  const params = useParams();
  const slugParam = params.slug as string;
  const { t } = useLanguage();

  const { user } = db.useAuth();
  const userEmail = user?.email ?? "";

  const { isLoading, error, data } = db.useQuery({
    concerts: {
      $: { where: { slug: slugParam } },
      collaborators: {},
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

  const flyerUrl = useStorageUrl(data?.concerts[0]?.flyerPath);
  const logoUrl = useStorageUrl(data?.concerts[0]?.logoPath);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted">{t("common.loading")}</div>
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
        <div className="text-muted">{t("event.notFound")}</div>
      </div>
    );
  }

  const isAuthorized = userEmail
    ? isAuthorizedForConcert(userEmail, {
        organizerEmail: concert.organizerEmail,
        collaborators: concert.collaborators,
      })
    : false;
  const isDraft = concert.status !== "active";

  if (isDraft && !isAuthorized) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-semibold mb-2">{t("event.unavailableTitle")}</h1>
          <p className="text-muted">{t("event.unavailableBody")}</p>
        </div>
      </div>
    );
  }

  return (
    <EventTheme concert={concert}>
    <EventPresence concertId={concert.id} />
    <div className="min-h-screen">
      {isDraft && isAuthorized && (
        <div className="bg-yellow-100 border-b border-yellow-300 text-yellow-900 text-sm px-4 py-2 text-center">
          {t("event.draftPreview")}
        </div>
      )}
      <header className="bg-accent/95 backdrop-blur-sm text-white sticky top-0 z-10 border-b border-white/10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl font-bold tracking-wide">ma<span className="text-white/50">Tickets</span></span>
            {logoUrl && (
              <>
                <span className="text-white/30">|</span>
                <img src={logoUrl} alt={concert.name} className="h-10 w-auto object-contain" />
              </>
            )}
          </div>
          <LanguageToggle className="border-white/20 text-white/70 hover:text-white" />
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
        <div className="bg-surface border border-border rounded-xl overflow-hidden shadow-sm">
          {concert.flyerPath ? (
            <div className="relative max-h-[480px] overflow-hidden bg-black/90">
              {flyerUrl && (
                <>
                  {/* Blurred background fill */}
                  <img
                    src={flyerUrl}
                    alt=""
                    aria-hidden="true"
                    className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl opacity-60"
                  />
                  {/* Sharp centered image */}
                  <img
                    src={flyerUrl}
                    alt={concert.name}
                    className="relative w-full max-h-[480px] object-contain"
                  />
                </>
              )}
            </div>
          ) : (
            <div className="h-48 bg-gradient-to-br from-accent-dark via-accent to-accent-light flex items-center justify-center relative">
              <span className="text-7xl opacity-20 relative z-10">{"\uD83C\uDFB5"}</span>
            </div>
          )}

          <div className="p-6 sm:p-8">
            <h1 className="text-3xl sm:text-4xl font-bold mb-5 tracking-tight font-heading">
              {concert.name}
            </h1>

            <div className="flex flex-wrap gap-6 mb-6">
              <div>
                <p className="text-[11px] font-medium text-muted uppercase tracking-widest mb-0.5">{t("common.date")}</p>
                <p className="text-sm text-foreground">{formatDate(concert.date)}</p>
              </div>
              {concert.venue && (
                <div>
                  <p className="text-[11px] font-medium text-muted uppercase tracking-widest mb-0.5">{t("common.venue")}</p>
                  {concert.venueMapUrl ? (
                    <a href={concert.venueMapUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-accent-light hover:underline inline-flex items-center gap-1">
                      {concert.venue}
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                    </a>
                  ) : (
                    <p className="text-sm text-foreground">{concert.venue}</p>
                  )}
                </div>
              )}
            </div>

            <p className="text-foreground/80 leading-relaxed mb-10 whitespace-pre-wrap">
              {concert.description}
            </p>

            <h2 className="text-2xl font-semibold mb-5 font-heading tracking-tight">{t("event.tickets")}</h2>

            {concert.ticketTypes.filter((tt) => tt.visibility !== "hidden").length === 0 ? (
              <p className="text-muted">
                {t("event.noTickets")}
              </p>
            ) : (
              <div className="space-y-3">
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
            <ContactOrganizer concertId={concert.id} />
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
  const { t } = useLanguage();

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
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 border border-border rounded-lg hover:border-accent/30 hover:shadow-sm transition-all">
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
            {t("event.availableOf", { available, total: totalCapacity })}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <span className="text-2xl font-bold text-accent-light">
            ${price.toFixed(2)}
          </span>
          {((ticketType as { feePercent?: number }).feePercent ?? 0) > 0 ||
          ((ticketType as { feeFixed?: number }).feeFixed ?? 0) > 0 ? (
            <p className="text-[11px] text-muted">{t("event.serviceFee")}</p>
          ) : null}
        </div>
        {soldOut ? (
          <span className="px-4 py-2 text-xs font-semibold uppercase tracking-widest text-muted bg-muted/10 border border-muted/20 rounded-md">
            {t("common.soldOut")}
          </span>
        ) : (
          <>
            <select
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              className="px-3 py-2.5 bg-background border border-border rounded-md focus:outline-none focus:border-accent-light transition-colors text-sm"
            >
              {Array.from({ length: maxQty }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <Link
              href={buyHref}
              className="px-6 py-2.5 bg-accent hover:bg-accent-dark text-white rounded-md font-medium text-sm uppercase tracking-wider transition-colors"
            >
              {t("common.buy")}
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

const STATUS_BADGES: Record<string, { labelKey: string; className: string }> = {
  pending: { labelKey: "common.pending", className: "bg-yellow-100 text-yellow-800" },
  approved: { labelKey: "common.approved", className: "bg-green-100 text-green-800" },
  rejected: { labelKey: "common.rejected", className: "bg-red-100 text-red-800" },
  cancelled: { labelKey: "common.cancelled", className: "bg-gray-100 text-gray-500" },
};

function FindMyTickets({ concertId }: { concertId: string }) {
  const { t } = useLanguage();
  const [email, setEmail] = useState("");
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resendCooldowns, setResendCooldowns] = useState<Record<string, number>>({});
  const [emailSuggestion, setEmailSuggestion] = useState<string | null>(null);

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
        setError(t("event.tooManyRequests"));
        return;
      }
      const data = await res.json();
      setOrders(data.orders ?? []);
    } catch {
      setError(t("event.sendFailed"));
    } finally {
      setLoading(false);
    }
  }, [email, concertId, t]);

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
        setError(data.error || t("event.sendFailed"));
        setResendCooldowns((prev) => {
          const next = { ...prev };
          delete next[orderId];
          return next;
        });
      }
    } catch {
      setError(t("event.sendFailed"));
      setResendCooldowns((prev) => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
    }
  }, [email, t]);

  const isOnCooldown = (orderId: string) => {
    const until = resendCooldowns[orderId];
    return until ? Date.now() < until : false;
  };

  return (
    <div className="border-t border-border mt-10 pt-8">
      <h2 className="text-2xl font-semibold mb-2 font-heading tracking-tight">{t("event.findTickets")}</h2>
      <p className="text-muted text-sm mb-4">
        {t("event.findTicketsSub")}
      </p>

      <div className="flex gap-3 items-start">
        <div className="flex-1">
          <input
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (emailSuggestion) setEmailSuggestion(null);
            }}
            onBlur={() => {
              if (!email || !email.includes("@")) return;
              const result = emailSpellChecker.run({ email });
              if (result?.full && result.full !== email) {
                setEmailSuggestion(result.full);
              }
            }}
            onKeyDown={(e) => e.key === "Enter" && handleLookup()}
            className="w-full px-4 py-2.5 bg-background border border-border rounded-md focus:outline-none focus:border-accent-light transition-colors text-sm"
          />
          {emailSuggestion && (
            <button
              type="button"
              onClick={() => {
                setEmail(emailSuggestion);
                setEmailSuggestion(null);
              }}
              className="mt-1.5 text-xs text-accent hover:underline text-left"
            >
              {t("checkout.emailSuggestion", { suggestion: emailSuggestion })}
            </button>
          )}
        </div>
        <button
          onClick={handleLookup}
          disabled={loading || !email.trim()}
          className="px-6 py-2.5 bg-accent hover:bg-accent-dark text-white rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm uppercase tracking-wider"
        >
          {loading ? t("event.lookingUp") : t("event.lookUp")}
        </button>
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-500">{error}</p>
      )}

      {orders !== null && orders.length === 0 && (
        <p className="mt-4 text-sm text-muted">
          {t("event.noOrders")}
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
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border border-border rounded-lg"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {order.orderNumber && (
                      <span className="font-mono text-sm font-semibold">
                        {order.orderNumber}
                      </span>
                    )}
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badge.className}`}>
                      {t(badge.labelKey)}
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
                    className="px-4 py-2 text-sm font-medium bg-accent/10 text-accent rounded-md hover:bg-accent/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                  >
                    {cooldown ? t("event.sent") : t("event.resendEmail")}
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

function ContactOrganizer({ concertId }: { concertId: string }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    subject: "",
    body: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(false);
  const [emailSuggestion, setEmailSuggestion] = useState<string | null>(null);

  const handleChange = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = useCallback(async () => {
    if (!form.firstName.trim() || !form.lastName.trim() || !form.email.trim() || !form.subject.trim() || !form.body.trim()) {
      setError(t("event.allFieldsRequired"));
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/contact-organizer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ concertId, ...form }),
      });
      if (res.status === 429) {
        setError(t("event.tooManyMessages"));
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t("event.sendFailed"));
        return;
      }
      setSuccess(true);
      setForm({ firstName: "", lastName: "", email: "", subject: "", body: "" });
      setCooldown(true);
      setTimeout(() => setCooldown(false), 30_000);
    } catch {
      setError(t("event.sendFailed"));
    } finally {
      setSubmitting(false);
    }
  }, [form, concertId, t]);

  return (
    <div className="border-t border-border mt-10 pt-8">
      {success ? (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
          {t("event.messageSent")}
        </div>
      ) : !open ? (
        <button
          onClick={() => setOpen(true)}
          className="w-full flex items-center justify-center gap-2 py-3 border border-border rounded-lg text-sm font-medium text-muted hover:text-foreground hover:border-accent/40 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          {t("event.contactOrganizer")}
        </button>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-semibold font-heading tracking-tight">{t("event.contactOrganizer")}</h2>
            <button
              onClick={() => setOpen(false)}
              className="text-muted hover:text-foreground transition-colors p-1"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="text-muted text-sm mb-5">
            {t("event.contactSub")}
          </p>

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-medium text-muted uppercase tracking-widest mb-1.5">
                  {t("common.firstName")}
                </label>
                <input
                  type="text"
                  value={form.firstName}
                  onChange={(e) => handleChange("firstName", e.target.value)}
                  className="w-full px-4 py-2.5 bg-background border border-border rounded-md focus:outline-none focus:border-accent-light transition-colors text-sm"
                  placeholder="Your first name"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted uppercase tracking-widest mb-1.5">
                  {t("common.lastName")}
                </label>
                <input
                  type="text"
                  value={form.lastName}
                  onChange={(e) => handleChange("lastName", e.target.value)}
                  className="w-full px-4 py-2.5 bg-background border border-border rounded-md focus:outline-none focus:border-accent-light transition-colors text-sm"
                  placeholder="Your last name"
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted uppercase tracking-widest mb-1.5">
                {t("common.email")}
              </label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => {
                  handleChange("email", e.target.value);
                  if (emailSuggestion) setEmailSuggestion(null);
                }}
                onBlur={() => {
                  if (!form.email || !form.email.includes("@")) return;
                  const result = emailSpellChecker.run({ email: form.email });
                  if (result?.full && result.full !== form.email) {
                    setEmailSuggestion(result.full);
                  }
                }}
                className="w-full px-4 py-2.5 bg-background border border-border rounded-md focus:outline-none focus:border-accent-light transition-colors text-sm"
                placeholder="your@email.com"
              />
              {emailSuggestion && (
                <button
                  type="button"
                  onClick={() => {
                    handleChange("email", emailSuggestion);
                    setEmailSuggestion(null);
                  }}
                  className="mt-1.5 text-xs text-accent hover:underline text-left"
                >
                  {t("checkout.emailSuggestion", { suggestion: emailSuggestion })}
                </button>
              )}
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted uppercase tracking-widest mb-1.5">
                {t("event.subject")}
              </label>
              <input
                type="text"
                value={form.subject}
                onChange={(e) => handleChange("subject", e.target.value)}
                maxLength={200}
                className="w-full px-4 py-2.5 bg-background border border-border rounded-md focus:outline-none focus:border-accent-light transition-colors text-sm"
                placeholder="What is your question about?"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted uppercase tracking-widest mb-1.5">
                {t("event.message")}
              </label>
              <textarea
                value={form.body}
                onChange={(e) => handleChange("body", e.target.value)}
                maxLength={2000}
                rows={4}
                className="w-full px-4 py-2.5 bg-background border border-border rounded-md focus:outline-none focus:border-accent-light transition-colors text-sm resize-none"
                placeholder="Type your message here..."
              />
              <p className="text-right text-xs text-muted mt-1">{form.body.length}/2000</p>
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <button
              onClick={handleSubmit}
              disabled={submitting || cooldown}
              className="px-6 py-2.5 bg-accent hover:bg-accent-dark text-white rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm uppercase tracking-wider"
            >
              {submitting ? t("event.sending") : cooldown ? t("event.messageSent") : t("event.sendMessage")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
