"use client";

import { db } from "@/lib/db";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useState, useEffect, useCallback } from "react";

import { SUPER_ADMIN_EMAIL } from "@/lib/authHelpers";
import { useLanguage } from "@/lib/LanguageContext";

function StatusBadge({ status }: { status: string }) {
  const { t } = useLanguage();
  const styles: Record<string, string> = {
    pending: "bg-warning/10 text-warning border-warning/30",
    approved: "bg-success/10 text-success border-success/30",
    rejected: "bg-danger/10 text-danger border-danger/30",
    cancelled: "bg-muted/10 text-muted border-muted/30",
  };
  const statusLabels: Record<string, string> = {
    pending: t("common.pending"),
    approved: t("common.approved"),
    rejected: t("common.rejected"),
    cancelled: t("common.cancelled"),
  };
  return (
    <span
      className={`inline-flex px-3 py-1 rounded-full text-sm font-medium border ${styles[status] || "bg-muted/10 text-muted border-muted/30"}`}
    >
      {statusLabels[status] || status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function StepProgress({ status }: { status: string }) {
  const { t } = useLanguage();

  const steps = [
    {
      label: t("ticket.stepPaymentSent"),
      description: t("ticket.stepPaymentSentDesc"),
      state: "done" as const,
    },
    {
      label: t("ticket.stepUnderReview"),
      description: t("ticket.stepUnderReviewDesc"),
      state: (status === "pending" ? "active" : status === "approved" ? "done" : "error") as "done" | "active" | "error" | "upcoming",
    },
    {
      label: t("ticket.stepTicketReady"),
      description: t("ticket.stepTicketReadyDesc"),
      state: (status === "approved" ? "done" : "upcoming") as "done" | "active" | "error" | "upcoming",
    },
  ];

  const stateStyles = {
    done: "bg-success/10 border-success text-success",
    active: "bg-warning/10 border-warning text-warning animate-pulse",
    error: "bg-danger/10 border-danger text-danger",
    upcoming: "bg-muted/10 border-border text-muted",
  };

  const lineStyles = {
    done: "bg-success",
    active: "bg-warning",
    error: "bg-danger",
    upcoming: "bg-border",
  };

  return (
    <div className="py-4 px-2">
      {steps.map((step, i) => (
        <div key={step.label} className="flex gap-4">
          <div className="flex flex-col items-center">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 shrink-0 ${stateStyles[step.state]}`}>
              {step.state === "done" ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              ) : step.state === "active" ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
              ) : step.state === "error" ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 7h3v3H7zM14 7h3v3h-3zM7 14h3v3H7zM14 14h3v3h-3z" /></svg>
              )}
            </div>
            {i < steps.length - 1 && (
              <div className={`w-0.5 h-8 ${lineStyles[step.state]}`} />
            )}
          </div>
          <div className="pb-6 pt-1">
            <p className={`font-medium text-sm ${step.state === "upcoming" ? "text-muted" : ""}`}>{step.label}</p>
            <p className="text-xs text-muted mt-0.5">{step.description}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmailGate({
  orderId,
  onVerified,
}: {
  orderId: string;
  onVerified: () => void;
}) {
  const { t } = useLanguage();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setChecking(true);

    // We need to verify against the order's email via the API
    fetch(`/api/verify-ticket-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, email: email.trim() }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.verified) {
          sessionStorage.setItem(`ticket-verified-${orderId}`, "true");
          onVerified();
        } else {
          setError(t("ticket.emailMismatch"));
        }
      })
      .catch(() => {
        setError(t("ticket.error"));
      })
      .finally(() => setChecking(false));
  }

  return (
    <div className="min-h-screen">
      <header className="bg-accent text-white sticky top-0 z-10 shadow-md">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4">
          <a href="/" className="text-xl font-bold tracking-wide text-white">
            ma<span className="text-white/60">Tickets</span>
          </a>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 sm:px-6 py-12">
        <div className="bg-surface border border-border rounded-2xl p-6 sm:p-8">
          <div className="text-center mb-6">
            <div className="text-4xl mb-3">{"🎫"}</div>
            <h1 className="text-xl font-bold">{t("ticket.viewTitle")}</h1>
            <p className="text-muted text-sm mt-2">
              {t("ticket.emailGate")}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">
                {t("ticket.emailLabel")}
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light focus:ring-1 focus:ring-accent-light/30 transition-colors"
                placeholder={t("ticket.emailPlaceholder")}
              />
            </div>
            {error && (
              <p className="text-danger text-sm bg-danger/5 border border-danger/20 rounded-lg p-3">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={checking}
              className="w-full py-2.5 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              {checking ? t("ticket.verifying") : t("ticket.verify")}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

function DownloadImageButton({ orderId, email }: { orderId: string; email: string }) {
  const { t } = useLanguage();
  const [downloading, setDownloading] = useState(false);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    try {
      // Always request a fresh token to avoid stale/invalid tokens
      const res = await fetch(`/api/download-token/${orderId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error("Failed to get token");
      const data = await res.json();

      // Trigger download
      const link = document.createElement("a");
      link.href = `/api/ticket-image/${orderId}?token=${data.token}`;
      link.download = `entrada-${orderId}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      // Silently fail — user can retry
    } finally {
      setDownloading(false);
    }
  }, [orderId, email]);

  return (
    <button
      onClick={handleDownload}
      disabled={downloading}
      className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 bg-accent hover:bg-accent-dark text-white rounded-xl font-medium transition-colors disabled:opacity-50 text-sm"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      {downloading ? t("ticket.savingImage") : t("ticket.saveImage")}
    </button>
  );
}

export default function TicketPage() {
  const { t } = useLanguage();
  const params = useParams();
  const searchParams = useSearchParams();
  const orderId = params.orderId as string;
  const isNewPurchase = searchParams.get("new") === "1";

  const [verified, setVerified] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [showConfirmation, setShowConfirmation] = useState(isNewPurchase);

  // Check sessionStorage and admin auth on mount
  const { user } = db.useAuth();

  useEffect(() => {
    const isAdmin =
      user?.email?.toLowerCase() === SUPER_ADMIN_EMAIL;
    const sessionVerified =
      sessionStorage.getItem(`ticket-verified-${orderId}`) === "true";
    if (isAdmin || sessionVerified) {
      setVerified(true);
    }
    setCheckingSession(false);
  }, [orderId, user]);

  const { isLoading, error, data } = db.useQuery({
    orders: {
      $: { where: { id: orderId } },
      ticketType: {
        concert: {},
        phases: {},
      },
    },
  });

  const order = data?.orders?.[0];
  const purchaseGroupId = order?.purchaseGroupId;

  // Always call useQuery (rules of hooks) — use dummy query when no group ID
  const { data: siblingData } = db.useQuery(
    purchaseGroupId
      ? {
          orders: {
            $: { where: { purchaseGroupId } },
            ticketType: { phases: {} },
          },
        }
      : { orders: { $: { where: { id: "___none___" } } } },
  );

  if (checkingSession || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted">{t("common.loading")}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-danger">{t("ticket.error")}: {error.message}</div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted">{t("ticket.notFound")}</div>
      </div>
    );
  }

  // Show email gate if not verified — only show status + event name
  if (!verified) {
    return (
      <EmailGate orderId={orderId} onVerified={() => setVerified(true)} />
    );
  }

  const ticketType = order.ticketType;
  const concert = ticketType?.concert;
  const phase = order.phaseId
    ? (ticketType?.phases || []).find((p: { id: string }) => p.id === order.phaseId)
    : null;
  const basePrice = phase ? (phase as { price: number }).price : ticketType?.price;
  const feePercent = (ticketType as { feePercent?: number })?.feePercent ?? 0;
  const feeFixed = (ticketType as { feeFixed?: number })?.feeFixed ?? 0;
  const feeAmount = basePrice != null ? (basePrice * feePercent) / 100 + feeFixed : 0;
  const displayPrice = basePrice != null ? basePrice + feeAmount : null;
  const ticketUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/ticket/${order.id}`
      : "";

  // Filter siblings (same purchase group, different order)
  const siblings = (siblingData?.orders || [])
    .filter((o) => o.id !== orderId)
    .sort((a, b) => a.createdAt - b.createdAt);

  return (
    <div className="min-h-screen">
      <header className="bg-accent text-white sticky top-0 z-10 shadow-md">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4">
          <a href="/" className="text-xl font-bold tracking-wide text-white">
            ma<span className="text-white/60">Tickets</span>
          </a>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-12 space-y-6">
        {/* Post-purchase confirmation banner */}
        {showConfirmation && order.status === "pending" && (
          <div className="bg-surface border border-success/30 rounded-2xl p-6 sm:p-8 text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mb-4">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-success">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold mb-1">{t("ticket.thankYou")}</h2>
            {order.orderNumber && (
              <p className="text-sm font-mono font-bold text-accent-light tracking-wide mb-1">
                {order.orderNumber}
              </p>
            )}
            <p className="text-lg font-medium">{concert?.name}</p>
            <p className="text-muted text-sm">{ticketType?.name}</p>
            <p className="text-muted text-sm mt-4">{t("ticket.confirmationDesc")}</p>
          </div>
        )}

        {/* Main ticket card */}
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="p-6 sm:p-8 text-center">
            <StatusBadge status={order.status} />

            {order.orderNumber && (
              <p className="mt-3 text-sm font-mono font-bold text-accent-light tracking-wide">
                {order.orderNumber}
              </p>
            )}

            <h1 className="text-2xl font-bold mt-3 mb-1">
              {concert?.name || t("event.notFound")}
            </h1>
            <p className="text-muted mb-6">{ticketType?.name || t("ticket.ticketType")}</p>

            {order.status === "approved" ? (
              <div className="space-y-6">
                <div className="inline-block p-4 bg-white rounded-2xl shadow-lg shadow-accent/10">
                  <QRCodeSVG
                    value={ticketUrl}
                    size={220}
                    level="H"
                    fgColor="#1a2b4a"
                  />
                </div>
                <p className="text-sm text-muted">
                  {t("ticket.showQR")}
                </p>
                <DownloadImageButton orderId={orderId} email={order.email} />
                {order.visited && (
                  <div className="inline-flex items-center gap-2 px-4 py-2 bg-success/10 text-success border border-success/30 rounded-full">
                    {t("ticket.scanned")}
                  </div>
                )}
              </div>
            ) : order.status === "pending" ? (
              <div className="py-4">
                <p className="text-lg font-medium mb-4">{t("ticket.awaitingApproval")}</p>
                <StepProgress status={order.status} />
                <p className="text-muted text-xs mt-2 px-4">
                  {t("ticket.canClose")}
                </p>
              </div>
            ) : order.status === "cancelled" ? (
              <div className="py-8">
                <div className="text-5xl mb-4">{"🚫"}</div>
                <p className="text-lg font-medium text-muted">
                  {t("ticket.cancelledTitle")}
                </p>
                <p className="text-muted text-sm mt-2">
                  {t("ticket.cancelledDesc")}
                </p>
              </div>
            ) : (
              <div className="py-8">
                <div className="text-5xl mb-4">{"✗"}</div>
                <p className="text-lg font-medium text-danger">
                  {t("ticket.rejectedTitle")}
                </p>
                <p className="text-muted text-sm mt-2">
                  {t("ticket.rejectedDesc")}
                </p>
              </div>
            )}
          </div>

          <div className="border-t border-border p-6 sm:p-8 bg-background/50">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted">{t("common.name")}</p>
                <p className="font-medium">
                  {order.firstName} {order.lastName}
                </p>
              </div>
              <div>
                <p className="text-muted">{t("common.email")}</p>
                <p className="font-medium">{order.email}</p>
              </div>
              <div>
                <p className="text-muted">{t("common.cedula")}</p>
                <p className="font-medium">{order.cedula}</p>
              </div>
              <div>
                <p className="text-muted">{t("ticket.paymentMethod")}</p>
                <p className="font-medium">{order.paymentMethod}</p>
              </div>
              {order.promoter && (
                <div>
                  <p className="text-muted">{t("ticket.promoter")}</p>
                  <p className="font-medium">{order.promoter}</p>
                </div>
              )}
              {order.customFieldValues && (() => {
                try {
                  const vals = JSON.parse(order.customFieldValues as string);
                  return Object.entries(vals)
                    .filter(([, v]) => v)
                    .map(([key, val]) => (
                      <div key={key}>
                        <p className="text-muted">{key}</p>
                        <p className="font-medium">{String(val)}</p>
                      </div>
                    ));
                } catch { return null; }
              })()}
              {ticketType && (
                <>
                  <div>
                    <p className="text-muted">{t("ticket.ticketType")}</p>
                    <p className="font-medium">{ticketType.name}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-muted mb-1">{t("common.price")}</p>
                    <div className="text-sm space-y-0.5">
                      {basePrice != null && (
                        <p className="font-medium">${basePrice.toFixed(2)}</p>
                      )}
                      {feeAmount > 0 && (
                        <p className="text-muted">
                          {t("ticket.serviceFee", { amount: feeAmount.toFixed(2) })}
                        </p>
                      )}
                      {order.discountAmount != null && order.discountAmount > 0 && (
                        <p className="text-success">
                          {t("ticket.discountLabel", { amount: order.discountAmount.toFixed(2) })}
                        </p>
                      )}
                      {order.paymentMethodDiscount != null && order.paymentMethodDiscount > 0 && (
                        <p className="text-success">
                          {t("ticket.methodDiscountLabel", { amount: order.paymentMethodDiscount.toFixed(2) })}
                        </p>
                      )}
                      <p className="font-bold text-base">
                        {t("common.total")}: ${displayPrice != null
                          ? Math.max(
                              0,
                              displayPrice
                                - (order.discountAmount || 0)
                                - (order.paymentMethodDiscount || 0),
                            ).toFixed(2)
                          : "N/A"}
                      </p>
                    </div>
                  </div>
                  {order.couponCode && (
                    <div>
                      <p className="text-muted">{t("ticket.coupon")}</p>
                      <p className="font-medium text-success">
                        {order.couponCode}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Sibling tickets from the same purchase */}
        {siblings.length > 0 && (
          <>
            <h2 className="text-lg font-semibold text-center">
              {t("ticket.otherTickets", { count: siblings.length })}
            </h2>
            <div className="space-y-3">
              {siblings.map((sibling) => {
                const sibPhase = sibling.phaseId
                  ? (sibling.ticketType?.phases || []).find(
                      (p: { id: string }) => p.id === sibling.phaseId,
                    )
                  : null;
                const sibTicketUrl =
                  typeof window !== "undefined"
                    ? `${window.location.origin}/ticket/${sibling.id}`
                    : "";

                return (
                  <div
                    key={sibling.id}
                    className="bg-surface border border-border rounded-xl p-4 sm:p-5"
                  >
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <p className="font-medium">
                          {sibling.firstName} {sibling.lastName}
                        </p>
                        {sibling.orderNumber && (
                          <p className="text-xs font-mono text-accent-light">
                            {sibling.orderNumber}
                          </p>
                        )}
                        <p className="text-xs text-muted mt-0.5">
                          {sibling.ticketType?.name}
                          {sibPhase
                            ? ` · ${(sibPhase as { name: string }).name}`
                            : ""}
                        </p>
                      </div>
                      <StatusBadge status={sibling.status} />
                    </div>

                    {sibling.status === "approved" && (
                      <div className="flex justify-center my-3">
                        <div className="p-2 bg-white rounded-xl">
                          <QRCodeSVG
                            value={sibTicketUrl}
                            size={140}
                            level="H"
                            fgColor="#1a2b4a"
                          />
                        </div>
                      </div>
                    )}

                    <Link
                      href={`/ticket/${sibling.id}`}
                      className="block text-center text-sm text-accent-light hover:underline mt-2"
                    >
                      {t("ticket.viewFull")}
                    </Link>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
