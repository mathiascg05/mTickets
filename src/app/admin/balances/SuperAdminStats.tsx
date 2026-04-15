"use client";

import { useMemo } from "react";
import { useLanguage } from "@/lib/LanguageContext";

type Transaction = {
  id: string;
  type: string;
  amount: number;
  concertId?: string;
  createdAt: number;
};

type OrgBalance = {
  id: string;
  email: string;
  balance: number;
  transactions: Transaction[];
};

type Concert = {
  id: string;
  name: string;
  date: string;
  status: string;
  organizerEmail: string;
  platformFeeConfig: unknown;
  ticketTypes: {
    id: string;
    name: string;
    price: number;
    orders: { id: string; status: string }[];
  }[];
};

interface SuperAdminStatsProps {
  concerts: Concert[];
  organizerBalances: OrgBalance[];
}

export default function SuperAdminStats({
  concerts,
  organizerBalances,
}: SuperAdminStatsProps) {
  const { t } = useLanguage();

  const stats = useMemo(() => {
    // Collect all fee transactions
    const allFeeTransactions: (Transaction & { email: string })[] = [];
    for (const bal of organizerBalances) {
      for (const txn of bal.transactions || []) {
        if (txn.type === "fee") {
          allFeeTransactions.push({ ...txn, email: bal.email });
        }
      }
    }

    // Total revenue from fees
    const totalRevenue = allFeeTransactions.reduce(
      (sum, txn) => sum + Math.abs(txn.amount),
      0,
    );

    // Fees by event
    const feesByEvent = new Map<string, number>();
    for (const txn of allFeeTransactions) {
      if (txn.concertId) {
        feesByEvent.set(
          txn.concertId,
          (feesByEvent.get(txn.concertId) || 0) + Math.abs(txn.amount),
        );
      }
    }

    // Tickets sold & gross revenue per event
    const ticketsByEvent = new Map<string, number>();
    const grossByEvent = new Map<string, number>();
    for (const concert of concerts) {
      let sold = 0;
      let gross = 0;
      for (const tt of concert.ticketTypes) {
        const approved = tt.orders.filter((o) => o.status === "approved");
        sold += approved.length;
        gross += approved.length * tt.price;
      }
      ticketsByEvent.set(concert.id, sold);
      grossByEvent.set(concert.id, gross);
    }

    const totalTicketsSold = [...ticketsByEvent.values()].reduce(
      (a, b) => a + b,
      0,
    );
    const activeConcerts = concerts.filter((c) => c.status === "active");
    const uniqueOrganizers = new Set(
      concerts.map((c) => c.organizerEmail.toLowerCase()),
    );
    const avgFee = totalTicketsSold > 0 ? totalRevenue / totalTicketsSold : 0;

    // Per-event breakdown sorted by fees desc
    const eventBreakdown = concerts
      .map((c) => {
        const fc = c.platformFeeConfig as unknown;
        const config = Array.isArray(fc) ? fc[0] : fc;
        const billingMode =
          (config as { billingMode?: string } | null)?.billingMode || "prepaid";
        return {
          id: c.id,
          name: c.name,
          organizer: c.organizerEmail,
          date: c.date,
          status: c.status,
          ticketsSold: ticketsByEvent.get(c.id) || 0,
          grossRevenue: grossByEvent.get(c.id) || 0,
          feesCollected: feesByEvent.get(c.id) || 0,
          billingMode,
        };
      })
      .sort((a, b) => b.feesCollected - a.feesCollected);

    return {
      totalRevenue,
      totalTicketsSold,
      activeConcertsCount: activeConcerts.length,
      avgFee,
      organizersCount: uniqueOrganizers.size,
      eventBreakdown,
    };
  }, [concerts, organizerBalances]);

  const kpis = [
    {
      label: t("admin.totalRevenue"),
      value: `$${stats.totalRevenue.toFixed(2)}`,
      color: "text-success",
    },
    {
      label: t("admin.ticketsSold"),
      value: stats.totalTicketsSold,
      color: "text-accent-light",
    },
    {
      label: t("admin.activeEvents"),
      value: stats.activeConcertsCount,
      color: "text-accent-light",
    },
    {
      label: t("admin.avgFee"),
      value: `$${stats.avgFee.toFixed(2)}`,
      color: "text-foreground",
    },
    {
      label: t("admin.organizers"),
      value: stats.organizersCount,
      color: "text-foreground",
    },
  ];

  return (
    <div>
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className="bg-surface border border-border rounded-xl p-5"
          >
            <p className="text-muted text-sm">{kpi.label}</p>
            <p className={`text-3xl font-bold mt-1 ${kpi.color}`}>
              {kpi.value}
            </p>
          </div>
        ))}
      </div>

      {/* Profitability by Event */}
      <h2 className="text-xl font-semibold mb-4">
        {t("admin.profitByEvent")}
      </h2>

      {stats.eventBreakdown.length === 0 ? (
        <p className="text-muted text-center py-10">
          {t("admin.noStatsData")}
        </p>
      ) : (
        <div className="space-y-3">
          {stats.eventBreakdown.map((ev) => (
            <div
              key={ev.id}
              className="bg-surface border border-border rounded-xl p-5"
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-lg truncate">{ev.name}</p>
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        ev.status === "active"
                          ? "bg-success/10 text-success"
                          : "bg-muted/10 text-muted"
                      }`}
                    >
                      {ev.status}
                    </span>
                  </div>
                  <p className="text-sm text-muted truncate">
                    {ev.organizer} &middot; {ev.date}
                  </p>
                </div>
                <div className="flex flex-wrap gap-4 text-sm shrink-0">
                  <div className="text-center">
                    <p className="text-muted text-xs">
                      {t("admin.ticketsSold")}
                    </p>
                    <p className="font-bold text-accent-light">
                      {ev.ticketsSold}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-muted text-xs">
                      {t("admin.grossRevenue")}
                    </p>
                    <p className="font-bold">${ev.grossRevenue.toFixed(2)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-muted text-xs">
                      {t("admin.feesCollected")}
                    </p>
                    <p className="font-bold text-success">
                      ${ev.feesCollected.toFixed(2)}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-muted text-xs">
                      {t("admin.billingMode")}
                    </p>
                    <p className="font-medium">
                      {ev.billingMode === "postpaid"
                        ? t("admin.postpaid")
                        : t("admin.prepaid")}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
