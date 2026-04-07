"use client";

import EventTheme from "@/components/EventTheme";
import { db } from "@/lib/db";
import { getAvailability, getTodayString } from "@/lib/phases";
import { QUEUE_THRESHOLD } from "@/lib/queueConstants";
import { id } from "@instantdb/react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const RESERVATION_DURATION = 15 * 60 * 1000; // 15 minutes
const STORAGE_KEY_PREFIX = "reservation_";

type Attendee = {
  firstName: string;
  lastName: string;
  email: string;
  cedula: string;
};

function emptyAttendee(): Attendee {
  return { firstName: "", lastName: "", email: "", cedula: "" };
}

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Returns the timestamp of the most recent 9am or 1pm VET (UTC-4) schedule window. */
function getLastScheduleTime(): number {
  const now = new Date();
  // Get current time in Venezuela timezone
  const vetStr = now.toLocaleString("en-US", { timeZone: "America/Caracas" });
  const vet = new Date(vetStr);

  const today9am = new Date(vet);
  today9am.setHours(9, 0, 0, 0);
  const today1pm = new Date(vet);
  today1pm.setHours(13, 0, 0, 0);

  if (vet >= today1pm) return today1pm.getTime();
  if (vet >= today9am) return today9am.getTime();
  // Before 9am today → use yesterday 1pm
  const yesterday1pm = new Date(vet);
  yesterday1pm.setDate(yesterday1pm.getDate() - 1);
  yesterday1pm.setHours(13, 0, 0, 0);
  return yesterday1pm.getTime();
}

const RATE_IDS: Record<string, string> = {
  USD: "a0000000-0000-4000-8000-000000000001",
  EUR: "a0000000-0000-4000-8000-000000000002",
};

