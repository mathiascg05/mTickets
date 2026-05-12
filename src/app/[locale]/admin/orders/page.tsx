"use client";

import { memo, useMemo } from "react";
import { db } from "@/lib/db";
import { useAuthContext } from "@/lib/AuthContext";
import { getEventRevenue } from "@/lib/order-pricing";
import Link from "next/link";
import type { InstaQLEntity } from "@instantdb/react";
import type { AppSchema } from "@/instant.schema";

type ConcertWithOrders = InstaQLEntity<
  AppSchema,
  "concerts",
  { ticketTypes: { orders: object } }
>;

const ConcertOrderRow = memo(function ConcertOrderRow({
  concert,
}: {
  concert: ConcertWithOrders;
}) {
  const stats = useMemo(() => {
    let total = 0;
    let pending = 0;
    let approved = 0;
    let rejected = 0;
    for (const tt of concert.ticketTypes) {
      for (const o of tt.orders) {
        total++;
        if (o.status === "pending") pending++;
        else if (o.status === "approved") approved++;
        else if (o.status === "rejected") rejected++;
      }
    }
    return {
      total,
      pending,
      approved,
      rejected,
      revenue: getEventRevenue(concert),
    };
  }, [concert]);

  return (
    <Link
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
          <p className="font-bold text-foreground">{stats.total}</p>
        </div>
        {stats.pending > 0 && (
          <div className="text-center">
            <p className="text-xs text-muted">Pending</p>
            <p className="font-bold text-warning">{stats.pending}</p>
          </div>
        )}
        <div className="text-center">
          <p className="text-xs text-muted">Approved</p>
          <p className="font-bold text-success">{stats.approved}</p>
        </div>
        {stats.rejected > 0 && (
          <div className="text-center">
            <p className="text-xs text-muted">Rejected</p>
            <p className="font-bold text-danger">{stats.rejected}</p>
          </div>
        )}
        <div className="text-center">
          <p className="text-xs text-muted">Revenue</p>
          <p className="font-bold text-accent-light">
            ${stats.revenue.toFixed(2)}
          </p>
        </div>
      </div>
    </Link>
  );
});

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

  const { data: collabData } = db.useQuery(
    isSuperAdmin || !email
      ? null
      : {
          eventCollaborators: {
            $: { where: { email } },
            concert: { ticketTypes: { orders: {} } },
          },
        },
  );

  const concerts = useMemo(() => {
    if (!data) return [];
    const ownedConcerts = data.concerts;
    const collabConcerts = (collabData?.eventCollaborators ?? [])
      .map((ec) => ec.concert)
      .filter((c): c is NonNullable<typeof c> => c != null);
    const seenIds = new Set<string>();
    return [...ownedConcerts, ...collabConcerts]
      .filter((c) => {
        if (seenIds.has(c.id)) return false;
        seenIds.add(c.id);
        return true;
      })
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }, [data, collabData]);

  if (isLoading || !data) {
    return <div className="animate-pulse text-muted">Loading...</div>;
  }

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Orders by Event</h1>

      {concerts.length === 0 ? (
        <p className="text-muted text-center py-12">No events yet.</p>
      ) : (
        <div className="space-y-3">
          {concerts.map((concert) => (
            <ConcertOrderRow key={concert.id} concert={concert} />
          ))}
        </div>
      )}
    </div>
  );
}
