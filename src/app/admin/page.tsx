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
        ...(isSuperAdmin ? {} : { where: { organizerEmail: email } }),
      },
      ticketTypes: { orders: {} },
    },
  });

  if (isLoading || !data) {
    return <div className="animate-pulse text-muted">{t("common.loading")}</div>;
  }

  const { concerts } = data;
  const orders = concerts.flatMap((c) => c.ticketTypes.flatMap((tt) => tt.orders));
  const activeConcerts = concerts.filter((c) => c.status === "active");
  const pendingOrders = orders.filter((o) => o.status === "pending");
  const approvedOrders = orders.filter((o) => o.status === "approved");

  const stats = [
    {
      label: t("admin.activeEvents"),
      value: activeConcerts.length,
      color: "text-accent-light",
    },
    {
      label: t("admin.pendingOrders"),
      value: pendingOrders.length,
      color: "text-warning",
    },
    {
      label: t("admin.approvedTickets"),
      value: approvedOrders.length,
      color: "text-success",
    },
    {
      label: t("admin.totalOrders"),
      value: orders.length,
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
            {pendingOrders.length > 0 && (
              <span className="ml-2 inline-flex px-2 py-0.5 bg-warning/10 text-warning rounded-full text-xs font-medium">
                {t("admin.pendingCount", { count: pendingOrders.length })}
              </span>
            )}
          </p>
        </Link>
      </div>
    </div>
  );
}
