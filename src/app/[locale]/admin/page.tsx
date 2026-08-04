"use client";

import { db } from "@/lib/db";
import { useAuthContext } from "@/lib/AuthContext";
import { useLanguage } from "@/lib/LanguageContext";
import Link from "next/link";

export default function AdminDashboard() {
  const { email, isSuperAdmin } = useAuthContext();
  const { t } = useLanguage();

  const { isLoading, data } = db.useQuery({
    concerts: {
      $: {
        where: {
          status: { $ne: "finalized" },
          ...(isSuperAdmin ? {} : { organizerEmail: email }),
        },
      },
      ticketTypes: { orders: {} },
    },
  });

  // Events the user collaborates on (separate query — InstantDB types don't
  // support dotted paths inside `or` clauses, so we union client-side).
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

  // Guest list events the user owns (mirrors /admin/orders: only non-finalized,
  // filtered by organizerEmail for non-super-admins).
  const { data: guestListData } = db.useQuery({
    guestListEvents: {
      $: {
        where: {
          status: { $ne: "finalized" },
          ...(isSuperAdmin ? {} : { organizerEmail: email }),
        },
      },
      entries: { order: {} },
    },
  });

  if (isLoading || !data) {
    return <div className="animate-pulse text-muted">{t("common.loading")}</div>;
  }

  const ownedConcerts = data.concerts;
  const collabConcerts = (collabData?.eventCollaborators ?? [])
    .map((ec) => ec.concert)
    .filter(
      (c): c is NonNullable<typeof c> => c != null && c.status !== "finalized",
    );
  const seenIds = new Set<string>();
  const concerts = [...ownedConcerts, ...collabConcerts].filter((c) => {
    if (seenIds.has(c.id)) return false;
    seenIds.add(c.id);
    return true;
  });
  const orders = concerts.flatMap((c) => c.ticketTypes.flatMap((tt) => tt.orders));
  const pendingOrders = orders.filter((o) => o.status === "pending");
  const approvedOrders = orders.filter((o) => o.status === "approved");

  // Guest list metrics: iterate entries → order (one-to-one, may be array-wrapped).
  // Entries without a linked order (unredeemed invites) are not counted.
  const guestEvents = guestListData?.guestListEvents ?? [];
  let glPending = 0;
  let glApproved = 0;
  let glTotal = 0;
  for (const ev of guestEvents) {
    for (const e of ev.entries) {
      const raw = e.order as unknown;
      const o = (Array.isArray(raw) ? raw[0] : raw) as
        | { status: string }
        | undefined;
      if (!o) continue;
      glTotal++;
      if (o.status === "pending") glPending++;
      else if (o.status === "approved") glApproved++;
    }
  }

  const activeCount =
    concerts.filter((c) => c.status === "active").length +
    guestEvents.filter((ev) => ev.status === "active").length;
  const pendingCount = pendingOrders.length + glPending;
  const approvedCount = approvedOrders.length + glApproved;
  const totalCount = orders.length + glTotal;

  const stats = [
    {
      label: t("admin.activeEvents"),
      value: activeCount,
      color: "text-accent-light",
    },
    {
      label: t("admin.pendingOrders"),
      value: pendingCount,
      color: "text-warning",
    },
    {
      label: t("admin.approvedTickets"),
      value: approvedCount,
      color: "text-success",
    },
    {
      label: t("admin.totalOrders"),
      value: totalCount,
      color: "text-foreground",
    },
  ];

  return (
    <div>
      <h1 className="text-3xl font-bold mb-8">{t("admin.dashboard")}</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="bg-surface border border-border rounded-xl p-5"
          >
            <p className="text-muted text-sm">{stat.label}</p>
            <p className={`text-3xl font-bold mt-1 ${stat.color}`}>
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <Link
          href="/admin/concerts"
          className="bg-surface border border-border rounded-xl p-6 hover:border-accent/50 transition-colors group"
        >
          <h3 className="text-lg font-semibold group-hover:text-accent-light transition-colors">
            {t("admin.manageEvents")}
          </h3>
          <p className="text-muted text-sm mt-1">
            {t("admin.manageEventsSub")}
          </p>
        </Link>

        <Link
          href="/admin/orders"
          className="bg-surface border border-border rounded-xl p-6 hover:border-accent/50 transition-colors group"
        >
          <h3 className="text-lg font-semibold group-hover:text-accent-light transition-colors">
            {t("admin.reviewOrders")}
          </h3>
          <p className="text-muted text-sm mt-1">
            {t("admin.reviewOrdersSub")}
            {pendingCount > 0 && (
              <span className="ml-2 inline-flex px-2 py-0.5 bg-warning/10 text-warning rounded-full text-xs font-medium">
                {t("admin.pendingCount", { count: pendingCount })}
              </span>
            )}
          </p>
        </Link>

        <Link
          href="/admin/account"
          className="bg-surface border border-border rounded-xl p-6 hover:border-accent/50 transition-colors group"
        >
          <h3 className="text-lg font-semibold group-hover:text-accent-light transition-colors">
            {t("admin.account")}
          </h3>
          <p className="text-muted text-sm mt-1">{t("admin.accountDesc")}</p>
        </Link>

        {isSuperAdmin && (
          <Link
            href="/admin/audit"
            className="bg-surface border border-border rounded-xl p-6 hover:border-accent/50 transition-colors group"
          >
            <h3 className="text-lg font-semibold group-hover:text-accent-light transition-colors">
              {t("admin.audit")}
            </h3>
            <p className="text-muted text-sm mt-1">
              {t("admin.auditView.subtitle")}
            </p>
          </Link>
        )}
      </div>
    </div>
  );
}
