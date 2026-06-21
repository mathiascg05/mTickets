"use client";

import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/db";
import { useLanguage } from "@/lib/LanguageContext";
import { dateLocale } from "@/lib/i18n";
import { SUPER_ADMIN_EMAIL } from "@/lib/authHelpers";

type Transaction = {
  id: string;
  type: string;
  amount: number;
  description?: string;
  concertId?: string;
  createdAt: number;
};

type OrgBalance = {
  id: string;
  email: string;
  balance: number;
  transactions: Transaction[];
};

// Light concert metadata (no orders). Order-derived numbers — potential debt,
// tickets sold, gross revenue — come from /api/admin/platform-stats instead, so
// the browser never has to load every order row.
type Concert = {
  id: string;
  name: string;
  date: string;
  status: string;
  organizerEmail: string;
  isDemo?: boolean;
  platformFeeConfig: unknown;
};

// Order-derived stats fetched from the server.
type PlatformStats = {
  potentialDebt: number;
  perEvent: { id: string; ticketsSold: number; grossRevenue: number }[];
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

  const { user } = db.useAuth();
  const refreshToken = user?.refresh_token || "";

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [activePreset, setActivePreset] = useState<string>("all");

  // Order-derived stats come from the server (admin SDK reliably returns every
  // order row; the equivalent nested client query does not). Refetched whenever
  // the period changes; potentialDebt is a snapshot and ignores the period.
  const [platformStats, setPlatformStats] = useState<PlatformStats>({
    potentialDebt: 0,
    perEvent: [],
  });
  useEffect(() => {
    if (!refreshToken) return;
    let cancelled = false;
    const params = new URLSearchParams();
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    fetch(`/api/admin/platform-stats?${params.toString()}`, {
      headers: { Authorization: `Bearer ${refreshToken}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: PlatformStats | null) => {
        if (!cancelled && data) setPlatformStats(data);
      })
      .catch((err) => console.error("Failed to load platform stats:", err));
    return () => {
      cancelled = true;
    };
  }, [refreshToken, dateFrom, dateTo]);

  const perEventMap = useMemo(
    () => new Map(platformStats.perEvent.map((e) => [e.id, e])),
    [platformStats],
  );

  // Demo events are excluded from every aggregate. The super admin's own
  // (internal/test) account is also excluded from all org-level financials.
  const realConcerts = useMemo(
    () =>
      concerts.filter(
        (c) =>
          !c.isDemo &&
          c.organizerEmail.toLowerCase() !== SUPER_ADMIN_EMAIL,
      ),
    [concerts],
  );
  const demoConcertIds = useMemo(
    () => new Set(concerts.filter((c) => c.isDemo).map((c) => c.id)),
    [concerts],
  );
  // Organizers whose ONLY events are demo, plus the super admin account. Their
  // balances and unlinked deposits/fees are excluded from stats.
  const excludedOrgEmails = useMemo(() => {
    const realEmails = new Set(
      realConcerts.map((c) => c.organizerEmail.toLowerCase()),
    );
    const excluded = new Set<string>([SUPER_ADMIN_EMAIL]);
    for (const c of concerts) {
      const email = c.organizerEmail.toLowerCase();
      if (!realEmails.has(email)) excluded.add(email);
    }
    return excluded;
  }, [concerts, realConcerts]);

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
      if (excludedOrgEmails.has(bal.email.toLowerCase())) continue;
      for (const txn of bal.transactions || []) {
        if (txn.type !== "fee") continue;
        if (txn.concertId && demoConcertIds.has(txn.concertId)) continue;
        txns.push(txn);
      }
    }
    return txns;
  }, [organizerBalances, demoConcertIds, excludedOrgEmails]);

  // ── All deposit transactions with the originating organizer email ──
  const allDeposits = useMemo(() => {
    const list: (Transaction & { organizerEmail: string })[] = [];
    for (const bal of organizerBalances) {
      if (excludedOrgEmails.has(bal.email.toLowerCase())) continue;
      for (const txn of bal.transactions || []) {
        if (txn.type !== "deposit") continue;
        if (txn.concertId && demoConcertIds.has(txn.concertId)) continue;
        list.push({ ...txn, organizerEmail: bal.email });
      }
    }
    return list;
  }, [organizerBalances, demoConcertIds, excludedOrgEmails]);

  // ── Concert id → name map (for displaying linked event in deposit history) ──
  const concertNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of realConcerts) m.set(c.id, c.name);
    return m;
  }, [realConcerts]);

  // ── Per-org fee transactions sorted asc, used to attribute a deposit to
  //    the events whose fees were charged after it ──
  const feesByOrg = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const bal of organizerBalances) {
      if (excludedOrgEmails.has(bal.email.toLowerCase())) continue;
      const fees = (bal.transactions || [])
        .filter((t) => t.type === "fee")
        .filter((t) => !(t.concertId && demoConcertIds.has(t.concertId)))
        .slice()
        .sort((a, b) => a.createdAt - b.createdAt);
      map.set(bal.email.toLowerCase(), fees);
    }
    return map;
  }, [organizerBalances, demoConcertIds, excludedOrgEmails]);

  // ── Per-org deposits sorted asc, used to find the "next deposit" boundary ──
  const depositsByOrg = useMemo(() => {
    const map = new Map<string, typeof allDeposits>();
    for (const d of allDeposits) {
      const key = d.organizerEmail.toLowerCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.createdAt - b.createdAt);
    }
    return map;
  }, [allDeposits]);

  // Resolve the event name(s) a deposit funded. Explicit `concertId` wins;
  // otherwise infer via the org's fees in [deposit.createdAt, nextDeposit.createdAt).
  function eventNamesForDeposit(
    d: (typeof allDeposits)[number],
  ): string[] {
    if (d.concertId) {
      const name = concertNameMap.get(d.concertId);
      return name ? [name] : [];
    }
    const orgKey = d.organizerEmail.toLowerCase();
    const orgDeposits = depositsByOrg.get(orgKey) || [];
    const idx = orgDeposits.findIndex((x) => x.id === d.id);
    const upperBound =
      idx >= 0 && orgDeposits[idx + 1]
        ? orgDeposits[idx + 1].createdAt
        : Number.POSITIVE_INFINITY;
    const fees = feesByOrg.get(orgKey) || [];
    const ids = new Set<string>();
    for (const f of fees) {
      if (f.createdAt < d.createdAt) continue;
      if (f.createdAt >= upperBound) break;
      if (f.concertId) ids.add(f.concertId);
    }
    return [...ids]
      .map((id) => concertNameMap.get(id))
      .filter((n): n is string => Boolean(n));
  }

  // ── Snapshot metrics (unfiltered, current state) ──
  const snapshot = useMemo(() => {
    // Sum of organizer balances, skipping orgs whose only events are demo.
    // Orgs with no concerts at all (rare, defensive) are still counted.
    // Only positive balances are real prepaid credit held by the platform.
    // Negative balances (postpaid / overdraft debt) are NOT cash on hand —
    // they live in `materializedDebt` (Active Debt). Counting them here too
    // would double-represent the same debt and make this read negative.
    let totalPlatformBalance = 0;
    for (const bal of organizerBalances) {
      if (excludedOrgEmails.has(bal.email.toLowerCase())) continue;
      totalPlatformBalance += Math.max(0, bal.balance);
    }
    totalPlatformBalance = Math.round(totalPlatformBalance * 100) / 100;

    // Debt already materialized as a negative organizer balance (overdraft
    // approvals or postpaid approvals that pushed the balance below zero).
    let materializedDebt = 0;
    for (const bal of organizerBalances) {
      if (excludedOrgEmails.has(bal.email.toLowerCase())) continue;
      if (bal.balance < 0) materializedDebt += -bal.balance;
    }
    materializedDebt = Math.round(materializedDebt * 100) / 100;

    // Potential Debt (pending-approval fees) is order-derived and comes from
    // the server — see platformStats.potentialDebt.
    return { totalPlatformBalance, materializedDebt };
  }, [organizerBalances, excludedOrgEmails]);

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

    // Tickets sold + gross revenue are order-derived; the server already
    // filtered them to the active period (see platformStats.perEvent).
    const ticketsByEvent = new Map<string, number>();
    const grossByEvent = new Map<string, number>();
    for (const concert of realConcerts) {
      const e = perEventMap.get(concert.id);
      ticketsByEvent.set(concert.id, e?.ticketsSold || 0);
      grossByEvent.set(concert.id, e?.grossRevenue || 0);
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

    // ── Deposits in the period ──
    const filteredDeposits = allDeposits.filter((d) => inPeriod(d.createdAt));
    const totalDeposits =
      Math.round(
        filteredDeposits.reduce((s, d) => s + d.amount, 0) * 100,
      ) / 100;

    const utilizationRate =
      totalDeposits > 0
        ? Math.round((totalRevenue / totalDeposits) * 100)
        : 0;

    // Top 5 organizers by total deposited in the period
    const depositsByOrg = new Map<string, { total: number; count: number }>();
    for (const d of filteredDeposits) {
      const entry = depositsByOrg.get(d.organizerEmail) || { total: 0, count: 0 };
      entry.total += d.amount;
      entry.count += 1;
      depositsByOrg.set(d.organizerEmail, entry);
    }
    const topOrganizersByDeposits = [...depositsByOrg.entries()]
      .map(([email, v]) => ({
        email,
        total: Math.round(v.total * 100) / 100,
        count: v.count,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    return {
      totalRevenue,
      totalTicketsSold,
      totalGrossRevenue,
      eventBreakdown,
      totalDeposits,
      utilizationRate,
      topOrganizersByDeposits,
      filteredDeposits,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    realConcerts,
    organizerBalances,
    allFeeTransactions,
    allDeposits,
    perEventMap,
    dateFrom,
    dateTo,
  ]);

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

  // ── Monthly deposits chart (always global) ──
  const monthlyDepositsChartData = useMemo(() => {
    const byMonth = new Map<string, number>();
    for (const txn of allDeposits) {
      const d = new Date(txn.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
      byMonth.set(key, (byMonth.get(key) || 0) + txn.amount);
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
  }, [allDeposits, monthNames]);

  const maxMonthlyDeposits = Math.max(
    ...monthlyDepositsChartData.map((d) => d.amount),
    1,
  );

  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(dateLocale(lang), {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
    [lang],
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
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
        <div className="bg-surface border border-border rounded-xl p-5">
          <p className="text-muted text-sm">{t("admin.creditsReceived")}</p>
          <p className="text-3xl font-bold mt-1 text-accent-light">
            ${periodStats.totalDeposits.toFixed(2)}
          </p>
        </div>
        <div className="bg-surface border border-border rounded-xl p-5">
          <p className="text-muted text-sm">{t("admin.utilizationRate")}</p>
          <p className="text-3xl font-bold mt-1">
            {periodStats.utilizationRate}%
          </p>
          <p className="text-[10px] text-muted mt-0.5">
            {t("admin.utilizationSubLabel")}
          </p>
        </div>
      </div>

      {/* ── Section 4: Platform Snapshot (current state, unfiltered) ── */}
      <div className="bg-surface border border-border rounded-xl px-6 py-4">
        <h2 className="text-sm font-semibold text-muted uppercase tracking-wide mb-3">
          {t("admin.platformSnapshot")}
        </h2>
        <div className="flex flex-wrap gap-8">
          <div>
            <p className="text-2xl font-bold text-accent-light">
              ${snapshot.totalPlatformBalance.toFixed(2)}
            </p>
            <p className="text-xs text-muted">{t("admin.platformBalanceTotal")}</p>
          </div>
          <div className="border-l border-border pl-8">
            <p className="text-2xl font-bold text-warning">
              ${platformStats.potentialDebt.toFixed(2)}
            </p>
            <p className="text-xs text-muted">{t("admin.potentialDebt")}</p>
          </div>
          <div className="border-l border-border pl-8">
            <p className="text-2xl font-bold text-warning">
              ${snapshot.materializedDebt.toFixed(2)}
            </p>
            <p className="text-xs text-muted">{t("admin.materializedDebt")}</p>
          </div>
        </div>
      </div>

      {/* ── Section 5: Monthly Charts (Revenue + Deposits) ── */}
      {(monthlyChartData.length > 1 || monthlyDepositsChartData.length > 1) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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

          {monthlyDepositsChartData.length > 1 && (
            <div>
              <h2 className="text-xl font-semibold mb-4">
                {t("admin.monthlyDeposits")}
              </h2>
              <div className="bg-surface border border-border rounded-xl p-5">
                <div className="flex items-end gap-2 h-48 overflow-x-auto">
                  {monthlyDepositsChartData.map((d) => {
                    const pct = (d.amount / maxMonthlyDeposits) * 100;
                    return (
                      <div
                        key={d.key}
                        className="flex flex-col items-center flex-1 min-w-[48px] gap-1"
                      >
                        <span className="text-xs font-medium text-accent-light">
                          ${d.amount.toFixed(0)}
                        </span>
                        <div
                          className="w-full flex items-end"
                          style={{ height: "140px" }}
                        >
                          <div
                            className="w-full bg-accent-light/70 rounded-t-md transition-all hover:bg-accent-light"
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
        </div>
      )}

      {/* ── Section 6: Top Organizers by Deposits ── */}
      {periodStats.topOrganizersByDeposits.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">
            {t("admin.topOrganizersByDeposits")}
          </h2>
          <div className="bg-surface border border-border rounded-xl divide-y divide-border">
            {periodStats.topOrganizersByDeposits.map((o, idx) => (
              <div
                key={o.email}
                className="flex items-center justify-between px-5 py-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs text-muted w-5 shrink-0">
                    #{idx + 1}
                  </span>
                  <span className="font-medium truncate">{o.email}</span>
                </div>
                <div className="flex items-center gap-4 shrink-0 text-sm">
                  <span className="text-muted text-xs">
                    {o.count} {t("admin.depositsCount")}
                  </span>
                  <span className="font-bold text-success">
                    ${o.total.toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Section 7: Credit History Table ── */}
      <div>
        <h2 className="text-xl font-semibold mb-4">
          {t("admin.creditHistory")}
        </h2>
        {periodStats.filteredDeposits.length === 0 ? (
          <p className="text-muted text-center py-10">
            {t("admin.noDepositsInPeriod")}
          </p>
        ) : (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted uppercase tracking-wide bg-background">
                    <th className="px-4 py-3 font-medium">
                      {t("admin.depositDate")}
                    </th>
                    <th className="px-4 py-3 font-medium">
                      {t("admin.depositOrganizer")}
                    </th>
                    <th className="px-4 py-3 font-medium">
                      {t("admin.depositEvent")}
                    </th>
                    <th className="px-4 py-3 font-medium">
                      {t("admin.depositNote")}
                    </th>
                    <th className="px-4 py-3 font-medium text-right">
                      {t("admin.depositAmount")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {periodStats.filteredDeposits
                    .slice()
                    .sort((a, b) => b.createdAt - a.createdAt)
                    .slice(0, 50)
                    .map((d) => (
                      <tr key={d.id}>
                        <td className="px-4 py-2.5 whitespace-nowrap text-muted">
                          {dateFmt.format(d.createdAt)}
                        </td>
                        <td className="px-4 py-2.5 truncate max-w-[200px]">
                          {d.organizerEmail}
                        </td>
                        <td className="px-4 py-2.5 truncate max-w-[180px] text-muted">
                          {(() => {
                            const names = eventNamesForDeposit(d);
                            if (names.length === 0) return "—";
                            if (names.length <= 2) return names.join(", ");
                            return `${names.slice(0, 2).join(", ")} ${t("admin.plusNMore", { count: names.length - 2 })}`;
                          })()}
                        </td>
                        <td className="px-4 py-2.5 truncate max-w-[240px] text-muted">
                          {d.description || "—"}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-right font-bold text-success">
                          ${d.amount.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {periodStats.filteredDeposits.length > 50 && (
              <div className="px-4 py-2 text-xs text-muted bg-background text-center">
                {t("admin.moreRows", {
                  count: periodStats.filteredDeposits.length - 50,
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Section 8: Profitability by Event ── */}
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
