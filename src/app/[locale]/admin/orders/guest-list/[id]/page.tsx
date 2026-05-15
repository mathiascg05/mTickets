"use client";

import { db } from "@/lib/db";
import { useAuthContext } from "@/lib/AuthContext";
import { useLanguage } from "@/lib/LanguageContext";
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
  const { t } = useLanguage();
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkApproving, setBulkApproving] = useState(false);

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
  const ticketTypes = (event.ticketTypes || []) as { id: string; quantity?: number }[];
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

  const filteredOrders = allOrders.filter((o) => {
    if (filter !== "all" && o.status !== filter) return false;
    if (paymentMethodFilter !== "all" && (o.paymentMethod || "") !== paymentMethodFilter)
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
    try {
      const res = await fetch("/api/guest-list/bulk-approve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${refreshToken}`,
        },
        body: JSON.stringify({ orderIds: ids }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || "Failed");
      } else {
        toast.success(
          t("guestList.bulkResult", {
            approved: body.approved,
            skipped: body.skipped,
            failed: body.failed,
          }),
        );
        setSelectedIds(new Set());
      }
    } catch (err) {
      toast.error(String(err));
    } finally {
      setBulkApproving(false);
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
      t("common.status"),
      t("common.date"),
      t("guestList.colVisited"),
    ];
    const sorted = [...allOrders].sort((a, b) => a.createdAt - b.createdAt);
    const rows = sorted.map((o) => {
      const tt = getOrderTicketType(o);
      return [
        escapeCsv(o.orderNumber || "---"),
        escapeCsv(o.firstName),
        escapeCsv(o.lastName),
        escapeCsv(o.email),
        escapeCsv(o.cedula),
        escapeCsv(tt?.name || ""),
        escapeCsv(o.paymentMethod || ""),
        escapeCsv(o.proofReferenceNumber || ""),
        o.pricePaid.toFixed(2),
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

      <div className="bg-surface border border-border rounded-xl p-4 mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder={t("guestList.searchPlaceholder")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light"
        />
        <div className="flex gap-1 flex-wrap">
          {filters.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                filter === f.value
                  ? "bg-accent text-white"
                  : "bg-background border border-border text-muted hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {uniquePaymentMethods.length > 0 && (
          <select
            value={paymentMethodFilter}
            onChange={(e) => setPaymentMethodFilter(e.target.value)}
            className="px-3 py-2 bg-background border border-border rounded-lg text-sm"
          >
            <option value="all">{t("admin.allPaymentMethods")}</option>
            {uniquePaymentMethods.map((pm) => (
              <option key={pm} value={pm}>
                {pm}
              </option>
            ))}
          </select>
        )}
        <button
          onClick={downloadCsv}
          disabled={allOrders.length === 0}
          className="px-3 py-2 bg-accent hover:bg-accent-dark disabled:opacity-50 text-white rounded-lg text-sm font-medium"
        >
          {t("admin.downloadCsv")}
        </button>
      </div>

      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <p className="text-xs text-muted">
          {t("admin.showing", { shown: filteredOrders.length, total: allOrders.length })}
        </p>
        {selectedIds.size > 0 && (
          <button
            onClick={bulkApprove}
            disabled={bulkApproving}
            className="px-3 py-1.5 bg-success hover:bg-success/80 disabled:opacity-50 text-white rounded-lg text-sm font-medium"
          >
            {bulkApproving
              ? t("common.loading")
              : t("guestList.bulkApprove", { count: selectedIds.size })}
          </button>
        )}
      </div>

      <div className="overflow-x-auto bg-surface border border-border rounded-xl">
        <table className="w-full text-sm">
          <thead className="bg-background border-b border-border">
            <tr>
              <Th className="w-8">
                {pendingCount > 0 && (
                  <input
                    type="checkbox"
                    checked={
                      filteredOrders.filter((o) => o.status === "pending").length > 0 &&
                      filteredOrders
                        .filter((o) => o.status === "pending")
                        .every((o) => selectedIds.has(o.id))
                    }
                    onChange={toggleSelectAllPending}
                  />
                )}
              </Th>
              <Th>{t("admin.orderNumber")}</Th>
              <Th>{t("common.name")}</Th>
              <Th>{t("common.email")}</Th>
              <Th>{t("guestList.colCedula")}</Th>
              <Th>{t("guestList.colTicketType")}</Th>
              <Th>{t("guestList.paymentMethod")}</Th>
              <Th className="text-right">{t("guestList.colPrice")}</Th>
              <Th>{t("common.date")}</Th>
              <Th>{t("common.status")}</Th>
              <Th>{t("guestList.colVisited")}</Th>
              <Th className="text-right"></Th>
            </tr>
          </thead>
          <tbody>
            {filteredOrders.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-3 py-8 text-center text-muted">
                  {t("guestList.noOrders")}
                </td>
              </tr>
            ) : (
              filteredOrders.map((o) => {
                const tt = getOrderTicketType(o);
                return (
                <tr key={o.id} className="border-t border-border hover:bg-background/50">
                  <Td>
                    {o.status === "pending" && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(o.id)}
                        onChange={() => toggleSelect(o.id)}
                      />
                    )}
                  </Td>
                  <Td className="font-mono text-xs">{o.orderNumber || "—"}</Td>
                  <Td>
                    {o.firstName} {o.lastName}
                  </Td>
                  <Td className="font-mono text-xs">{o.email}</Td>
                  <Td className="font-mono text-xs">{o.cedula}</Td>
                  <Td>
                    {tt ? (
                      <span className="px-2 py-0.5 text-xs rounded-full bg-accent/10 text-accent-light border border-accent/30">
                        {tt.name}
                      </span>
                    ) : (
                      <span className="text-muted text-xs">—</span>
                    )}
                  </Td>
                  <Td>
                    {o.paymentMethod || "—"}
                    {o.proofReferenceNumber && (
                      <span className="block text-xs text-muted">
                        ref: {o.proofReferenceNumber}
                      </span>
                    )}
                  </Td>
                  <Td className="text-right font-medium">
                    {o.pricePaid === 0 ? t("guestList.cortesia") : `$${o.pricePaid.toFixed(2)}`}
                  </Td>
                  <Td className="text-xs text-muted">
                    {new Date(o.createdAt).toLocaleString()}
                  </Td>
                  <Td>
                    <StatusBadge status={o.status} t={t} />
                  </Td>
                  <Td>
                    {o.visited ? (
                      <span className="text-success text-xs">
                        ✓ {o.visitedAt ? new Date(o.visitedAt).toLocaleTimeString() : ""}
                      </span>
                    ) : (
                      <span className="text-muted text-xs">—</span>
                    )}
                  </Td>
                  <Td className="text-right space-x-2 whitespace-nowrap">
                    {o.paymentProofPath && (
                      <button
                        onClick={() => viewProof(o.id)}
                        className="text-xs text-accent-light hover:underline"
                      >
                        {t("guestList.viewProof")}
                      </button>
                    )}
                    {o.status === "pending" && (
                      <>
                        <button
                          onClick={() => action(o.id, "approve")}
                          disabled={actingId === o.id}
                          className="text-xs text-success hover:underline disabled:opacity-50"
                        >
                          {t("guestList.approve")}
                        </button>
                        <button
                          onClick={() => action(o.id, "reject")}
                          disabled={actingId === o.id}
                          className="text-xs text-danger hover:underline disabled:opacity-50"
                        >
                          {t("admin.reject")}
                        </button>
                      </>
                    )}
                    {o.status === "approved" && (
                      <>
                        <button
                          onClick={() => resendTicket(o.id)}
                          disabled={resendingId === o.id}
                          className="text-xs text-accent-light hover:underline disabled:opacity-50"
                        >
                          {resendingId === o.id ? t("common.loading") : t("guestList.resendTicket")}
                        </button>
                        <button
                          onClick={() => action(o.id, "cancel")}
                          disabled={actingId === o.id}
                          className="text-xs text-danger hover:underline disabled:opacity-50"
                        >
                          {t("common.cancel")}
                        </button>
                      </>
                    )}
                  </Td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
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

function Th({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-3 py-2 text-left text-xs font-medium text-muted uppercase tracking-wide ${className || ""}`}
    >
      {children}
    </th>
  );
}
function Td({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-2 ${className || ""}`}>{children}</td>;
}

type RevenueCell = { count: number; amount: number };

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
      cells[s.key][pm] = { count: 0, amount: 0 };
    }
  }
  for (const o of orders) {
    const s = o.status;
    const pm = o.paymentMethod || "—";
    if (!cells[s]) continue;
    if (!cells[s][pm]) cells[s][pm] = { count: 0, amount: 0 };
    cells[s][pm].count += 1;
    cells[s][pm].amount += o.pricePaid || 0;
  }
  const statusTotals = STATUSES.map((s) => {
    const vals = Object.values(cells[s.key]);
    return {
      key: s.key,
      count: vals.reduce((a, v) => a + v.count, 0),
      amount: vals.reduce((a, v) => a + v.amount, 0),
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
        <table className="w-full text-sm">
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
                  const cell = cells[s.key][pm] || { count: 0, amount: 0 };
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
                  const cell = cells[s.key][pm] || { count: 0, amount: 0 };
                  return (
                    <td
                      key={`${s.key}-${pm}-amount`}
                      className="text-center py-2 px-2 text-muted"
                    >
                      ${cell.amount.toFixed(2)}
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
