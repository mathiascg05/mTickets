"use client";

import { db } from "@/lib/db";
import Link from "next/link";
import { useParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useState, useEffect } from "react";

const ADMIN_EMAIL = process.env.NEXT_PUBLIC_ADMIN_EMAIL || "";

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-warning/10 text-warning border-warning/30",
    approved: "bg-success/10 text-success border-success/30",
    rejected: "bg-danger/10 text-danger border-danger/30",
    cancelled: "bg-muted/10 text-muted border-muted/30",
  };
  return (
    <span
      className={`inline-flex px-3 py-1 rounded-full text-sm font-medium border ${styles[status] || "bg-muted/10 text-muted border-muted/30"}`}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function EmailGate({
  orderId,
  onVerified,
}: {
  orderId: string;
  onVerified: () => void;
}) {
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
          setError(
            "If this email matches the order, details will be shown. Please check and try again.",
          );
        }
      })
      .catch(() => {
        setError("Something went wrong. Please try again.");
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
            <h1 className="text-xl font-bold">View Your Ticket</h1>
            <p className="text-muted text-sm mt-2">
              Enter the email address you used when purchasing to view your
              ticket details.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">
                Email Address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light focus:ring-1 focus:ring-accent-light/30 transition-colors"
                placeholder="your@email.com"
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
              {checking ? "Verifying..." : "View Ticket"}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

export default function TicketPage() {
  const params = useParams();
  const orderId = params.orderId as string;

  const [verified, setVerified] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  // Check sessionStorage and admin auth on mount
  const { user } = db.useAuth();

  useEffect(() => {
    const isAdmin =
      ADMIN_EMAIL && user?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
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
        <div className="animate-pulse text-muted">Loading ticket...</div>
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

  if (!order) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted">Ticket not found</div>
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
  const displayPrice = phase ? (phase as { price: number }).price : ticketType?.price;
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
              {concert?.name || "Event"}
            </h1>
            <p className="text-muted mb-6">{ticketType?.name || "Ticket"}</p>

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
                  Show this QR code at the entrance
                </p>
                {order.visited && (
                  <div className="inline-flex items-center gap-2 px-4 py-2 bg-success/10 text-success border border-success/30 rounded-full">
                    <span>{"✓"}</span> Already scanned
                  </div>
                )}
              </div>
            ) : order.status === "pending" ? (
              <div className="py-8">
                <div className="text-5xl mb-4">{"⏳"}</div>
                <p className="text-lg font-medium">Awaiting Approval</p>
                <p className="text-muted text-sm mt-2">
                  Your payment is being reviewed. You will receive your QR code
                  via email once approved.
                </p>
              </div>
            ) : order.status === "cancelled" ? (
              <div className="py-8">
                <div className="text-5xl mb-4">{"🚫"}</div>
                <p className="text-lg font-medium text-muted">
                  Ticket Cancelled
                </p>
                <p className="text-muted text-sm mt-2">
                  This ticket has been cancelled and is no longer valid. Please
                  contact the organizer for more information.
                </p>
              </div>
            ) : (
              <div className="py-8">
                <div className="text-5xl mb-4">{"✗"}</div>
                <p className="text-lg font-medium text-danger">
                  Order Rejected
                </p>
                <p className="text-muted text-sm mt-2">
                  Your payment could not be verified. Please contact the
                  organizer.
                </p>
              </div>
            )}
          </div>

          <div className="border-t border-border p-6 sm:p-8 bg-background/50">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted">Name</p>
                <p className="font-medium">
                  {order.firstName} {order.lastName}
                </p>
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
                <p className="text-muted">Payment Method</p>
                <p className="font-medium">{order.paymentMethod}</p>
              </div>
              {order.promoter && (
                <div>
                  <p className="text-muted">Promoter</p>
                  <p className="font-medium">{order.promoter}</p>
                </div>
              )}
              {ticketType && (
                <>
                  <div>
                    <p className="text-muted">Ticket Type</p>
                    <p className="font-medium">{ticketType.name}</p>
                  </div>
                  <div>
                    <p className="text-muted">Price</p>
                    <p className="font-medium">
                      {order.discountAmount && displayPrice != null ? (
                        <>
                          <span className="line-through text-muted">
                            ${displayPrice.toFixed(2)}
                          </span>{" "}
                          ${Math.max(0, displayPrice - order.discountAmount).toFixed(2)}
                        </>
                      ) : displayPrice != null ? (
                        `$${displayPrice.toFixed(2)}`
                      ) : (
                        "N/A"
                      )}
                    </p>
                  </div>
                  {order.couponCode && (
                    <div>
                      <p className="text-muted">Coupon</p>
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
              Other tickets in this purchase ({siblings.length})
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
                      View full ticket
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
