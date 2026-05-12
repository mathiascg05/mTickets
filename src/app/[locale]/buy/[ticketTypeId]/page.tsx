"use client";

import EventTheme from "@/components/EventTheme";
import { useLanguage, LanguageToggle } from "@/lib/LanguageContext";
import { dateLocale } from "@/lib/i18n";
import { db } from "@/lib/db";
import { useStorageUrl } from "@/lib/useStorageUrl";
import { getAvailability, getTodayString } from "@/lib/phases";
import { QUEUE_THRESHOLD } from "@/lib/queueConstants";
import { TERMS_VERSION, PRIVACY_VERSION } from "@/lib/legalVersions";
import { id } from "@instantdb/react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import emailSpellChecker from "@zootools/email-spell-checker";

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

// iOS Safari cierra IDB cuando el tab va a background; el primer intento puede
// fallar al volver. Damos un segundo intento corto antes de propagar el error.
async function uploadWithRetry(path: string, file: File) {
  try {
    await db.storage.upload(path, file);
  } catch (err) {
    const isIdbClosing =
      err instanceof Error &&
      err.name === "InvalidStateError" &&
      err.message.includes("IDBDatabase");
    if (!isIdbClosing) throw err;
    await new Promise((r) => setTimeout(r, 500));
    await db.storage.upload(path, file);
  }
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

  const { t, lang } = useLanguage();

  const [attendees, setAttendees] = useState<Attendee[]>(() =>
    Array.from({ length: qty }, emptyAttendee),
  );
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string | null>(null);
  const [memoCode] = useState(() => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "MT-";
    for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  });
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
  const [emailSuggestions, setEmailSuggestions] = useState<Record<number, string>>({});
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

  const logoUrl = useStorageUrl(data?.ticketTypes?.[0]?.concert?.logoPath);

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

  // Block draft events: redirect to event page (which renders "unavailable" for non-organizers)
  const concertForGate = ticketTypeForGate?.concert;
  const concertSlugForGate = concertForGate?.slug;
  const concertStatusForGate = concertForGate?.status;
  useEffect(() => {
    if (!isLoading && concertSlugForGate && concertStatusForGate && concertStatusForGate !== "active") {
      router.replace(`/events/${concertSlugForGate}`);
    }
  }, [isLoading, concertSlugForGate, concertStatusForGate, router]);

  const selectedPmRecord = data?.ticketTypes?.[0]?.concert?.paymentMethods?.find(
    (pm) => pm.id === selectedPaymentMethod,
  );
  const selectedPmCurrency = selectedPmRecord?.convertCurrency;
  const selectedPmCustomRate = (selectedPmRecord as { customRate?: number } | undefined)?.customRate;

  // Find cached rate for selected currency (skipped when a custom rate is configured)
  const cachedRate = selectedPmCurrency && !selectedPmCustomRate
    ? data?.exchangeRates?.find((r) => r.currency === selectedPmCurrency)
    : null;

  // Auto-refresh if rate is stale (older than last 9am/1pm VET window)
  useEffect(() => {
    if (!selectedPmCurrency) return;
    if (selectedPmCustomRate) return;

    const rateId = RATE_IDS[selectedPmCurrency];
    if (!rateId) return;

    const lastSchedule = getLastScheduleTime();
    const isFresh = cachedRate && cachedRate.fetchedAt >= lastSchedule;
    if (isFresh) return;

    let cancelled = false;
    setRateRefreshing(true);

    fetch(`/api/exchange-rates?currency=${selectedPmCurrency}`)
      .then(() => {
        // Rate is cached server-side by the API endpoint
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
        <div className="animate-pulse text-muted">{t("common.loading")}</div>
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
        <div className="text-muted">{t("checkout.ticketNotFound")}</div>
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
          <h1 className="text-2xl font-bold mb-2">{t("checkout.notEnough")}</h1>
          <p className="text-muted mb-4">
            {t("checkout.onlyRemaining", { available, name: ticketType.name })}
          </p>
          <a
            href={concert ? `/events/${concert.slug}` : "/"}
            className="text-accent-light hover:underline text-sm"
          >
            {t("event.backToEvent")}
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
  const pmDiscountConfig = selectedPm as
    | { discountType?: string; discountValue?: number }
    | undefined;
  const methodDiscountRaw =
    pmDiscountConfig?.discountType && pmDiscountConfig?.discountValue && pmDiscountConfig.discountValue > 0
      ? pmDiscountConfig.discountType === "percentage"
        ? subtotal * (pmDiscountConfig.discountValue / 100)
        : pmDiscountConfig.discountValue
      : 0;
  const methodDiscount = Math.max(
    0,
    Math.min(methodDiscountRaw, subtotal - discount),
  );
  const feePercent = ticketType.feePercent ?? 0;
  const feeFixed = ticketType.feeFixed ?? 0;
  const feeAmount = (subtotal * feePercent) / 100 + feeFixed * qty;
  const total = subtotal - discount - methodDiscount + feeAmount;

  const rateValue = selectedPmCustomRate ?? cachedRate?.rate ?? 0;
  const totalBs = Math.round(total * rateValue * 100) / 100;

  function applyCoupon() {
    setCouponError(null);
    const code = couponInput.trim().toUpperCase();
    if (!code) return;

    const coupon = coupons.find((c) => c.code.toUpperCase() === code);
    if (!coupon) {
      setCouponError(t("checkout.invalidCoupon"));
      return;
    }
    if (!coupon.active) {
      setCouponError(t("checkout.couponInactive"));
      return;
    }
    if (coupon.maxUses != null) {
      const usageCount = allOrders.filter(
        (o: { couponCode?: string; status: string }) =>
          o.couponCode === coupon.code &&
          (o.status === "approved" || o.status === "pending"),
      ).length;
      if (usageCount >= coupon.maxUses) {
        setCouponError(t("checkout.couponLimit"));
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
      setError(t("checkout.timerExpired"));
      return;
    }

    if (!selectedPaymentMethod) {
      setError(t("checkout.selectPayment"));
      return;
    }
    const missingField = customFields.find(
      (cf) => cf.required && !customFieldValues[cf.id]?.trim(),
    );
    if (missingField) {
      setError(t("checkout.fillRequired", { field: missingField.label }));
      return;
    }
    const needsScreenshot = selectedPm?.requireScreenshot !== false;
    const needsReference = selectedPm?.requireReferenceNumber === true;
    if (needsScreenshot && !file) {
      setError(t("checkout.uploadProof"));
      return;
    }
    if (needsReference && !referenceNumber.trim()) {
      setError((selectedPm as { type?: string }).type === "pago_movil"
        ? t("checkout.enterRef4")
        : t("checkout.enterRef"));
      return;
    }
    if (needsReference && (selectedPm as { type?: string }).type === "pago_movil" && referenceNumber.trim().length < 4) {
      setError(t("checkout.enterRef4"));
      return;
    }
    if (!acceptedTerms) {
      setError(t("checkout.acceptTerms"));
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
        await uploadWithRetry(filePath, file);
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
          paymentMethodId: selectedPm?.id || undefined,
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
          referenceNumber: (selectedPm as { type?: string }).type === "zelle"
            ? memoCode
            : (selectedPm as { type?: string }).type === "pago_movil"
              ? `${memoCode}-${referenceNumber.trim()}`
              : referenceNumber.trim() || undefined,
          paymentProofPath: filePath || undefined,
          purchaseGroupId,
          queueToken: queueToken || undefined,
          ...((selectedPmCustomRate || cachedRate) ? {
            purchaseRate: rateValue,
            purchaseRateCurrency: selectedPmCustomRate ? "USD" : cachedRate!.currency,
            purchaseAmountBs: Math.round((total / qty) * rateValue * 100) / 100,
          } : {}),
          acceptedTermsVersion: TERMS_VERSION,
          acceptedPrivacyVersion: PRIVACY_VERSION,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        if (res.status === 409) {
          setError(t("checkout.notAvailable"));
        } else {
          setError(result.error || t("checkout.somethingWrong"));
        }
        setSubmitting(false);
        return;
      }

      // Clear reservation from sessionStorage
      sessionStorage.removeItem(STORAGE_KEY_PREFIX + ticketTypeId);

      // Skip the email gate on the ticket page since the user just purchased
      sessionStorage.setItem(`ticket-verified-${result.orderIds[0]}`, "true");

      // Emails are sent in the background by the server — redirect immediately
      router.push(`/ticket/${result.orderIds[0]}?new=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("checkout.somethingWrong"));
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
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <a href="/" className="text-xl font-bold tracking-wide text-white">ma<span className="text-white/60">Tickets</span></a>
            {logoUrl && (
              <>
                <span className="text-white/30">|</span>
                <a href={`/events/${concert?.slug}`}>
                  <img src={logoUrl} alt={concert?.name} className="h-10 w-auto object-contain" />
                </a>
              </>
            )}
          </div>
          <LanguageToggle className="border-white/30 text-white/80 hover:text-white" />
        </div>
        {secondsLeft !== null && (
          <div className={`text-center py-2 text-sm font-semibold tracking-wide border-t border-white/10 ${timerClasses}`}>
            {t("checkout.timeRemaining", { time: formatTime(secondsLeft) })}
          </div>
        )}
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-12">
        <a
          href={concert ? `/events/${concert.slug}` : "/"}
          className="text-sm text-muted hover:text-accent-light transition-colors mb-6 inline-block"
        >
          {t("event.backToEvent")}
        </a>

        <div className="bg-surface border border-border rounded-2xl p-6 sm:p-8">
          <h1 className="text-2xl font-bold mb-2">{t("checkout.title")}</h1>

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
                {t("checkout.discount", { code: appliedCoupon.code, amount: `$${discount.toFixed(2)}` })}
              </p>
            )}
            {methodDiscount > 0 && selectedPm && (
              <p className="text-sm text-success mt-1">
                {t("checkout.methodDiscount", {
                  method: (selectedPm as { type?: string }).type === "pago_movil" ? "Pago Móvil" : selectedPm.name,
                  amount: `$${methodDiscount.toFixed(2)}`,
                })}
              </p>
            )}
            {feeAmount > 0 && (
              <p className="text-sm text-muted mt-1">
                {t("checkout.serviceFee", { amount: feeAmount.toFixed(2) })}
              </p>
            )}
            <p className="text-2xl font-bold mt-1 text-foreground">
              {t("common.total")}: ${total.toFixed(2)}
            </p>
          </div>

          {/* Coupon section */}
          {coupons.length > 0 && (
            <div className="mb-6">
              {appliedCoupon ? (
                <div className="flex items-center justify-between bg-success/10 border border-success/30 rounded-xl px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-success">
                      {t("checkout.couponApplied", { code: appliedCoupon.code })}
                    </p>
                    <p className="text-xs text-muted">
                      {appliedCoupon.discountType === "percentage"
                        ? t("checkout.percentOff", { value: appliedCoupon.discountValue })
                        : t("checkout.amountOff", { value: appliedCoupon.discountValue.toFixed(2) })}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={removeCoupon}
                    className="text-sm text-danger hover:text-danger/80 transition-colors"
                  >
                    {t("checkout.remove")}
                  </button>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    {t("checkout.couponCode")}
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
                      placeholder={t("checkout.enterCoupon")}
                    />
                    <button
                      type="button"
                      onClick={applyCoupon}
                      className="px-5 py-2.5 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium transition-colors text-sm"
                    >
                      {t("checkout.apply")}
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
                  {t("checkout.attendee", { n: i + 1 })}
                </h3>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1.5">
                      {t("common.firstName")}
                    </label>
                    <input
                      type="text"
                      required
                      value={attendee.firstName}
                      onChange={(e) => updateAttendee(i, "firstName", e.target.value)}
                      className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors"
                      placeholder={t("checkout.firstNamePlaceholder")}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5">
                      {t("common.lastName")}
                    </label>
                    <input
                      type="text"
                      required
                      value={attendee.lastName}
                      onChange={(e) => updateAttendee(i, "lastName", e.target.value)}
                      className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors"
                      placeholder={t("checkout.lastNamePlaceholder")}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    {t("common.email")}
                  </label>
                  <input
                    type="email"
                    required
                    value={attendee.email}
                    onChange={(e) => {
                      updateAttendee(i, "email", e.target.value);
                      if (emailSuggestions[i]) {
                        setEmailSuggestions((prev) => {
                          const next = { ...prev };
                          delete next[i];
                          return next;
                        });
                      }
                    }}
                    onBlur={() => {
                      if (!attendee.email || !attendee.email.includes("@")) return;
                      const result = emailSpellChecker.run({ email: attendee.email });
                      if (result?.full && result.full !== attendee.email) {
                        setEmailSuggestions((prev) => ({ ...prev, [i]: result.full }));
                      }
                    }}
                    className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors"
                    placeholder={t("checkout.emailPlaceholder")}
                  />
                  {emailSuggestions[i] && (
                    <button
                      type="button"
                      onClick={() => {
                        const suggestion = emailSuggestions[i];
                        updateAttendee(i, "email", suggestion);
                        setEmailSuggestions((prev) => {
                          const next = { ...prev };
                          delete next[i];
                          return next;
                        });
                      }}
                      className="mt-1.5 text-xs text-accent hover:underline text-left"
                    >
                      {t("checkout.emailSuggestion", { suggestion: emailSuggestions[i] })}
                    </button>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    {t("common.cedula")}
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    required
                    value={attendee.cedula}
                    onChange={(e) => updateAttendee(i, "cedula", e.target.value.replace(/\D/g, ""))}
                    className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors"
                    placeholder={t("checkout.idPlaceholder")}
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
              const sortedOptions = [...parsedOptions].sort((a, b) =>
                a.localeCompare(b, "es", { sensitivity: "base", numeric: true })
              );

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
                      <option value="">{t("common.select")}</option>
                      {sortedOptions.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  )}
                  {cf.fieldType === "multiselect" && (
                    <div className="space-y-1.5">
                      {sortedOptions.map((opt) => {
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
                <h3 className="font-semibold">{t("checkout.paymentMethod")}</h3>
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
                        <p className="font-medium">
                          {(pm as { type?: string }).type === "pago_movil" ? "Pago Móvil" : pm.name}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>

                {selectedPm && (
                  <div className="bg-warning/10 border border-warning/30 rounded-xl p-4">
                    <p className="font-semibold text-warning mb-2">
                      {t("checkout.paymentDetails")}
                    </p>

                    {/* Zelle structured info */}
                    {(selectedPm as { type?: string; zelleEmail?: string; zelleName?: string }).type === "zelle" &&
                      ((selectedPm as { zelleEmail?: string }).zelleEmail || (selectedPm as { zelleName?: string }).zelleName) && (
                      <div className="text-sm space-y-1 mb-2">
                        {(selectedPm as { zelleName?: string }).zelleName && (
                          <p><span className="text-muted">{t("checkout.zelleNameLabel")}</span> <span className="font-medium">{(selectedPm as { zelleName?: string }).zelleName}</span></p>
                        )}
                        {(selectedPm as { zelleEmail?: string }).zelleEmail && (
                          <p><span className="text-muted">{t("checkout.zelleEmailLabel")}</span> <span className="font-medium select-all">{(selectedPm as { zelleEmail?: string }).zelleEmail}</span></p>
                        )}
                      </div>
                    )}

                    {/* Pago Movil structured info */}
                    {(selectedPm as { type?: string }).type === "pago_movil" &&
                      ((selectedPm as { pmCedula?: string }).pmCedula || (selectedPm as { pmPhone?: string }).pmPhone || (selectedPm as { pmBank?: string }).pmBank) && (
                      <div className="text-sm space-y-1 mb-2">
                        {(selectedPm as { pmCedula?: string }).pmCedula && (
                          <p><span className="text-muted">{t("checkout.pmCedulaLabel")}</span> <span className="font-medium">{(selectedPm as { pmCedula?: string }).pmCedula}</span></p>
                        )}
                        {(selectedPm as { pmPhone?: string }).pmPhone && (
                          <p><span className="text-muted">{t("checkout.pmPhoneLabel")}</span> <span className="font-medium select-all">{(selectedPm as { pmPhone?: string }).pmPhone}</span></p>
                        )}
                        {(selectedPm as { pmBank?: string }).pmBank && (
                          <p><span className="text-muted">{t("checkout.pmBankLabel")}</span> <span className="font-medium">{(selectedPm as { pmBank?: string }).pmBank}</span></p>
                        )}
                      </div>
                    )}

                    {/* Optional instructions */}
                    {selectedPm.instructions && (
                      <p className="text-sm whitespace-pre-wrap text-foreground/80">
                        {selectedPm.instructions}
                      </p>
                    )}

                    {((selectedPm as { type?: string }).type === "zelle" || (selectedPm as { type?: string }).type === "pago_movil") && (
                      <div className="mt-3 pt-3 border-t border-warning/20">
                        <p className="text-sm font-medium text-foreground mb-1">
                          {(selectedPm as { type?: string }).type === "zelle"
                            ? t("checkout.memoZelle")
                            : t("checkout.memoPm")}
                        </p>
                        <div className="flex items-center gap-2">
                          <span className="px-3 py-1.5 bg-accent text-white rounded-lg font-mono text-lg font-bold tracking-wider select-all">
                            {memoCode}
                          </span>
                        </div>
                        <p className="text-xs text-muted mt-1.5">
                          {t("checkout.memoInfo")}
                        </p>
                      </div>
                    )}

                    {selectedPm?.convertCurrency && (
                      <div className="mt-3 pt-3 border-t border-warning/20">
                        {rateRefreshing && !cachedRate && !selectedPmCustomRate ? (
                          <p className="text-sm text-muted animate-pulse">
                            {t("checkout.loadingRate")}
                          </p>
                        ) : (cachedRate || selectedPmCustomRate) ? ((() => {
                          const compact =
                            (selectedPm as { type?: string }).type === "pago_movil" &&
                            (selectedPm as { showConversionDetail?: boolean }).showConversionDetail === false;
                          const isCustom = !!selectedPmCustomRate;
                          const sourceCurrency = isCustom ? "USD" : cachedRate!.currency;
                          const sourceSymbol = sourceCurrency === "EUR" ? "€" : "$";
                          return (
                          <div>
                            <p className="text-lg font-bold text-foreground">
                              {compact ? t("checkout.totalBsOnly", { bs: totalBs.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }) : t("checkout.totalBs", {
                                symbol: sourceSymbol,
                                total: total.toFixed(2),
                                bs: totalBs.toLocaleString("es-VE", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                }),
                              })}
                            </p>
                            {!compact && (
                              <p className="text-xs text-muted mt-1">
                                {isCustom
                                  ? t("checkout.customRate", { rate: rateValue.toFixed(2) })
                                  : t("checkout.bcvRate", {
                                      rate: rateValue.toFixed(2),
                                      currency: cachedRate!.currency,
                                      updated: new Date(cachedRate!.fetchedAt).toLocaleString(dateLocale(lang)),
                                    })}
                              </p>
                            )}
                          </div>
                          );
                        })()) : (
                          <p className="text-sm text-danger">
                            {t("checkout.rateError")}
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
                      {t("checkout.proofScreenshot")}
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
                            setFileError(t("checkout.fileTooBig"));
                            setFile(null);
                            e.target.value = "";
                            return;
                          }
                          if (!ALLOWED_TYPES.includes(selected.type)) {
                            setFileError(t("checkout.fileTypeError"));
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
                      {(selectedPm as { type?: string }).type === "pago_movil"
                        ? t("checkout.refLast4")
                        : t("checkout.refNumber")}
                    </label>
                    <input
                      type="text"
                      value={referenceNumber}
                      onChange={(e) => {
                        const val = (selectedPm as { type?: string }).type === "pago_movil"
                          ? e.target.value.replace(/\D/g, "").slice(-4)
                          : e.target.value;
                        setReferenceNumber(val);
                      }}
                      inputMode={(selectedPm as { type?: string }).type === "pago_movil" ? "numeric" : undefined}
                      className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors"
                      placeholder={(selectedPm as { type?: string }).type === "pago_movil"
                        ? t("checkout.refLast4Placeholder")
                        : t("checkout.refPlaceholder")}
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
                {t("checkout.terms", {
                  terms: `<a href="/terms" target="_blank" class="underline text-accent-light hover:text-accent">${t("checkout.termsLink")}</a>`,
                  privacy: `<a href="/privacy" target="_blank" class="underline text-accent-light hover:text-accent">${t("checkout.privacyLink")}</a>`,
                }).split(/(<a [^>]+>[^<]+<\/a>)/).map((part, idx) =>
                  part.startsWith("<a ") ? (
                    <span key={idx} dangerouslySetInnerHTML={{ __html: part }} />
                  ) : (
                    <span key={idx}>{part}</span>
                  )
                )}
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
              {submitting ? t("checkout.submitting") : t("checkout.submit")}
            </button>
          </form>
        </div>
      </main>
    </div>
    </EventTheme>
  );
}
