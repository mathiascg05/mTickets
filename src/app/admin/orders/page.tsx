"use client";

import { db } from "@/lib/db";
import { useAuthContext } from "@/lib/AuthContext";
import Link from "next/link";

export default function AdminOrdersPage() {
  const { email, isSuperAdmin } = useAuthContext();

  const { isLoading, data } = db.useQuery({
    concerts: {
      $: {
        ...(isSuperAdmin ? {} : { where: { organizerEmail: email } }),
        order: { createdAt: "desc" as const },
      },
      ticketTypes: { orders: {} },
    },
  });

  if (isLoading || !data) {
    return <div className="animate-pulse text-muted">Loading...</div>;
  }

  const { concerts } = data;

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Orders by Event</h1>

      {concerts.length === 0 ? (
        <p className="text-muted text-center py-12">No events yet.</p>
      ) : (
        <div className="space-y-3">
          {concerts.map((concert) => {
            const allOrders = concert.ticketTypes.flatMap((tt) => tt.orders);
            const pending = allOrders.filter((o) => o.status === "pending").length;
            const approved = allOrders.filter((o) => o.status === "approved").length;
            const rejected = allOrders.filter((o) => o.status === "rejected").length;
            const total = allOrders.length;
            const revenue = concert.ticketTypes.reduce((sum, tt) => {
              const approvedCount = tt.orders.filter((o) => o.status === "approved").length;
              const fee = (tt.price * ((tt as { feePercent?: number }).feePercent ?? 0)) / 100 + ((tt as { feeFixed?: number }).feeFixed ?? 0);
              return sum + approvedCount * (tt.price + fee);
            }, 0);

            return (
              <Link
                key={concert.id}
                href={`/admin/orders/${concert.id}`}
                className="flex flex-col sm:flex-row sm:items-center justify-between bg-surface border border-border rounded-xl p-5 hover:border-accent/50 transition-colors group"
              >
                <div className="mb-3 sm:mb-0">
                  <h3 className="font-semibold text-lg group-hover:text-accent-light transition-colors">
                    {concert.name}
                  </h3>
                  <p className="text-sm text-muted">
                    {concert.venue} &middot; {concert.date}
                  </p>
                </div>

                <div className="flex items-center gap-4 text-sm">
                  <div className="text-center">
                    <p className="text-xs text-muted">Total</p>
                    <p className="font-bold text-foreground">{total}</p>
                  </div>
                  {pending > 0 && (
                    <div className="text-center">
                      <p className="text-xs text-muted">Pending</p>
                      <p className="font-bold text-warning">{pending}</p>
                    </div>
                  )}
                  <div className="text-center">
                    <p className="text-xs text-muted">Approved</p>
                    <p className="font-bold text-success">{approved}</p>
                  </div>
                  {rejected > 0 && (
                    <div className="text-center">
                      <p className="text-xs text-muted">Rejected</p>
                      <p className="font-bold text-danger">{rejected}</p>
                    </div>
                  )}
                  <div className="text-center">
                    <p className="text-xs text-muted">Revenue</p>
                    <p className="font-bold text-accent-light">
                      ${revenue.toFixed(2)}
                    </p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
