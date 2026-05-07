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
  isDemo?: boolean;
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

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function monthsAgo(n: number) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function firstOfYear() {
  return `${new Date().getFullYear()}-01-01`;
}

export default function SuperAdminStats({
  concerts,
  organizerBalances,
}: SuperAdminStatsProps) {
  const { t, lang } = useLanguage();
  const monthNames = lang === "es" ? MONTH_NAMES_ES : MONTH_NAMES_EN;

  // Demo events are excluded from every aggregate.
  const realConcerts = useMemo(
    () => concerts.filter((c) => !c.isDemo),
    [concerts],
  );
  const demoConcertIds = useMemo(
    () => new Set(concerts.filter((c) => c.isDemo).map((c) => c.id)),
    [concerts],
  );

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [activePreset, setActivePreset] = useState<string>("all");

  function applyPreset(preset: string) {
    setActivePreset(preset);
    switch (preset) {
      case "thisMonth":
        setDateFrom(firstOfMonth());
        setDateTo(todayStr());
        break;
      case "last3":
        setDateFrom(monthsAgo(3));
        setDateTo(todayStr());
        break;
      case "thisYear":
        setDateFrom(firstOfYear());
        setDateTo(todayStr());
        break;
      case "all":
      default:
        setDateFrom("");
        setDateTo("");
        break;
    }
  }

  function inPeriod(timestamp: number): boolean {
    if (dateFrom) {
      const from = new Date(dateFrom + "T00:00:00").getTime();
      if (timestamp < from) return false;
    }
    if (dateTo) {
      const to = new Date(dateTo + "T23:59:59").getTime();
      if (timestamp > to) return false;
    }
    return true;
  }

  // ── Platform overview (unfiltered) ──
  const platform = useMemo(() => {
    const activeConcerts = realConcerts.filter((c) => c.status === "active");
    const uniqueOrganizers = new Set(
      realConcerts.map((c) => c.organizerEmail.toLowerCase()),
    );
    return {
      totalEvents: realConcerts.length,
      activeEvents: activeConcerts.length,
      organizers: uniqueOrganizers.size,
    };
  }, [realConcerts]);

  // ── All fee transactions (unfiltered, for chart) ──
  const allFeeTransactions = useMemo(() => {
    const txns: Transaction[] = [];
    for (const bal of organizerBalances) {
      for (const txn of bal.transactions || []) {
        if (txn.type !== "fee") continue;
        if (txn.concertId && demoConcertIds.has(txn.concertId)) continue;
        txns.push(txn);
      }
    }
    return txns;
  }, [organizerBalances, demoConcertIds]);

  // ── Period KPIs (filtered) ──
  const periodStats = useMemo(() => {
    const filteredFees = allFeeTransactions.filter((txn) =>
      inPeriod(txn.createdAt),
    );

    const totalRevenue = filteredFees.reduce(
      (sum, txn) => sum + Math.abs(txn.amount),
      0,
    );

    const feesByEvent = new Map<string, number>();
    for (const txn of filteredFees) {
      if (txn.concertId) {
        feesByEvent.set(
          txn.concertId,
          (feesByEvent.get(txn.concertId) || 0) + Math.abs(txn.amount),
        );
      }
    }

    const ticketsByEvent = new Map<string, number>();
    const grossByEvent = new Map<string, number>();
    for (const concert of realConcerts) {
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
    const totalGrossRevenue = [...grossByEvent.values()].reduce(
      (a, b) => a + b,
      0,
    );

    const eventBreakdown = realConcerts
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
      totalGrossRevenue,
      eventBreakdown,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realConcerts, organizerBalances, allFeeTransactions, dateFrom, dateTo]);

  // ── Monthly revenue chart (always global) ──
  const monthlyChartData = useMemo(() => {
    const byMonth = new Map<string, number>();
    for (const txn of allFeeTransactions) {
      const d = new Date(txn.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
      byMonth.set(key, (byMonth.get(key) || 0) + Math.abs(txn.amount));
    }
    if (byMonth.size === 0) return [];
    const sorted = [...byMonth.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
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

  const maxMonthlyRevenue = Math.max(
    ...monthlyChartData.map((d) => d.amount),
    1,
  );

  const presetBtnClass = (id: string) =>
    `px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
      activePreset === id
        ? "bg-accent text-white"
        : "bg-background border border-border text-muted hover:text-foreground"
    }`;

  return (
    <div className="space-y-8">
      {/* ── Section 1: Platform Overview ── */}
      <div className="bg-surface border border-border rounded-xl px-6 py-4">
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-sm font-semibold text-muted uppercase tracking-wide">
            {t("admin.platformOverview")}
          </h2>
        </div>
        <div className="flex flex-wrap gap-8">
          <div>
            <p className="text-2xl font-bold">{platform.totalEvents}</p>
            <p className="text-xs text-muted">{t("admin.totalEvents")}</p>
          </div>
          <div className="border-l border-border pl-8">
            <p className="text-2xl font-bold text-accent-light">
              {platform.activeEvents}
            </p>
            <p className="text-xs text-muted">{t("admin.activeEvents")}</p>
          </div>
          <div className="border-l border-border pl-8">
            <p className="text-2xl font-bold">{platform.organizers}</p>
            <p className="text-xs text-muted">{t("admin.organizers")}</p>
          </div>
        </div>
      </div>

      {/* ── Section 2: Date Range Filter ── */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-muted mb-1">
            {t("admin.dateFrom")}
          </label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setActivePreset("");
            }}
            className="px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-accent-light focus:ring-1 focus:ring-accent-light/30"
          />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">
            {t("admin.dateTo")}
          </label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setActivePreset("");
            }}
            className="px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-accent-light focus:ring-1 focus:ring-accent-light/30"
          />
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => applyPreset("thisMonth")}
            className={presetBtnClass("thisMonth")}
          >
            {t("admin.thisMonth")}
          </button>
          <button
            onClick={() => applyPreset("last3")}
            className={presetBtnClass("last3")}
          >
            {t("admin.last3Months")}
          </button>
          <button
            onClick={() => applyPreset("thisYear")}
            className={presetBtnClass("thisYear")}
          >
            {t("admin.thisYear")}
          </button>
          <button
            onClick={() => applyPreset("all")}
            className={presetBtnClass("all")}
          >
            {t("admin.allTime")}
          </button>
        </div>
      </div>

      {/* ── Section 3: Period KPIs ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-surface border border-border rounded-xl p-5">
          <p className="text-muted text-sm">{t("admin.totalRevenue")}</p>
          <p className="text-3xl font-bold mt-1 text-success">
            ${periodStats.totalRevenue.toFixed(2)}
          </p>
        </div>
        <div className="bg-surface border border-border rounded-xl p-5">
          <p className="text-muted text-sm">{t("admin.ticketsSold")}</p>
          <p className="text-3xl font-bold mt-1 text-accent-light">
            {periodStats.totalTicketsSold}
          </p>
        </div>
        <div className="bg-surface border border-border rounded-xl p-5">
          <p className="text-muted text-sm">{t("admin.grossRevenue")}</p>
          <p className="text-3xl font-bold mt-1">
            ${periodStats.totalGrossRevenue.toFixed(2)}
          </p>
        </div>
      </div>

      {/* ── Section 4: Monthly Revenue Chart ── */}
      {monthlyChartData.length > 1 && (
        <div>
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
                    <div
                      className="w-full flex items-end"
                      style={{ height: "140px" }}
                    >
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

      {/* ── Section 5: Profitability by Event ── */}
      <div>
        <h2 className="text-xl font-semibold mb-4">
          {t("admin.profitByEvent")}
        </h2>

        {periodStats.eventBreakdown.length === 0 ? (
          <p className="text-muted text-center py-10">
            {t("admin.noStatsData")}
          </p>
        ) : (
          <div className="space-y-3">
            {periodStats.eventBreakdown.map((ev) => (
              <div
                key={ev.id}
                className="bg-surface border border-border rounded-xl p-5"
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-lg truncate">
                        {ev.name}
                      </p>
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
                      <p className="font-bold">
                        ${ev.grossRevenue.toFixed(2)}
                      </p>
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
    </div>
  );
}
