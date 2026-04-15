"use client";

import { useMemo, useState } from "react";
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
    orders: { id: string; status: string; createdAt: number }[];
  }[];
};

interface SuperAdminStatsProps {
  concerts: Concert[];
  organizerBalances: OrgBalance[];
}

const MONTH_NAMES_ES = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];
const MONTH_NAMES_EN = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const MONTH_FULL_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const MONTH_FULL_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function SuperAdminStats({
  concerts,
  organizerBalances,
}: SuperAdminStatsProps) {
  const { t, lang } = useLanguage();
  const monthNames = lang === "es" ? MONTH_NAMES_ES : MONTH_NAMES_EN;
  const monthFull = lang === "es" ? MONTH_FULL_ES : MONTH_FULL_EN;

  // Collect all fee transactions once
  const allFeeTransactions = useMemo(() => {
    const txns: Transaction[] = [];
    for (const bal of organizerBalances) {
      for (const txn of bal.transactions || []) {
        if (txn.type === "fee") {
          txns.push(txn);
        }
      }
    }
    return txns;
  }, [organizerBalances]);

  // Derive available years from fee transactions
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    for (const txn of allFeeTransactions) {
      years.add(new Date(txn.createdAt).getFullYear());
    }
    // Also include years from orders
    for (const c of concerts) {
      for (const tt of c.ticketTypes) {
        for (const o of tt.orders) {
          if (o.status === "approved" && o.createdAt) {
            years.add(new Date(o.createdAt).getFullYear());
          }
        }
      }
    }
    return [...years].sort((a, b) => b - a);
  }, [allFeeTransactions, concerts]);

  const [filterYear, setFilterYear] = useState<number | "all">("all");
  const [filterMonth, setFilterMonth] = useState<number | "all">("all");

  // Filter helper
  function inPeriod(timestamp: number): boolean {
    if (filterYear === "all") return true;
    const d = new Date(timestamp);
    if (d.getFullYear() !== filterYear) return false;
    if (filterMonth === "all") return true;
    return d.getMonth() === filterMonth;
  }

  const stats = useMemo(() => {
    // Filtered fee transactions
    const filteredFees = allFeeTransactions.filter((txn) => inPeriod(txn.createdAt));

    const totalRevenue = filteredFees.reduce(
      (sum, txn) => sum + Math.abs(txn.amount),
      0,
    );

    // Fees by event
    const feesByEvent = new Map<string, number>();
    for (const txn of filteredFees) {
      if (txn.concertId) {
        feesByEvent.set(
          txn.concertId,
          (feesByEvent.get(txn.concertId) || 0) + Math.abs(txn.amount),
        );
      }
    }

    // Tickets sold & gross revenue per event (filtered by order date)
    const ticketsByEvent = new Map<string, number>();
    const grossByEvent = new Map<string, number>();
    for (const concert of concerts) {
      let sold = 0;
      let gross = 0;
      for (const tt of concert.ticketTypes) {
        const approved = tt.orders.filter(
          (o) => o.status === "approved" && inPeriod(o.createdAt),
        );
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

    // Per-event breakdown sorted by fees desc - include all events
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
      .filter((ev) => ev.ticketsSold > 0 || ev.feesCollected > 0)
      .sort((a, b) => b.feesCollected - a.feesCollected);

    return {
      totalRevenue,
      totalTicketsSold,
      totalEventsCount: concerts.length,
      activeConcertsCount: activeConcerts.length,
      avgFee,
      organizersCount: uniqueOrganizers.size,
      eventBreakdown,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [concerts, organizerBalances, allFeeTransactions, filterYear, filterMonth]);

  // Monthly revenue chart data
  const monthlyChartData = useMemo(() => {
    // Group all fee transactions by year-month
    const byMonth = new Map<string, number>();
    for (const txn of allFeeTransactions) {
      const d = new Date(txn.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
      byMonth.set(key, (byMonth.get(key) || 0) + Math.abs(txn.amount));
    }

    if (byMonth.size === 0) return [];

    // Sort by key chronologically
    const sorted = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    return sorted.map(([key, amount]) => {
      const [yearStr, monthStr] = key.split("-");
      const monthIdx = parseInt(monthStr, 10);
      return {
        key,
        label: `${monthNames[monthIdx]} ${yearStr}`,
        amount,
      };
    });
  }, [allFeeTransactions, monthNames]);

  const maxMonthlyRevenue = Math.max(...monthlyChartData.map((d) => d.amount), 1);

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
      label: t("admin.totalEvents"),
      value: stats.totalEventsCount,
      color: "text-foreground",
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
      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div>
          <label className="block text-xs text-muted mb-1">{t("admin.year")}</label>
          <select
            value={filterYear === "all" ? "all" : filterYear}
            onChange={(e) => {
              const v = e.target.value;
              setFilterYear(v === "all" ? "all" : parseInt(v, 10));
              setFilterMonth("all");
            }}
            className="px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-accent-light focus:ring-1 focus:ring-accent-light/30"
          >
            <option value="all">{t("admin.allTime")}</option>
            {availableYears.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        {filterYear !== "all" && (
          <div>
            <label className="block text-xs text-muted mb-1">{t("admin.month")}</label>
            <select
              value={filterMonth === "all" ? "all" : filterMonth}
              onChange={(e) => {
                const v = e.target.value;
                setFilterMonth(v === "all" ? "all" : parseInt(v, 10));
              }}
              className="px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-accent-light focus:ring-1 focus:ring-accent-light/30"
            >
              <option value="all">{t("admin.allMonths")}</option>
              {monthFull.map((name, i) => (
                <option key={i} value={i}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
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

      {/* Monthly Revenue Chart */}
      {monthlyChartData.length > 1 && (
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-4">
            {t("admin.monthlyRevenue")}
          </h2>
          <div className="bg-surface border border-border rounded-xl p-5">
            <div className="flex items-end gap-2 h-48 overflow-x-auto">
              {monthlyChartData.map((d) => {
                const pct = (d.amount / maxMonthlyRevenue) * 100;
                return (
                  <div
                    key={d.key}
                    className="flex flex-col items-center flex-1 min-w-[48px] gap-1"
                  >
                    <span className="text-xs font-medium text-success">
                      ${d.amount.toFixed(0)}
                    </span>
                    <div className="w-full flex items-end" style={{ height: "140px" }}>
                      <div
                        className="w-full bg-accent/70 rounded-t-md transition-all hover:bg-accent"
                        style={{ height: `${Math.max(pct, 2)}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-muted whitespace-nowrap">
                      {d.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

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