export default function BuyPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const ticketTypeId = params.ticketTypeId as string;
  const qty = Math.max(1, Math.min(5, Number(searchParams.get("qty")) || 1));
  const queueToken = searchParams.get("queueToken") || undefined;

  const [attendees, setAttendees] = useState<Attendee[]>(() =>
    Array.from({ length: qty }, emptyAttendee),
  );
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string | null>(null);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [referenceNumber, setReferenceNumber] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rateRefreshing, setRateRefreshing] = useState(false);
  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<{
    code: string;
    discountType: string;
    discountValue: number;
  } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);

  // Reservation & timer state
  const [reservationId, setReservationId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [timerExpired, setTimerExpired] = useState(false);
  const reservationCreatedRef = useRef(false);
  const submittingRef = useRef(false);

  const { isLoading, error: queryError, data } = db.useQuery({
    ticketTypes: {
      $: { where: { id: ticketTypeId } },
      concert: {
        paymentMethods: {
          $: { order: { createdAt: "asc" } },
        },
        customFields: {
          $: { order: { sortOrder: "asc" } },
        },
        coupons: {
          $: { where: { active: true } },
        },
      },
      orders: {},
      phases: {
        $: { order: { sortOrder: "asc" } },
      },
      reservations: {},
      queueEntries: {},
    },
    exchangeRates: {},
  });

  // Create reservation on first data load (server-side)
  useEffect(() => {
    if (isLoading || !data?.ticketTypes?.[0] || reservationCreatedRef.current) return;
    reservationCreatedRef.current = true;

    const storageKey = STORAGE_KEY_PREFIX + ticketTypeId;
    const stored = sessionStorage.getItem(storageKey);

    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed.expiresAt > Date.now()) {
          // Resume existing reservation
          setReservationId(parsed.id);
          setExpiresAt(parsed.expiresAt);
          return;
        } else {
          // Expired — clean up (cron will delete server-side)
          sessionStorage.removeItem(storageKey);
        }
      } catch {
        sessionStorage.removeItem(storageKey);
      }
    }

    // Create new reservation via server
    fetch("/api/create-reservation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketTypeId, qty, queueToken }),
    })
      .then((res) => res.json())
      .then((result) => {
        if (result.reservationId) {
          sessionStorage.setItem(
            storageKey,
            JSON.stringify({ id: result.reservationId, expiresAt: result.expiresAt }),
          );
          setReservationId(result.reservationId);
          setExpiresAt(result.expiresAt);
        }
      })
      .catch(() => {
        // Reservation failed — user can still try to buy, just without a hold
      });
  }, [isLoading, data?.ticketTypes?.[0]?.id, ticketTypeId, qty]);

  // Countdown timer
  useEffect(() => {
    if (!expiresAt) return;

    const tick = () => {
      const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining <= 0) {
        setTimerExpired(true);
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  // Handle timer expiry — redirect (cron handles reservation cleanup)
  useEffect(() => {
    if (!timerExpired || submittingRef.current) return;

    if (reservationId) {
      const storageKey = STORAGE_KEY_PREFIX + ticketTypeId;
      sessionStorage.removeItem(storageKey);
    }

    const concertSlug = data?.ticketTypes?.[0]?.concert?.slug;
    router.push(concertSlug ? `/events/${concertSlug}` : "/");
  }, [timerExpired, reservationId, ticketTypeId, data?.ticketTypes?.[0]?.concert?.slug, router]);

  // Queue gate: if queue is active and user has no valid queueToken, redirect to queue
  const ticketTypeForGate = data?.ticketTypes?.[0];
  const queueEntriesForGate = ticketTypeForGate?.queueEntries || [];
  const nowForQueue = Date.now();
  const activeWaitersCount = (queueEntriesForGate as { status: string; expiresAt: number }[]).filter(
    (e) => e.status === "waiting" && e.expiresAt > nowForQueue,
  ).length;
  const admittedQueueCount = (queueEntriesForGate as { status: string; expiresAt: number }[]).filter(
    (e) => e.status === "admitted" && e.expiresAt > nowForQueue,
  ).length;
  const reservationsForGate = (ticketTypeForGate?.reservations || []) as { expiresAt: number }[];
  const activeBuyersForGate = reservationsForGate.filter((r) => r.expiresAt > nowForQueue).length + admittedQueueCount;
  const queueIsActive = activeBuyersForGate >= QUEUE_THRESHOLD || activeWaitersCount > 0;
  const hasValidQueueToken = queueToken
    ? (queueEntriesForGate as { id: string; status: string; expiresAt: number }[]).some(
        (e) => e.id === queueToken && e.status === "admitted" && e.expiresAt > nowForQueue,
      )
    : false;

  useEffect(() => {
    if (!isLoading && ticketTypeForGate && queueIsActive && !hasValidQueueToken && !reservationId) {
      router.push(`/queue/${ticketTypeId}?qty=${qty}`);
    }
  }, [isLoading, ticketTypeForGate, queueIsActive, hasValidQueueToken, ticketTypeId, qty, router]);

  const selectedPmCurrency = data?.ticketTypes?.[0]?.concert?.paymentMethods?.find(
    (pm) => pm.id === selectedPaymentMethod,
  )?.convertCurrency;

  // Find cached rate for selected currency
  const cachedRate = selectedPmCurrency
    ? data?.exchangeRates?.find((r) => r.currency === selectedPmCurrency)
    : null;

  // Auto-refresh if rate is stale (older than last 9am/1pm VET window)
  useEffect(() => {
    if (!selectedPmCurrency) return;

    const rateId = RATE_IDS[selectedPmCurrency];
    if (!rateId) return;

    const lastSchedule = getLastScheduleTime();
    const isFresh = cachedRate && cachedRate.fetchedAt >= lastSchedule;
    if (isFresh) return;

    let cancelled = false;
    setRateRefreshing(true);

    fetch(`/api/exchange-rates?currency=${selectedPmCurrency}`)
      .then((res) => res.json())
      .then((json) => {
        if (!cancelled && json.promedio) {
          db.transact(
            db.tx.exchangeRates[rateId].update({
              currency: selectedPmCurrency,
              rate: json.promedio,
              fetchedAt: Date.now(),
            }),
          );
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setRateRefreshing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedPmCurrency, cachedRate?.fetchedAt]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted">Loading...</div>
      </div>
    );
  }

  if (queryError) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-danger">Error: {queryError.message}</div>
      </div>
    );
  }

  const ticketType = data.ticketTypes[0];
  if (!ticketType) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted">Ticket type not found</div>
      </div>
    );
  }

  const concert = ticketType.concert;
  const paymentMethods = concert?.paymentMethods || [];
  const customFields = (concert?.customFields || []).sort((a, b) => a.sortOrder - b.sortOrder);
  const coupons = concert?.coupons || [];
  const allOrders = ticketType.orders;
  const selectedPm = paymentMethods.find((pm) => pm.id === selectedPaymentMethod);

  const today = getTodayString();
  const phases = ticketType.phases || [];
  const allReservations = (ticketType.reservations || []) as {
    id: string;
    quantity: number;
    expiresAt: number;
    phaseId?: string;
  }[];
  // Exclude own reservation so our hold doesn't reduce our own displayed availability
  const otherReservations = allReservations.filter(
    (r) => r.id !== reservationId && r.expiresAt > Date.now(),
  );
  const { price: effectivePrice, available, activePhase } =
    getAvailability(ticketType, phases, allOrders, today, otherReservations);

  if (available < qty) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="bg-surface border border-border rounded-2xl p-8 text-center max-w-md">
          <div className="text-5xl mb-4">{"\uD83D\uDE14"}</div>
          <h1 className="text-2xl font-bold mb-2">Not Enough Tickets</h1>
          <p className="text-muted mb-4">
            Only {available} ticket{available !== 1 ? "s" : ""} remaining for {ticketType.name}.
          </p>
          <a
            href={concert ? `/events/${concert.slug}` : "/"}
            className="text-accent-light hover:underline text-sm"
          >
            &larr; Back to event
          </a>
        </div>
      </div>
    );
  }

  const subtotal = effectivePrice * qty;
  const discount = appliedCoupon
    ? appliedCoupon.discountType === "percentage"
      ? Math.min(subtotal, subtotal * (appliedCoupon.discountValue / 100))
      : Math.min(appliedCoupon.discountValue, subtotal)
    : 0;
  const feePercent = ticketType.feePercent ?? 0;
  const feeFixed = ticketType.feeFixed ?? 0;
  const feeAmount = (subtotal * feePercent) / 100 + feeFixed * qty;
  const total = subtotal - discount + feeAmount;

  function applyCoupon() {
    setCouponError(null);
    const code = couponInput.trim().toUpperCase();
    if (!code) return;

    const coupon = coupons.find((c) => c.code.toUpperCase() === code);
    if (!coupon) {
      setCouponError("Invalid coupon code");
      return;
    }
    if (!coupon.active) {
      setCouponError("Coupon is no longer active");
      return;
    }
    if (coupon.maxUses != null) {
      const usageCount = allOrders.filter(
        (o: { couponCode?: string; status: string }) =>
          o.couponCode === coupon.code &&
          (o.status === "approved" || o.status === "pending"),
      ).length;
      if (usageCount >= coupon.maxUses) {
        setCouponError("Coupon usage limit reached");
        return;
      }
    }
    setAppliedCoupon({
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
    });
    setCouponInput("");
  }

  function removeCoupon() {
    setAppliedCoupon(null);
    setCouponError(null);
  }

  function updateAttendee(index: number, field: keyof Attendee, value: string) {
    setAttendees((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (timerExpired) {
      setError("Your reservation has expired. Please go back and try again.");
      return;
    }

    if (!selectedPaymentMethod) {
      setError("Please select a payment method.");
      return;
    }
    const missingField = customFields.find(
      (cf) => cf.required && !customFieldValues[cf.id]?.trim(),
    );
    if (missingField) {
      setError(`Please fill in the required field: ${missingField.label}`);
      return;
    }
    const needsScreenshot = selectedPm?.requireScreenshot !== false;
    const needsReference = selectedPm?.requireReferenceNumber === true;
    if (needsScreenshot && !file) {
      setError("Please upload your payment proof screenshot.");
      return;
    }
    if (needsReference && !referenceNumber.trim()) {
      setError("Please enter the payment reference number.");
      return;
    }
    if (!acceptedTerms) {
      setError("Please accept the terms and conditions.");
      return;
    }

    setSubmitting(true);
    submittingRef.current = true;
    setError(null);

    try {
      let filePath = "";
      if (file) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        filePath = `payment-proofs/${Date.now()}-${safeName}`;
        await db.storage.upload(filePath, file);
      }

      const purchaseGroupId = qty > 1 ? id() : undefined;

      const res = await fetch("/api/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketTypeId,
          qty,
          attendees: attendees.map((a) => ({
            firstName: a.firstName.trim(),
            lastName: a.lastName.trim(),
            email: a.email.trim(),
            cedula: a.cedula.trim(),
          })),
          paymentMethodName: selectedPm?.name || "",
          customFieldValues: Object.keys(customFieldValues).length > 0
            ? JSON.stringify(
                Object.fromEntries(
                  customFields
                    .filter((cf) => customFieldValues[cf.id])
                    .map((cf) => [cf.label, customFieldValues[cf.id]]),
                ),
              )
            : undefined,
          couponCode: appliedCoupon?.code || undefined,
          reservationId: reservationId || undefined,
          referenceNumber: referenceNumber.trim() || undefined,
          paymentProofPath: filePath || undefined,
          purchaseGroupId,
          queueToken: queueToken || undefined,
          ...(cachedRate ? {
            purchaseRate: cachedRate.rate,
            purchaseRateCurrency: cachedRate.currency,
            purchaseAmountBs: Math.round((total / qty) * cachedRate.rate * 100) / 100,
          } : {}),
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        if (res.status === 409) {
          setError("Tickets are no longer available. Please go back and try again.");
        } else {
          setError(result.error || "Something went wrong.");
        }
        setSubmitting(false);
        return;
      }

      // Clear reservation from sessionStorage
      sessionStorage.removeItem(STORAGE_KEY_PREFIX + ticketTypeId);

      // Emails are sent in the background by the server — redirect immediately
      router.push(`/ticket/${result.orderIds[0]}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  // Timer color classes
  const timerClasses =
    secondsLeft !== null && secondsLeft <= 60
      ? "bg-danger text-white animate-pulse"
      : secondsLeft !== null && secondsLeft <= 300
        ? "bg-warning text-white"
        : "bg-accent-dark text-white/90";

  return (
    <EventTheme concert={concert || {}}>
    <div className="min-h-screen">
      <header className="bg-accent text-white sticky top-0 z-10 shadow-md">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4">
          {concert?.logoUrl ? (
            <a href={`/events/${concert.slug}`}>
              <img src={concert.logoUrl} alt={concert.name} className="h-8 w-auto object-contain" />
            </a>
          ) : (
            <a href="/" className="text-xl font-bold tracking-wide text-white">ma<span className="text-white/60">Tickets</span></a>
          )}
        </div>
        {secondsLeft !== null && (
          <div className={`text-center py-2 text-sm font-semibold tracking-wide border-t border-white/10 ${timerClasses}`}>
            Time remaining to complete your purchase: {formatTime(secondsLeft)}
          </div>
        )}
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-12">
        <a
          href={concert ? `/events/${concert.slug}` : "/"}
          className="text-sm text-muted hover:text-accent-light transition-colors mb-6 inline-block"
        >
          &larr; Back to event
        </a>

        <div className="bg-surface border border-border rounded-2xl p-6 sm:p-8">
          <h1 className="text-2xl font-bold mb-2">Purchase Tickets</h1>

          <div className="bg-accent/10 border border-accent/30 rounded-xl p-4 mb-6">
            <p className="font-semibold text-accent-light">{ticketType.name}</p>
            {activePhase && (
              <p className="text-xs font-medium text-accent-light/70">
                {activePhase.name}
              </p>
            )}
            {concert && (
              <p className="text-sm text-muted">{concert.name}</p>
            )}
            <p className="text-lg font-medium mt-2 text-foreground">
              ${effectivePrice.toFixed(2)} x {qty} = ${subtotal.toFixed(2)}
            </p>
            {appliedCoupon && discount > 0 && (
              <p className="text-sm text-success mt-1">
                Coupon {appliedCoupon.code}:{" "}
                {appliedCoupon.discountType === "percentage"
                  ? `${appliedCoupon.discountValue}% off`
                  : `$${appliedCoupon.discountValue.toFixed(2)} off`}{" "}
                (-${discount.toFixed(2)})
              </p>
            )}
            {feeAmount > 0 && (
              <p className="text-sm text-muted mt-1">
                Service fee: +${feeAmount.toFixed(2)}
              </p>
            )}
            <p className="text-2xl font-bold mt-1 text-foreground">
              Total: ${total.toFixed(2)}
            </p>
          </div>

          {/* Coupon section */}
          {coupons.length > 0 && (
            <div className="mb-6">
              {appliedCoupon ? (
                <div className="flex items-center justify-between bg-success/10 border border-success/30 rounded-xl px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-success">
                      Coupon applied: <span className="font-mono">{appliedCoupon.code}</span>
                    </p>
                    <p className="text-xs text-muted">
                      {appliedCoupon.discountType === "percentage"
                        ? `${appliedCoupon.discountValue}% off`
                        : `$${appliedCoupon.discountValue.toFixed(2)} off`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={removeCoupon}
                    className="text-sm text-danger hover:text-danger/80 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Coupon Code
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={couponInput}
                      onChange={(e) => {
                        setCouponInput(e.target.value);
                        setCouponError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          applyCoupon();
                        }
                      }}
                      className="flex-1 px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors uppercase"
                      placeholder="Enter coupon code"
                    />
                    <button
                      type="button"
                      onClick={applyCoupon}
                      className="px-5 py-2.5 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium transition-colors text-sm"
                    >
                      Apply
                    </button>
                  </div>
                  {couponError && (
                    <p className="text-danger text-sm mt-1.5">{couponError}</p>
                  )}
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Attendee forms */}
            {attendees.map((attendee, i) => (
              <div
                key={i}
                className="border border-border rounded-xl p-5 space-y-4"
              >
                <h3 className="font-semibold text-accent-light">
                  Attendee {i + 1}
                </h3>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1.5">
                      First Name
                    </label>
                    <input
                      type="text"
                      required
                      value={attendee.firstName}
                      onChange={(e) => updateAttendee(i, "firstName", e.target.value)}
                      className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors"
                      placeholder="First name"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5">
                      Last Name
                    </label>
                    <input
                      type="text"
                      required
                      value={attendee.lastName}
                      onChange={(e) => updateAttendee(i, "lastName", e.target.value)}
                      className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors"
                      placeholder="Last name"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Email
                  </label>
                  <input
                    type="email"
                    required
                    value={attendee.email}
                    onChange={(e) => updateAttendee(i, "email", e.target.value)}
                    className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors"
                    placeholder="email@example.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Cedula
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    required
                    value={attendee.cedula}
                    onChange={(e) => updateAttendee(i, "cedula", e.target.value.replace(/\D/g, ""))}
                    className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors"
                    placeholder="ID number"
                  />
                </div>
              </div>
            ))}

            {/* Custom fields */}
            {customFields.length > 0 && customFields.map((cf) => {
              const fieldId = cf.id;
              const val = customFieldValues[fieldId] || "";
              let parsedOptions: string[] = [];
              try { parsedOptions = cf.options ? JSON.parse(cf.options) : []; } catch { /* ignore */ }

              return (
                <div key={fieldId}>
                  <label className="block text-sm font-medium mb-1.5">
                    {cf.label}{cf.required && " *"}
                  </label>
                  {cf.fieldType === "text" && (
                    <input
                      type="text"
                      required={cf.required}
                      value={val}
                      onChange={(e) => setCustomFieldValues((p) => ({ ...p, [fieldId]: e.target.value }))}
                      className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors"
                    />
                  )}
                  {cf.fieldType === "number" && (
                    <input
                      type="number"
                      required={cf.required}
                      value={val}
                      onChange={(e) => setCustomFieldValues((p) => ({ ...p, [fieldId]: e.target.value }))}
                      className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors"
                    />
                  )}
                  {cf.fieldType === "email" && (
                    <input
                      type="email"
                      required={cf.required}
                      value={val}
                      onChange={(e) => setCustomFieldValues((p) => ({ ...p, [fieldId]: e.target.value }))}
                      className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors"
                    />
                  )}
                  {cf.fieldType === "date" && (
                    <input
                      type="date"
                      required={cf.required}
                      value={val}
                      onChange={(e) => setCustomFieldValues((p) => ({ ...p, [fieldId]: e.target.value }))}
                      className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors"
                    />
                  )}
                  {cf.fieldType === "checkbox" && (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={val === "true"}
                        onChange={(e) => setCustomFieldValues((p) => ({ ...p, [fieldId]: e.target.checked ? "true" : "false" }))}
                        className="accent-accent-light"
                      />
                      <span className="text-sm">{cf.label}</span>
                    </label>
                  )}
                  {cf.fieldType === "select" && (
                    <select
                      required={cf.required}
                      value={val}
                      onChange={(e) => setCustomFieldValues((p) => ({ ...p, [fieldId]: e.target.value }))}
                      className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors"
                    >
                      <option value="">Select...</option>
                      {parsedOptions.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  )}
                  {cf.fieldType === "multiselect" && (
                    <div className="space-y-1.5">
                      {parsedOptions.map((opt) => {
                        let selected: string[] = [];
                        try { selected = val ? JSON.parse(val) : []; } catch { /* ignore */ }
                        const isChecked = selected.includes(opt);
                        return (
                          <label key={opt} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                const next = isChecked ? selected.filter((s) => s !== opt) : [...selected, opt];
                                setCustomFieldValues((p) => ({ ...p, [fieldId]: JSON.stringify(next) }));
                              }}
                              className="accent-accent-light"
                            />
                            <span className="text-sm">{opt}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Payment method selection */}
            {paymentMethods.length > 0 && (
              <div className="space-y-3">
                <h3 className="font-semibold">Payment Method</h3>
                <div className="space-y-2">
                  {paymentMethods.map((pm) => (
                    <label
                      key={pm.id}
                      className={`flex items-start gap-3 p-4 border rounded-xl cursor-pointer transition-colors ${
                        selectedPaymentMethod === pm.id
                          ? "border-accent-light bg-accent/10"
                          : "border-border hover:border-accent/40"
                      }`}
                    >
                      <input
                        type="radio"
                        name="paymentMethod"
                        value={pm.id}
                        checked={selectedPaymentMethod === pm.id}
                        onChange={() => setSelectedPaymentMethod(pm.id)}
                        className="mt-1 accent-accent-light"
                      />
                      <div>
                        <p className="font-medium">{pm.name}</p>
                      </div>
                    </label>
                  ))}
                </div>

                {selectedPm && (
                  <div className="bg-warning/10 border border-warning/30 rounded-xl p-4">
                    <p className="font-semibold text-warning mb-2">
                      Payment Instructions
                    </p>
                    <p className="text-sm whitespace-pre-wrap text-foreground/80">
                      {selectedPm.instructions}
                    </p>

                    {selectedPm?.convertCurrency && (
                      <div className="mt-3 pt-3 border-t border-warning/20">
                        {rateRefreshing && !cachedRate ? (
                          <p className="text-sm text-muted animate-pulse">
                            Loading exchange rate...
                          </p>
                        ) : cachedRate ? (
                          <div>
                            <p className="text-lg font-bold text-foreground">
                              Total: {cachedRate.currency === "EUR" ? "\u20AC" : "$"}
                              {total.toFixed(2)} ={" "}
                              {(total * cachedRate.rate).toLocaleString("es-VE", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}{" "}
                              Bs
                            </p>
                            <p className="text-xs text-muted mt-1">
                              BCV rate: {cachedRate.rate.toFixed(2)} Bs/{cachedRate.currency} &middot; Updated:{" "}
                              {new Date(cachedRate.fetchedAt).toLocaleString()}
                            </p>
                          </div>
                        ) : (
                          <p className="text-sm text-danger">
                            Could not load exchange rate
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Payment proof fields — conditional on selected payment method */}
            {selectedPm && (selectedPm.requireScreenshot !== false || selectedPm.requireReferenceNumber) && (
              <div className="space-y-4">
                {selectedPm.requireScreenshot !== false && (
                  <div>
                    <label className="block text-sm font-medium mb-1.5">
                      Payment Proof Screenshot
                    </label>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/heic"
                      onChange={(e) => {
                        const selected = e.target.files?.[0] || null;
                        if (selected) {
                          const MAX_SIZE = 5 * 1024 * 1024; // 5MB
                          const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];
                          if (selected.size > MAX_SIZE) {
                            setFileError("File must be under 5MB.");
                            setFile(null);
                            e.target.value = "";
                            return;
                          }
                          if (!ALLOWED_TYPES.includes(selected.type)) {
                            setFileError("Only JPEG, PNG, WebP, and HEIC images are allowed.");
                            setFile(null);
                            e.target.value = "";
                            return;
                          }
                        }
                        setFileError(null);
                        setFile(selected);
                      }}
                      className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors file:mr-4 file:py-1 file:px-3 file:rounded-md file:border-0 file:bg-accent/20 file:text-accent-light file:font-medium file:cursor-pointer"
                    />
                    {fileError && (
                      <p className="text-danger text-sm mt-1.5">{fileError}</p>
                    )}
                  </div>
                )}
                {selectedPm.requireReferenceNumber && (
                  <div>
                    <label className="block text-sm font-medium mb-1.5">
                      Payment Reference Number
                    </label>
                    <input
                      type="text"
                      value={referenceNumber}
                      onChange={(e) => setReferenceNumber(e.target.value)}
                      className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors"
                      placeholder="Enter your payment reference number"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Terms & conditions */}
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
                className="mt-1 accent-accent-light"
              />
              <span className="text-sm text-muted">
                I accept the{" "}
                <a href="/terms" target="_blank" className="underline text-accent-light hover:text-accent">terms and conditions</a>
                {" "}and{" "}
                <a href="/privacy" target="_blank" className="underline text-accent-light hover:text-accent">privacy policy</a>.
                I understand that my ticket purchase is subject to approval
                and that no refunds will be issued once the ticket is approved.
              </span>
            </label>

            {error && (
              <div className="text-danger text-sm bg-danger/10 border border-danger/30 rounded-lg p-3">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || timerExpired || !!fileError}
              className="w-full py-3 bg-accent hover:bg-accent-dark disabled:opacity-50 text-white rounded-lg font-semibold transition-colors shadow-lg shadow-accent/20"
            >
              {submitting ? "Submitting..." : "Submit Order"}
            </button>
          </form>
        </div>
      </main>
    </div>
    </EventTheme>
  );
}
