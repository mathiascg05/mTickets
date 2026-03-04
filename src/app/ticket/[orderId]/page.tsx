"use client";

import { db } from "@/lib/db";
import { useParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending:
      "bg-warning/10 text-warning border-warning/30",
    approved:
      "bg-success/10 text-success border-success/30",
    rejected:
      "bg-danger/10 text-danger border-danger/30",
    cancelled:
      "bg-muted/10 text-muted border-muted/30",
  };
  return (
    <span
      className={`inline-flex px-3 py-1 rounded-full text-sm font-medium border ${styles[status] || "bg-muted/10 text-muted border-muted/30"}`}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export default function TicketPage() {
  const params = useParams();
  const orderId = params.orderId as string;

  const { isLoading, error, data } = db.useQuery({
    orders: {
      $: { where: { id: orderId } },
      ticketType: {
        concert: {},
      },
    },
  });

  if (isLoading) {
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

  const order = data.orders[0];
  if (!order) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted">Ticket not found</div>
      </div>
    );
  }

  const ticketType = order.ticketType;
  const concert = ticketType?.concert;
  const ticketUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/ticket/${orderId}`
      : "";

  return (
    <div className="min-h-screen">
      <header className="bg-accent text-white sticky top-0 z-10 shadow-md">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4">
          <a href="/" className="text-xl font-bold tracking-wide text-white">mTickets</a>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-12">
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="p-6 sm:p-8 text-center">
            <StatusBadge status={order.status} />

            <h1 className="text-2xl font-bold mt-4 mb-1">
              {concert?.name || "Event"}
            </h1>
            <p className="text-muted mb-6">
              {ticketType?.name || "Ticket"}
            </p>

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
                  Your payment is being reviewed. You&apos;ll see your QR
                  code here once approved.
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
                      {order.discountAmount
                        ? <>
                            <span className="line-through text-muted">${ticketType.price.toFixed(2)}</span>{" "}
                            ${(ticketType.price - order.discountAmount).toFixed(2)}
                          </>
                        : `$${ticketType.price.toFixed(2)}`}
                    </p>
                  </div>
                  {order.couponCode && (
                    <div>
                      <p className="text-muted">Coupon</p>
                      <p className="font-medium text-success">{order.couponCode}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <p className="text-center text-sm text-muted mt-6">
          Bookmark this page to access your ticket later.
        </p>
      </main>
    </div>
  );
}
