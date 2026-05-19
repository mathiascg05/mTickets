"use client";

import { db } from "@/lib/db";
import { useAuthContext } from "@/lib/AuthContext";
import { useLanguage } from "@/lib/LanguageContext";
import { dateLocale } from "@/lib/i18n";
import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type FilterStatus = "all" | "pending" | "approved" | "cancelled" | "rejected";

type GuestOrder = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  cedula: string;
  status: string;
  visited: boolean;
  visitedAt?: number;
  paymentMethod?: string;
  paymentProofPath?: string;
  proofReferenceNumber?: string;
  pricePaid: number;
  purchaseRate?: number;
  purchaseRateCurrency?: string;
  purchaseAmountBs?: number;
  orderNumber?: string;
  createdAt: number;
  ticketType?: { id: string; name: string }[] | { id: string; name: string };
};

function getOrderTicketType(o: GuestOrder) {
  const raw = o.ticketType;
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function StatusBadge({ status, t }: { status: string; t: (k: string) => string }) {
  const styles: Record<string, string> = {
    pending: "bg-warning/10 text-warning border-warning/30",
    approved: "bg-success/10 text-success border-success/30",
    rejected: "bg-danger/10 text-danger border-danger/30",
    cancelled: "bg-muted/10 text-muted border-muted/30",
  };
  const labelMap: Record<string, string> = {
    pending: t("common.pending"),
    approved: t("common.approved"),
    rejected: t("common.rejected"),
    cancelled: t("common.cancelled"),
  };
  return (
    <span
      className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium border ${
        styles[status] || "bg-muted/10 text-muted border-muted/30"
      }`}
    >
      {labelMap[status] || status}
    </span>
  );
}

function escapeCsv(val: string) {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

export default function GuestListOrdersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: eventId } = use(params);
  const { email, isSuperAdmin } = useAuthContext();
  const { user } = db.useAuth();
  const refreshToken = user?.refresh_token || "";
  const { t, lang } = useLanguage();
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<string>("all");
  const [ticketTypeFilter, setTicketTypeFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [scannedSearch, setScannedSearch] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkApproving, setBulkApproving] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  const { isLoading, data } = db.useQuery({
    guestListEvents: {
      $: { where: { id: eventId } },
      entries: {
        order: { ticketType: {} },
      },
      ticketTypes: {
        $: { order: { sortOrder: "asc" as const } },
      },
      paymentMethods: {
        $: { order: { sortOrder: "asc" as const } },
      },
    },
  });

  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const event = data?.guestListEvents[0];

  const allOrders = useMemo<GuestOrder[]>(() => {
    if (!event) return [];
    const out: GuestOrder[] = [];
    for (const e of event.entries || []) {
      const raw = e.order as unknown;
      const o = (Array.isArray(raw) ? raw[0] : raw) as GuestOrder | undefined;
      if (o) out.push(o);
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }, [event]);

  if (isLoading || !data) {
    return <div className="animate-pulse text-muted">{t("common.loading")}</div>;
  }
  if (!event) {
    return <div className="text-muted">{t("guestList.notFound")}</div>;
  }
  const isOwner = isSuperAdmin || event.organizerEmail === email;
  if (!isOwner) {
    return <div className="text-muted">Forbidden</div>;
  }

  const totalOrders = allOrders.length;
  const pendingCount = allOrders.filter((o) => o.status === "pending").length;
  const approvedCount = allOrders.filter((o) => o.status === "approved").length;
  const rejectedCount = allOrders.filter((o) => o.status === "rejected").length;
  const cancelledCount = allOrders.filter((o) => o.status === "cancelled").length;
  const otherCount = Math.max(
    0,
    totalOrders - approvedCount - pendingCount - rejectedCount - cancelledCount,
  );
  const revenue = allOrders
    .filter((o) => o.status === "approved")
    .reduce((s, o) => s + (o.pricePaid || 0), 0);
  const totalScanned = allOrders.filter((o) => o.visited).length;
  const totalGuests = (event.entries || []).length;
  const ticketTypes = (event.ticketTypes || []) as { id: string; name: string; quantity?: number }[];
  const allTypesHaveCapacity =
    ticketTypes.length > 0 && ticketTypes.every((t) => typeof t.quantity === "number");
  const totalCapacity = allTypesHaveCapacity
    ? ticketTypes.reduce((s, t) => s + (t.quantity ?? 0), 0)
    : null;
  const scannedPercent =
    approvedCount > 0 ? Math.round((totalScanned / approvedCount) * 100) : 0;

  const orderStatusPercents = (() => {
    const buckets = [
      { key: "approved", count: approvedCount },
      { key: "pending", count: pendingCount },
      { key: "rejected", count: rejectedCount },
      { key: "cancelled", count: cancelledCount },
      { key: "other", count: otherCount },
    ];
    const result: Record<string, number> = {
      approved: 0,
      pending: 0,
      rejected: 0,
      cancelled: 0,
      other: 0,
    };
    if (totalOrders === 0) return result;
    const raw = buckets.map((b) => ({
      key: b.key,
      exact: (b.count / totalOrders) * 100,
    }));
    const floored = raw.map((r) => ({
      ...r,
      floor: Math.floor(r.exact),
      rem: r.exact - Math.floor(r.exact),
    }));
    let remaining = 100 - floored.reduce((s, r) => s + r.floor, 0);
    floored
      .slice()
      .sort((a, b) => b.rem - a.rem)
      .forEach((r) => {
        if (remaining > 0) {
          r.floor += 1;
          remaining -= 1;
        }
      });
    floored.forEach((r) => {
      result[r.key] = r.floor;
    });
    return result;
  })();

  const uniquePaymentMethods = Array.from(
    new Set(allOrders.map((o) => o.paymentMethod || "").filter(Boolean)),
  );

  // Map payment method name → convertCurrency for Bs/$ split in CSV
  const pmCurrencyMap: Record<string, string> = {};
  for (const pm of (event.paymentMethods || []) as {
    name: string;
    convertCurrency?: string;
  }[]) {
    if (pm.convertCurrency) {
      pmCurrencyMap[pm.name] = pm.convertCurrency;
    }
  }

  const filteredOrders = allOrders.filter((o) => {
    if (filter !== "all" && o.status !== filter) return false;
    if (paymentMethodFilter !== "all" && (o.paymentMethod || "") !== paymentMethodFilter)
      return false;
    if (ticketTypeFilter !== "all" && getOrderTicketType(o)?.name !== ticketTypeFilter)
      return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const fields = [
        o.firstName,
        o.lastName,
        `${o.firstName} ${o.lastName}`,
        o.email,
        o.cedula,
        o.paymentMethod || "",
        o.orderNumber || "",
        o.proofReferenceNumber || "",
      ];
      if (!fields.some((f) => f && f.toLowerCase().includes(q))) return false;
    }
    return true;
  });

  async function action(orderId: string, act: "approve" | "reject" | "cancel") {
    if (act === "cancel" && !confirm(t("guestList.confirmCancelOrder"))) return;
    setActingId(orderId);
    try {
      const res = await fetch("/api/guest-list/approve-order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${refreshToken}`,
        },
        body: JSON.stringify({ orderId, action: act }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || "Failed");
      } else {
        toast.success(
          act === "approve"
            ? t("guestList.approved")
            : act === "cancel"
              ? t("guestList.cancelled")
              : t("guestList.rejected"),
        );
      }
    } catch (err) {
      toast.error(String(err));
    } finally {
      setActingId(null);
    }
  }

  async function resendTicket(orderId: string) {
    setResendingId(orderId);
    try {
      const res = await fetch("/api/guest-list/resend-ticket", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${refreshToken}`,
        },
        body: JSON.stringify({ orderId }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || "Failed");
      } else {
        toast.success(t("guestList.resendDone"));
      }
    } catch (err) {
      toast.error(String(err));
    } finally {
      setResendingId(null);
    }
  }

  function toggleSelect(orderId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  function toggleSelectAllPending() {
    const pendingIds = filteredOrders
      .filter((o) => o.status === "pending")
      .map((o) => o.id);
    const allSelected = pendingIds.every((id) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingIds));
    }
  }

  async function bulkApprove() {
    const ids = Array.from(selectedIds).filter((id) =>
      allOrders.find((o) => o.id === id && o.status === "pending"),
    );
    if (ids.length === 0) return;
    if (!confirm(t("guestList.bulkConfirm", { count: ids.length }))) return;
    setBulkApproving(true);
    const CHUNK = 50;
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      chunks.push(ids.slice(i, i + CHUNK));
    }
    let totalApproved = 0;
    let totalSkipped = 0;
    let totalFailed = 0;
    let aborted = false;
    try {
      for (let i = 0; i < chunks.length; i++) {
        if (chunks.length > 1) {
          setBulkProgress({ done: i, total: chunks.length });
        }
        const res = await fetch("/api/guest-list/bulk-approve", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${refreshToken}`,
          },
          body: JSON.stringify({ orderIds: chunks[i] }),
        });
        const body = await res.json();
        if (!res.ok) {
          toast.error(body.error || "Failed");
          aborted = true;
          break;
        }
        totalApproved += body.approved ?? 0;
        totalSkipped += body.skipped ?? 0;
        totalFailed += body.failed ?? 0;
      }
      if (!aborted) {
        toast.success(
          t("guestList.bulkResult", {
            approved: totalApproved,
            skipped: totalSkipped,
            failed: totalFailed,
          }),
        );
        setSelectedIds(new Set());
      }
    } catch (err) {
      toast.error(String(err));
    } finally {
      setBulkApproving(false);
      setBulkProgress(null);
    }
  }

  async function viewProof(orderId: string) {
    try {
      const res = await fetch(`/api/guest-list/payment-proof/${orderId}`, {
        headers: { Authorization: `Bearer ${refreshToken}` },
      });
      if (!res.ok) {
        toast.error(t("guestList.proofLoadError"));
        return;
      }
      const blob = await res.blob();
      setPreviewUrl(URL.createObjectURL(blob));
    } catch {
      toast.error(t("guestList.proofLoadError"));
    }
  }

  function downloadCsv() {
    const headers = [
      "Order #",
      t("common.firstName"),
      t("common.lastName"),
      t("common.email"),
      t("common.cedula"),
      t("guestList.colTicketType"),
      t("guestList.paymentMethod"),
      t("guestList.referenceNumber"),
      "Amount ($)",
      "Amount (Bs)",
      t("common.status"),
      t("common.date"),
      t("guestList.colVisited"),
    ];
    const sorted = [...allOrders].sort((a, b) => a.createdAt - b.createdAt);
    const rows = sorted.map((o) => {
      const tt = getOrderTicketType(o);
      const effectivePrice = o.pricePaid;
      const currency = pmCurrencyMap[o.paymentMethod || ""];
      const rate = o.purchaseRate ?? null;
      const amountUsd = currency ? "" : effectivePrice.toFixed(2);
      const amountBs = currency
        ? o.purchaseAmountBs != null
          ? o.purchaseAmountBs.toFixed(2)
          : rate != null
            ? (effectivePrice * rate).toFixed(2)
            : ""
        : "";
      return [
        escapeCsv(o.orderNumber || "---"),
        escapeCsv(o.firstName),
        escapeCsv(o.lastName),
        escapeCsv(o.email),
        escapeCsv(o.cedula),
        escapeCsv(tt?.name || ""),
        escapeCsv(o.paymentMethod || ""),
        escapeCsv(o.proofReferenceNumber || ""),
        amountUsd,
        amountBs,
        o.status,
        escapeCsv(new Date(o.createdAt).toLocaleString()),
        o.visited ? "yes" : "no",
      ].join(",");
    });
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob(["﻿" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${event!.name.replace(/[^a-zA-Z0-9]/g, "_")}_guest_list_orders.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const filters: { label: string; value: FilterStatus }[] = [
    { label: t("common.all"), value: "all" },
    { label: t("common.pending"), value: "pending" },
    { label: t("common.approved"), value: "approved" },
    { label: t("common.rejected"), value: "rejected" },
    { label: t("common.cancelled"), value: "cancelled" },
  ];

  return (
    <div>
      <Link
        href="/admin/orders"
        className="text-sm text-muted hover:text-accent-light transition-colors mb-4 inline-block"
      >
        ← {t("admin.allEvents")}
      </Link>

      <div className="flex items-start justify-between gap-4 mb-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-3xl font-bold">{event.name}</h1>
            <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-accent/10 text-accent-light border border-accent/30">
              {t("guestList.title")}
            </span>
          </div>
          <p className="text-muted">
            {event.venue ? `${event.venue} · ` : ""}
            {event.date}
          </p>
        </div>
        <Link
          href={`/admin/guest-lists/${eventId}`}
          className="px-3 py-1.5 text-sm font-medium bg-surface border border-border hover:border-accent/50 rounded-lg whitespace-nowrap"
        >
          {t("guestList.manageList")}
        </Link>
      </div>

      <div className="bg-surface border border-border rounded-xl p-6 mt-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">{t("admin.eventSummary")}</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="border-l-4 border-accent-light pl-4">
            <p className="text-sm text-muted">{t("admin.totalOrders")}</p>
            <p className="text-3xl font-bold text-accent-light">{totalOrders}</p>
          </div>
          <div className="border-l-4 border-success pl-4">
            <p className="text-sm text-muted">{t("admin.ticketsIssued")}</p>
            <p className="text-3xl font-bold text-success">{approvedCount}</p>
          </div>
          <div className="border-l-4 border-accent-light pl-4">
            <p className="text-sm text-muted">{t("admin.totalRevenue")}</p>
            <p className="text-3xl font-bold text-accent-light">
              ${revenue.toFixed(2)}
            </p>
          </div>
          <div className="border-l-4 border-warning pl-4">
            <p className="text-sm text-muted">{t("admin.pendingApproval")}</p>
            <p className="text-3xl font-bold text-warning">{pendingCount}</p>
          </div>
        </div>

        <div className="mt-6 p-4 bg-background rounded-lg">
          <div className="grid grid-cols-3 gap-4 text-center mb-4">
            <div>
              <p className="text-[10px] font-medium text-muted uppercase tracking-widest">
                {t("admin.capacity")}
              </p>
              <p className="text-2xl font-bold text-foreground">
                {totalCapacity != null ? totalCapacity : "∞"}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-medium text-success uppercase tracking-widest">
                {t("admin.soldLabel")}
              </p>
              <p className="text-2xl font-bold text-success">{approvedCount}</p>
            </div>
            <div>
              <p className="text-[10px] font-medium text-muted uppercase tracking-widest">
                {t("admin.scannedLabel")}
              </p>
              <p className="text-2xl font-bold text-foreground">{totalScanned}</p>
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <div className="flex items-center gap-3 text-xs mb-1.5 flex-wrap">
                <span className="text-muted">{t("admin.orderStatus")}</span>
                <span className="text-success font-medium">
                  {t("common.approved")} {orderStatusPercents.approved}%
                </span>
                <span className="text-warning font-medium">
                  {t("common.pending")} {orderStatusPercents.pending}%
                </span>
                <span className="text-danger font-medium">
                  {t("common.rejected")} {orderStatusPercents.rejected}%
                </span>
                {cancelledCount > 0 && (
                  <span className="text-muted font-medium">
                    {t("common.cancelled")} {orderStatusPercents.cancelled}%
                  </span>
                )}
                {otherCount > 0 && (
                  <span className="text-muted font-medium">
                    {t("common.other")} {orderStatusPercents.other}%
                  </span>
                )}
              </div>
              <div className="w-full bg-border rounded-full h-2.5 flex overflow-hidden">
                {approvedCount > 0 && (
                  <div
                    className="bg-success h-2.5 transition-all"
                    style={{ width: `${(approvedCount / totalOrders) * 100}%` }}
                  />
                )}
                {pendingCount > 0 && (
                  <div
                    className="bg-warning h-2.5 transition-all"
                    style={{ width: `${(pendingCount / totalOrders) * 100}%` }}
                  />
                )}
                {rejectedCount > 0 && (
                  <div
                    className="bg-danger h-2.5 transition-all"
                    style={{ width: `${(rejectedCount / totalOrders) * 100}%` }}
                  />
                )}
                {cancelledCount > 0 && (
                  <div
                    className="bg-foreground/30 h-2.5 transition-all"
                    style={{ width: `${(cancelledCount / totalOrders) * 100}%` }}
                  />
                )}
                {otherCount > 0 && (
                  <div
                    className="bg-foreground/20 h-2.5 transition-all"
                    style={{ width: `${(otherCount / totalOrders) * 100}%` }}
                  />
                )}
              </div>
            </div>

            {totalCapacity != null && (
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted">{t("admin.approvedVsCapacity")}</span>
                  <span className="font-medium text-accent-light">
                    {totalCapacity > 0
                      ? Math.round((approvedCount / totalCapacity) * 100)
                      : 0}
                    %
                  </span>
                </div>
                <div className="w-full bg-border rounded-full h-2">
                  <div
                    className="bg-accent-light h-2 rounded-full transition-all"
                    style={{
                      width: `${
                        totalCapacity > 0
                          ? Math.min(
                              Math.round((approvedCount / totalCapacity) * 100),
                              100,
                            )
                          : 0
                      }%`,
                    }}
                  />
                </div>
              </div>
            )}

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted">{t("admin.scannedVsApproved")}</span>
                <span className="font-medium text-accent-light">
                  {scannedPercent}%
                </span>
              </div>
              <div className="w-full bg-border rounded-full h-2">
                <div
                  className="bg-accent-light h-2 rounded-full transition-all"
                  style={{ width: `${Math.min(scannedPercent, 100)}%` }}
                />
              </div>
            </div>

            <div className="pt-3 border-t border-border/60 grid grid-cols-2 gap-4 text-center">
              <div>
                <p className="text-[10px] font-medium text-muted uppercase tracking-widest">
                  {t("guestList.invitedTotal")}
                </p>
                <p className="text-lg font-bold text-foreground">{totalGuests}</p>
              </div>
              <div>
                <p className="text-[10px] font-medium text-muted uppercase tracking-widest">
                  {t("guestList.statRegistered")}
                </p>
                <p className="text-lg font-bold text-success">{approvedCount}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <RevenueBreakdownTables
        ticketTypes={
          (event.ticketTypes || []) as { id: string; name: string; price: number; quantity?: number }[]
        }
        paymentMethods={
          (event.paymentMethods || []) as { id: string; name: string }[]
        }
        orders={allOrders}
        t={t}
      />

      {/* Scanned Codes */}
      {(() => {
        const scannedOrders = allOrders
          .filter((o) => o.visited)
          .sort((a, b) => b.createdAt - a.createdAt);

        const filteredScanned = scannedSearch
          ? scannedOrders.filter((o) => {
              const q = scannedSearch.toLowerCase();
              const tt = getOrderTicketType(o);
              return [
                o.firstName,
                o.lastName,
                `${o.firstName} ${o.lastName}`,
                o.email,
                o.cedula,
                o.orderNumber,
                tt?.name,
              ].some((f) => f && f.toLowerCase().includes(q));
            })
          : scannedOrders;

        return (
          <div className="bg-surface border border-border rounded-xl p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold">{t("admin.scannedCodes")}</h2>
                <p className="text-sm text-muted">
                  {t("admin.scannedOf", { scanned: scannedOrders.length, total: approvedCount })}
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {ticketTypes.map((tt) => {
                    const ttApproved = allOrders.filter(
                      (o) => getOrderTicketType(o)?.id === tt.id && o.status === "approved",
                    ).length;
                    const ttScanned = allOrders.filter(
                      (o) => getOrderTicketType(o)?.id === tt.id && o.visited,
                    ).length;
                    return (
                      <span
                        key={tt.id}
                        className="px-2 py-0.5 bg-background border border-border rounded text-xs text-muted"
                      >
                        {tt.name}{" "}
                        <span className="font-medium text-foreground">
                          {ttScanned}/{ttApproved}
                        </span>
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold text-success">{scannedOrders.length}</p>
                <p className="text-xs text-muted">{t("admin.scannedLabel")}</p>
              </div>
            </div>

            {scannedOrders.length > 0 && (
              <div className="relative mb-4">
                <input
                  type="text"
                  value={scannedSearch}
                  onChange={(e) => setScannedSearch(e.target.value)}
                  placeholder={t("admin.searchScanned")}
                  className="w-full px-4 py-2.5 pl-10 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-accent-light transition-colors"
                />
                <svg
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                {scannedSearch && (
                  <button
                    onClick={() => setScannedSearch("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors"
                  >
                    {"✕"}
                  </button>
                )}
              </div>
            )}

            {scannedOrders.length === 0 ? (
              <p className="text-muted text-center py-6 text-sm">
                {t("admin.noScanned")}
              </p>
            ) : filteredScanned.length === 0 ? (
              <p className="text-muted text-center py-6 text-sm">
                {t("admin.noScannedMatching", { query: scannedSearch })}
              </p>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {filteredScanned.map((order) => {
                  const tt = getOrderTicketType(order);
                  return (
                    <div
                      key={order.id}
                      className="flex items-center justify-between gap-3 p-3 border border-success/20 bg-success/5 rounded-lg"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-success text-lg">{"✓"}</span>
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">
                            <span className="text-xs font-mono text-accent-light mr-2">
                              {order.orderNumber || "---"}
                            </span>
                            {order.firstName} {order.lastName}
                          </p>
                          <p className="text-xs text-muted truncate">
                            {order.email} &middot; {order.cedula}
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-medium text-muted">{tt?.name || "—"}</p>
                        <p className="text-xs text-muted">
                          {order.visitedAt
                            ? new Date(order.visitedAt).toLocaleString(dateLocale(lang))
                            : new Date(order.createdAt).toLocaleDateString(dateLocale(lang))}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* Order List */}
      <div className="bg-surface border border-border rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">{t("admin.orderList")}</h2>
            <button
              onClick={downloadCsv}
              disabled={allOrders.length === 0}
              className="px-3 py-1.5 border border-border hover:border-accent/50 text-muted hover:text-accent-light rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
            >
              {t("admin.downloadCsv")}
            </button>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex gap-1">
              {filters.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setFilter(f.value)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                    filter === f.value
                      ? "bg-accent/20 text-accent-light"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {ticketTypes.length > 1 && (
              <div className="flex gap-1 border-l border-border pl-2">
                <button
                  onClick={() => setTicketTypeFilter("all")}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                    ticketTypeFilter === "all"
                      ? "bg-accent/20 text-accent-light"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {t("admin.allTypes")}
                </button>
                {ticketTypes.map((tt) => (
                  <button
                    key={tt.id}
                    onClick={() => setTicketTypeFilter(tt.name)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                      ticketTypeFilter === tt.name
                        ? "bg-accent/20 text-accent-light"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    {tt.name}
                  </button>
                ))}
              </div>
            )}
            {uniquePaymentMethods.length > 1 && (
              <div className="flex gap-1 border-l border-border pl-2">
                <button
                  onClick={() => setPaymentMethodFilter("all")}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                    paymentMethodFilter === "all"
                      ? "bg-accent/20 text-accent-light"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {t("admin.filterAll")}
                </button>
                {uniquePaymentMethods.map((pm) => (
                  <button
                    key={pm}
                    onClick={() => setPaymentMethodFilter(pm)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                      paymentMethodFilter === pm
                        ? "bg-accent/20 text-accent-light"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    {pm}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="relative mb-4">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("guestList.searchPlaceholder")}
            className="w-full px-4 py-2.5 pl-10 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-accent-light transition-colors"
          />
          <svg
            className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors"
            >
              {"✕"}
            </button>
          )}
        </div>

        {/* Bulk selection controls (only when filter is "pending") */}
        {filter === "pending" && filteredOrders.length > 0 && (
          <div className="flex items-center gap-3 mb-4 p-3 bg-background border border-border rounded-lg">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={
                  filteredOrders.filter((o) => o.status === "pending").length > 0 &&
                  filteredOrders
                    .filter((o) => o.status === "pending")
                    .every((o) => selectedIds.has(o.id))
                }
                onChange={toggleSelectAllPending}
                className="accent-accent-light"
              />
              {t("admin.reconcileSelectAll")}
            </label>
            {selectedIds.size > 0 && (
              <button
                onClick={bulkApprove}
                disabled={bulkApproving}
                className="px-4 py-1.5 bg-success hover:bg-success/80 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors shadow-lg shadow-success/20"
              >
                {bulkApproving
                  ? bulkProgress
                    ? `${bulkProgress.done}/${bulkProgress.total}`
                    : t("admin.bulkApproving")
                  : t("admin.bulkApprove", { count: selectedIds.size })}
              </button>
            )}
          </div>
        )}

        {filteredOrders.length === 0 ? (
          <p className="text-muted text-center py-8">
            {t("guestList.noOrders")}
          </p>
        ) : (
          <div className="space-y-2">
            {filteredOrders.map((order) => {
              const tt = getOrderTicketType(order);
              const rate = order.purchaseRate ?? null;
              const bsAmt =
                order.purchaseAmountBs ??
                (rate != null ? order.pricePaid * rate : null);
              return (
                <div
                  key={order.id}
                  className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border rounded-lg hover:border-border transition-colors ${
                    selectedIds.has(order.id)
                      ? "border-success/50 bg-success/5"
                      : "border-border/50"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      {filter === "pending" && order.status === "pending" && (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(order.id)}
                          onChange={() => toggleSelect(order.id)}
                          className="accent-accent-light"
                        />
                      )}
                      <span className="text-xs font-mono font-bold text-accent-light">
                        {order.orderNumber || "---"}
                      </span>
                      <StatusBadge status={order.status} t={t} />
                      {order.visited && (
                        <span className="text-xs text-success">
                          {"✓"} {t("admin.visited")}
                          {order.visitedAt
                            ? ` ${new Date(order.visitedAt).toLocaleTimeString()}`
                            : ""}
                        </span>
                      )}
                      {tt && (
                        <span className="text-xs text-muted">{tt.name}</span>
                      )}
                    </div>
                    <p className="font-medium text-sm">
                      {order.firstName} {order.lastName}
                    </p>
                    <p className="text-xs text-muted">{order.email}</p>
                    <p className="text-xs text-muted">
                      {t("common.cedula")}: {order.cedula}
                    </p>
                    <p className="text-xs text-muted">
                      {t("admin.paymentMethodLabel")}: {order.paymentMethod || "—"}
                    </p>
                    {order.proofReferenceNumber && (
                      <p className="text-xs text-muted">
                        ref: {order.proofReferenceNumber}
                      </p>
                    )}
                    <p className="text-xs text-muted mt-0.5">
                      {order.pricePaid === 0 ? (
                        t("guestList.cortesia")
                      ) : (
                        <>
                          ${order.pricePaid.toFixed(2)}
                          {bsAmt != null && (
                            <span className="text-accent-light font-medium">
                              {" / "}
                              {bsAmt.toLocaleString("es-VE", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}{" "}
                              Bs
                            </span>
                          )}
                        </>
                      )}
                      {" "}&middot;{" "}
                      {new Date(order.createdAt).toLocaleString(dateLocale(lang))}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                    {order.paymentProofPath && (
                      <button
                        onClick={() => viewProof(order.id)}
                        className="px-3 py-1.5 text-xs border border-border rounded-lg hover:border-accent/50 transition-colors"
                      >
                        {t("guestList.viewProof")}
                      </button>
                    )}
                    {order.status === "pending" && (
                      <>
                        <button
                          onClick={() => action(order.id, "approve")}
                          disabled={actingId === order.id}
                          className="px-3 py-1.5 text-xs bg-success/10 text-success border border-success/30 rounded-lg hover:bg-success/20 transition-colors font-medium disabled:opacity-50"
                        >
                          {t("guestList.approve")}
                        </button>
                        <button
                          onClick={() => action(order.id, "reject")}
                          disabled={actingId === order.id}
                          className="px-3 py-1.5 text-xs bg-danger/10 text-danger border border-danger/30 rounded-lg hover:bg-danger/20 transition-colors font-medium disabled:opacity-50"
                        >
                          {t("admin.reject")}
                        </button>
                      </>
                    )}
                    {order.status === "approved" && (
                      <>
                        <button
                          onClick={() => resendTicket(order.id)}
                          disabled={resendingId === order.id}
                          className="px-3 py-1.5 text-xs border border-accent/30 text-accent-light rounded-lg hover:bg-accent/10 transition-colors font-medium disabled:opacity-50"
                        >
                          {resendingId === order.id
                            ? t("common.loading")
                            : t("guestList.resendTicket")}
                        </button>
                        <button
                          onClick={() => action(order.id, "cancel")}
                          disabled={actingId === order.id}
                          className="px-3 py-1.5 text-xs bg-muted/10 text-muted border border-muted/30 rounded-lg hover:bg-muted/20 transition-colors font-medium disabled:opacity-50"
                        >
                          {t("common.cancel")}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {previewUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6 cursor-pointer"
          onClick={() => setPreviewUrl(null)}
        >
          <img
            src={previewUrl}
            alt="proof"
            className="max-w-full max-h-full rounded-lg shadow-2xl"
          />
        </div>
      )}
    </div>
  );
}

type RevenueCell = { count: number; amount: number; amountBs: number };

const STATUSES = [
  { key: "approved", labelKey: "common.approved", color: "text-success", headerBg: "bg-success/10 border-success/30" },
  { key: "pending", labelKey: "common.pending", color: "text-warning", headerBg: "bg-warning/10 border-warning/30" },
  { key: "rejected", labelKey: "common.rejected", color: "text-danger", headerBg: "bg-danger/10 border-danger/30" },
] as const;

function buildBreakdown(orders: GuestOrder[], pmNames: string[]) {
  const cells: Record<string, Record<string, RevenueCell>> = {};
  for (const s of STATUSES) {
    cells[s.key] = {};
    for (const pm of pmNames) {
      cells[s.key][pm] = { count: 0, amount: 0, amountBs: 0 };
    }
  }
  for (const o of orders) {
    const s = o.status;
    const pm = o.paymentMethod || "—";
    if (!cells[s]) continue;
    if (!cells[s][pm]) cells[s][pm] = { count: 0, amount: 0, amountBs: 0 };
    const amount = o.pricePaid || 0;
    const bsAmount =
      o.purchaseAmountBs ??
      (typeof o.purchaseRate === "number" ? amount * o.purchaseRate : 0);
    cells[s][pm].count += 1;
    cells[s][pm].amount += amount;
    cells[s][pm].amountBs += bsAmount;
  }
  const statusTotals = STATUSES.map((s) => {
    const vals = Object.values(cells[s.key]);
    return {
      key: s.key,
      count: vals.reduce((a, v) => a + v.count, 0),
      amount: vals.reduce((a, v) => a + v.amount, 0),
      amountBs: vals.reduce((a, v) => a + v.amountBs, 0),
    };
  });
  return { cells, statusTotals };
}

function RevenueBreakdownTable({
  title,
  subtitle,
  orders,
  pmNames,
  t,
}: {
  title: string;
  subtitle?: string;
  orders: GuestOrder[];
  pmNames: string[];
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const { cells, statusTotals } = buildBreakdown(orders, pmNames);

  return (
    <div className="bg-surface border border-border rounded-xl p-6 mb-4">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        {subtitle && <p className="text-sm text-muted mt-0.5">{subtitle}</p>}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr>
              {STATUSES.map((s) => (
                <th
                  key={s.key}
                  colSpan={pmNames.length}
                  className={`text-center py-2 px-2 font-semibold border ${s.headerBg} ${s.color} first:rounded-tl-lg last:rounded-tr-lg`}
                >
                  {t(s.labelKey)}
                </th>
              ))}
            </tr>
            <tr className="border-b border-border">
              {STATUSES.map((s) =>
                pmNames.map((pm) => (
                  <th
                    key={`${s.key}-${pm}`}
                    className="text-center py-2 px-2 text-xs font-medium text-muted bg-surface-hover/50"
                  >
                    {pm}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border/50">
              {STATUSES.map((s) =>
                pmNames.map((pm) => {
                  const cell =
                    cells[s.key][pm] || { count: 0, amount: 0, amountBs: 0 };
                  return (
                    <td
                      key={`${s.key}-${pm}-count`}
                      className="text-center py-2 px-2"
                    >
                      <span className={`font-bold ${s.color}`}>{cell.count}</span>
                      <span className="text-muted text-xs"> {t("common.quantity")}</span>
                    </td>
                  );
                }),
              )}
            </tr>
            <tr className="border-b border-border/50">
              {STATUSES.map((s) =>
                pmNames.map((pm) => {
                  const cell =
                    cells[s.key][pm] || { count: 0, amount: 0, amountBs: 0 };
                  return (
                    <td
                      key={`${s.key}-${pm}-amount`}
                      className="text-center py-2 px-2 text-muted"
                    >
                      ${cell.amount.toFixed(2)}
                      {cell.amountBs > 0 && (
                        <div className="text-xs text-muted">
                          {cell.amountBs.toLocaleString("es-VE", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{" "}
                          Bs
                        </div>
                      )}
                    </td>
                  );
                }),
              )}
            </tr>
          </tbody>
          <tfoot>
            <tr className="border-t border-border">
              {STATUSES.map((st) => {
                const total = statusTotals.find((tt) => tt.key === st.key)!;
                return (
                  <td
                    key={st.key}
                    colSpan={pmNames.length}
                    className={`text-center py-2.5 px-2 font-semibold ${st.color}`}
                  >
                    {t("common.total")} {t(st.labelKey)}: ${total.amount.toFixed(2)}
                    {total.amountBs > 0 && (
                      <span className="ml-2 text-sm font-normal text-accent-light">
                        /{" "}
                        {total.amountBs.toLocaleString("es-VE", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{" "}
                        Bs
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function RevenueBreakdownTables({
  ticketTypes,
  paymentMethods,
  orders,
  t,
}: {
  ticketTypes: { id: string; name: string; price: number; quantity?: number }[];
  paymentMethods: { id: string; name: string }[];
  orders: GuestOrder[];
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  // Union of configured PMs + any PM seen in orders (handles legacy orders)
  const configuredPmNames = paymentMethods.map((pm) => pm.name);
  const orderPmNames = orders.map((o) => o.paymentMethod || "").filter(Boolean) as string[];
  const allPmNames = Array.from(new Set([...configuredPmNames, ...orderPmNames]));
  if (allPmNames.length === 0) return null;

  return (
    <>
      {ticketTypes.map((tt) => {
        const ttOrders = orders.filter((o) => {
          const orderTt = getOrderTicketType(o);
          return orderTt?.id === tt.id;
        });
        const sold = ttOrders.filter(
          (o) => o.status === "approved" || o.status === "pending",
        ).length;
        const totalLabel =
          tt.quantity != null
            ? t("admin.sold", { sold, total: tt.quantity })
            : t("guestList.ttSoldNoCap", { sold });
        return (
          <RevenueBreakdownTable
            key={tt.id}
            title={tt.name}
            subtitle={`$${tt.price.toFixed(2)} ${t("admin.perTicket")} · ${totalLabel}`}
            orders={ttOrders}
            pmNames={allPmNames}
            t={t}
          />
        );
      })}

      {ticketTypes.length > 1 && (
        <RevenueBreakdownTable
          title={t("admin.combinedTotals")}
          subtitle={t("admin.allTicketTypes")}
          orders={orders}
          pmNames={allPmNames}
          t={t}
        />
      )}
    </>
  );
}
