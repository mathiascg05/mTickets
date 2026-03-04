"use client";

import { db } from "@/lib/db";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-warning/10 text-warning border-warning/30",
    approved: "bg-success/10 text-success border-success/30",
    rejected: "bg-danger/10 text-danger border-danger/30",
    cancelled: "bg-muted/10 text-muted border-muted/30",
  };
  return (
    <span
      className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[status] || "bg-muted/10 text-muted border-muted/30"}`}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

type FlatOrder = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  cedula: string;
  paymentMethod: string;
  promoter?: string;
  status: string;
  couponCode?: string;
  discountAmount?: number;
  createdAt: number;
  ticketTypeName: string;
  ticketTypePrice: number;
};

function ExportSection({
  concertName,
  allOrders,
  orderNumberMap,
  pmCurrencyMap,
  rateMap,
}: {
  concertName: string;
  allOrders: FlatOrder[];
  orderNumberMap: Record<string, number>;
  pmCurrencyMap: Record<string, string>;
  rateMap: Record<string, number>;
}) {
  function escapeCsv(val: string) {
    if (val.includes(",") || val.includes('"') || val.includes("\n")) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  }

  function downloadCsv() {
    const headers = [
      "Order #",
      "First Name",
      "Last Name",
      "Payment Method",
      "Amount ($)",
      "Amount (Bs)",
      "Promoter",
      "Status",
      "Date",
      "Coupon",
    ];

    const sorted = [...allOrders].sort((a, b) => a.createdAt - b.createdAt);

    const rows = sorted.map((order) => {
      const effectivePrice =
        order.ticketTypePrice - (order.discountAmount || 0);
      const currency = pmCurrencyMap[order.paymentMethod];
      const rate = currency ? rateMap[currency] : null;
      const amountUsd = currency ? "" : effectivePrice.toFixed(2);
      const amountBs =
        rate != null ? (effectivePrice * rate).toFixed(2) : "";

      return [
        String(orderNumberMap[order.id]),
        escapeCsv(order.firstName),
        escapeCsv(order.lastName),
        escapeCsv(order.paymentMethod),
        amountUsd,
        amountBs,
        escapeCsv(order.promoter || ""),
        order.status,
        new Date(order.createdAt).toLocaleString(),
        escapeCsv(order.couponCode || ""),
      ].join(",");
    });

    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${concertName.replace(/[^a-zA-Z0-9]/g, "_")}_orders.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-6 mb-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Export</h2>
          <p className="text-sm text-muted">
            Download all {allOrders.length} orders as CSV
          </p>
        </div>
        <button
          onClick={downloadCsv}
          disabled={allOrders.length === 0}
          className="px-4 py-2 bg-accent hover:bg-accent-dark disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-accent/20"
        >
          Download CSV
        </button>
      </div>
    </div>
  );
}

type FilterStatus = "all" | "pending" | "approved" | "rejected" | "cancelled";

export default function ConcertOrdersPage() {
  const params = useParams();
  const concertId = params.concertId as string;
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [ticketTypeFilter, setTicketTypeFilter] = useState<string>("all");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const { isLoading, data } = db.useQuery({
    concerts: {
      $: { where: { id: concertId } },
      ticketTypes: {
        $: { order: { createdAt: "asc" } },
        orders: {
          $: { order: { createdAt: "desc" } },
        },
        phases: {
          $: { order: { sortOrder: "asc" } },
        },
      },
      paymentMethods: {
        $: { order: { createdAt: "asc" } },
      },
    },
    exchangeRates: {},
  });

  if (isLoading || !data) {
    return <div className="animate-pulse text-muted">Loading...</div>;
  }

  const concert = data.concerts[0];
  if (!concert) {
    return <div className="text-muted">Event not found</div>;
  }

  // Flatten all orders with their ticket type info (use phase price when available)
  const allOrders = concert.ticketTypes.flatMap((tt) =>
    tt.orders.map((order) => {
      const phase = (tt.phases || []).find((p: { id: string }) => p.id === order.phaseId);
      return {
        ...order,
        ticketTypeName: tt.name,
        ticketTypePrice: phase ? phase.price : tt.price,
      };
    }),
  );
  allOrders.sort((a, b) => b.createdAt - a.createdAt);

  // Build order number map: sorted chronologically ascending = order #1, #2, etc.
  const ordersByDate = [...allOrders].sort((a, b) => a.createdAt - b.createdAt);
  const orderNumberMap: Record<string, number> = {};
  ordersByDate.forEach((o, i) => {
    orderNumberMap[o.id] = i + 1;
  });

  // Map payment method name → convertCurrency for Bs calculation
  const pmCurrencyMap: Record<string, string> = {};
  for (const pm of concert.paymentMethods || []) {
    if (pm.convertCurrency) {
      pmCurrencyMap[pm.name] = pm.convertCurrency;
    }
  }

  // Exchange rates lookup
  const rateMap: Record<string, number> = {};
  for (const er of data.exchangeRates || []) {
    rateMap[er.currency] = er.rate;
  }

  const filteredOrders = allOrders.filter((o) => {
    if (filter !== "all" && o.status !== filter) return false;
    if (ticketTypeFilter !== "all" && o.ticketTypeName !== ticketTypeFilter) return false;
    return true;
  });

  // --- Analytics ---
  const totalOrders = allOrders.length;
  const pendingCount = allOrders.filter((o) => o.status === "pending").length;
  const approvedCount = allOrders.filter((o) => o.status === "approved").length;
  const rejectedCount = allOrders.filter((o) => o.status === "rejected").length;

  const getOrderPrice = (tt: (typeof concert.ticketTypes)[number], order: { phaseId?: string; discountAmount?: number }) => {
    const phase = (tt.phases || []).find((p: { id: string }) => p.id === order.phaseId);
    return (phase ? phase.price : tt.price) - (order.discountAmount || 0);
  };

  const totalRevenue = concert.ticketTypes.reduce((sum, tt) => {
    return sum + tt.orders
      .filter((o) => o.status === "approved")
      .reduce((s, o) => s + getOrderPrice(tt, o), 0);
  }, 0);

  const ticketBreakdown = concert.ticketTypes.map((tt) => {
    const approved = tt.orders.filter((o) => o.status === "approved").length;
    const pending = tt.orders.filter((o) => o.status === "pending").length;
    const revenue = tt.orders
      .filter((o) => o.status === "approved")
      .reduce((s, o) => s + getOrderPrice(tt, o), 0);
    return {
      name: tt.name,
      price: tt.price,
      quantity: tt.quantity,
      approved,
      pending,
      total: tt.orders.length,
      revenue,
    };
  });

  const totalTicketsIssued = ticketBreakdown.reduce((s, t) => s + t.approved, 0);

  function approve(orderId: string) {
    db.transact(db.tx.orders[orderId].update({ status: "approved" }));
  }

  function reject(orderId: string) {
    db.transact(db.tx.orders[orderId].update({ status: "rejected" }));
  }

  function cancel(orderId: string) {
    if (confirm("Cancel this ticket? The QR code will no longer work.")) {
      db.transact(db.tx.orders[orderId].update({ status: "cancelled" }));
    }
  }

  async function viewProof(path: string) {
    const url = await db.storage.getDownloadUrl(path);
    setPreviewUrl(url);
  }

  const filters: { label: string; value: FilterStatus }[] = [
    { label: "All", value: "all" },
    { label: "Pending", value: "pending" },
    { label: "Approved", value: "approved" },
    { label: "Rejected", value: "rejected" },
    { label: "Cancelled", value: "cancelled" },
  ];

  return (
    <div>
      <Link
        href="/admin/orders"
        className="text-sm text-muted hover:text-accent-light transition-colors mb-4 inline-block"
      >
        &larr; All events
      </Link>

      <h1 className="text-3xl font-bold mb-2">{concert.name}</h1>
      <p className="text-muted mb-8">
        {concert.venue} &middot; {concert.date}
      </p>

      {/* Summary Stats */}
      <div className="bg-surface border border-border rounded-xl p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Event Summary</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="border-l-4 border-accent-light pl-4">
            <p className="text-sm text-muted">Total Orders</p>
            <p className="text-3xl font-bold text-accent-light">{totalOrders}</p>
          </div>
          <div className="border-l-4 border-success pl-4">
            <p className="text-sm text-muted">Tickets Issued</p>
            <p className="text-3xl font-bold text-success">{totalTicketsIssued}</p>
          </div>
          <div className="border-l-4 border-accent-light pl-4">
            <p className="text-sm text-muted">Total Revenue</p>
            <p className="text-3xl font-bold text-accent-light">
              ${totalRevenue.toFixed(2)}
            </p>
          </div>
          <div className="border-l-4 border-warning pl-4">
            <p className="text-sm text-muted">Pending Approval</p>
            <p className="text-3xl font-bold text-warning">{pendingCount}</p>
          </div>
        </div>
      </div>

      {/* Per-ticket-type breakdown: Status x Payment Method */}
      {concert.ticketTypes.map((tt) => {
        const pmNames = (concert.paymentMethods || []).map((pm) => pm.name);
        const statuses = [
          { key: "approved", label: "Approved", color: "text-success", headerBg: "bg-success/10 border-success/30" },
          { key: "pending", label: "Pending", color: "text-warning", headerBg: "bg-warning/10 border-warning/30" },
          { key: "rejected", label: "Rejected", color: "text-danger", headerBg: "bg-danger/10 border-danger/30" },
        ];

        // Build data: for each status × payment method, count and amount
        const cells: Record<string, Record<string, { count: number; amount: number }>> = {};
        for (const s of statuses) {
          cells[s.key] = {};
          for (const pm of pmNames) {
            cells[s.key][pm] = { count: 0, amount: 0 };
          }
        }
        for (const order of tt.orders) {
          const s = order.status;
          const pm = order.paymentMethod;
          const orderPhase = (tt.phases || []).find((p: { id: string }) => p.id === order.phaseId);
          const finalPrice = (orderPhase ? orderPhase.price : tt.price) - (order.discountAmount || 0);
          if (cells[s] && cells[s][pm]) {
            cells[s][pm].count += 1;
            cells[s][pm].amount += finalPrice;
          } else if (cells[s]) {
            // payment method not in concert.paymentMethods (edge case)
            cells[s][pm] = cells[s][pm] || { count: 0, amount: 0 };
            cells[s][pm].count += 1;
            cells[s][pm].amount += finalPrice;
          }
        }

        const statusTotals = statuses.map((s) => {
          const vals = Object.values(cells[s.key]);
          return {
            key: s.key,
            label: s.label,
            color: s.color,
            count: vals.reduce((a, v) => a + v.count, 0),
            amount: vals.reduce((a, v) => a + v.amount, 0),
          };
        });

        // Collect all pm names that appear (in case of edge-case extras)
        const allPmNames = Array.from(
          new Set([
            ...pmNames,
            ...tt.orders.map((o) => o.paymentMethod).filter(Boolean),
          ]),
        );

        if (allPmNames.length === 0) return null;

        return (
          <div
            key={tt.id}
            className="bg-surface border border-border rounded-xl p-6 mb-6"
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold">{tt.name}</h2>
                <p className="text-sm text-muted">
                  ${tt.price.toFixed(2)} per ticket &middot;{" "}
                  {statusTotals[0].count + statusTotals[1].count}/{tt.quantity} sold
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                {/* Status group headers */}
                <thead>
                  <tr>
                    {statuses.map((s) => (
                      <th
                        key={s.key}
                        colSpan={allPmNames.length}
                        className={`text-center py-2 px-2 font-semibold border ${s.headerBg} ${s.color} first:rounded-tl-lg last:rounded-tr-lg`}
                      >
                        {s.label}
                      </th>
                    ))}
                  </tr>
                  {/* Payment method sub-headers */}
                  <tr className="border-b border-border">
                    {statuses.map((s) =>
                      allPmNames.map((pm) => (
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
                  {/* Count row */}
                  <tr className="border-b border-border/50">
                    {statuses.map((s) =>
                      allPmNames.map((pm) => {
                        const cell = cells[s.key][pm] || { count: 0, amount: 0 };
                        return (
                          <td
                            key={`${s.key}-${pm}-count`}
                            className="text-center py-2 px-2"
                          >
                            <span className={`font-bold ${s.color}`}>
                              {cell.count}
                            </span>
                            <span className="text-muted text-xs"> Cant.</span>
                          </td>
                        );
                      }),
                    )}
                  </tr>
                  {/* Amount row */}
                  <tr className="border-b border-border/50">
                    {statuses.map((s) =>
                      allPmNames.map((pm) => {
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
                {/* Totals per status */}
                <tfoot>
                  <tr className="border-t border-border">
                    {statuses.map((st) => (
                      <td
                        key={st.key}
                        colSpan={allPmNames.length}
                        className={`text-center py-2.5 px-2 font-semibold ${st.color}`}
                      >
                        Total {st.label}: ${statusTotals.find((t) => t.key === st.key)!.amount.toFixed(2)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        );
      })}

      {/* CSV Export */}
      <ExportSection
        concertName={concert.name}
        allOrders={allOrders}
        orderNumberMap={orderNumberMap}
        pmCurrencyMap={pmCurrencyMap}
        rateMap={rateMap}
      />

      {/* Order List */}
      <div className="bg-surface border border-border rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold">Order List</h2>
          <div className="flex flex-wrap gap-2">
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
            {concert.ticketTypes.length > 1 && (
              <div className="flex gap-1 border-l border-border pl-2">
                <button
                  onClick={() => setTicketTypeFilter("all")}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                    ticketTypeFilter === "all"
                      ? "bg-accent/20 text-accent-light"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  All Types
                </button>
                {concert.ticketTypes.map((tt) => (
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
          </div>
        </div>

        {filteredOrders.length === 0 ? (
          <p className="text-muted text-center py-8">
            No {filter === "all" ? "" : filter} orders for this event.
          </p>
        ) : (
          <div className="space-y-2">
            {filteredOrders.map((order) => (
              <div
                key={order.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border border-border/50 rounded-lg hover:border-border transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono font-bold text-accent-light">
                      #{orderNumberMap[order.id]}
                    </span>
                    <StatusBadge status={order.status} />
                    {order.visited && (
                      <span className="text-xs text-success">
                        {"✓"} Visited
                      </span>
                    )}
                    <span className="text-xs text-muted">
                      {order.ticketTypeName}
                    </span>
                  </div>
                  <p className="font-medium text-sm">{order.firstName} {order.lastName}</p>
                  <p className="text-xs text-muted">{order.email}</p>
                  <p className="text-xs text-muted">Cedula: {order.cedula}</p>
                  {order.promoter && (
                    <p className="text-xs text-muted">Promoter: {order.promoter}</p>
                  )}
                  <p className="text-xs text-muted mt-0.5">
                    ${order.ticketTypePrice.toFixed(2)}
                    {order.couponCode && (
                      <span className="text-success">
                        {" "}(coupon: {order.couponCode}, -${(order.discountAmount || 0).toFixed(2)})
                      </span>
                    )}
                    {" "}&middot;{" "}
                    {new Date(order.createdAt).toLocaleString()}
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => viewProof(order.paymentProofPath)}
                    className="px-3 py-1.5 text-xs border border-border rounded-lg hover:border-accent/50 transition-colors"
                  >
                    Proof
                  </button>
                  {order.status === "pending" && (
                    <>
                      <button
                        onClick={() => approve(order.id)}
                        className="px-3 py-1.5 text-xs bg-success/10 text-success border border-success/30 rounded-lg hover:bg-success/20 transition-colors font-medium"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => reject(order.id)}
                        className="px-3 py-1.5 text-xs bg-danger/10 text-danger border border-danger/30 rounded-lg hover:bg-danger/20 transition-colors font-medium"
                      >
                        Reject
                      </button>
                    </>
                  )}
                  {order.status === "approved" && (
                    <button
                      onClick={() => cancel(order.id)}
                      className="px-3 py-1.5 text-xs bg-muted/10 text-muted border border-muted/30 rounded-lg hover:bg-muted/20 transition-colors font-medium"
                    >
                      Cancel
                    </button>
                  )}
                  <a
                    href={`/ticket/${order.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 text-xs text-muted border border-border rounded-lg hover:border-accent/50 transition-colors"
                  >
                    Ticket
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Payment proof preview modal */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setPreviewUrl(null)}
        >
          <div
            className="bg-surface border border-border rounded-2xl p-4 max-w-2xl max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-semibold">Payment Proof</h3>
              <button
                onClick={() => setPreviewUrl(null)}
                className="text-muted hover:text-foreground transition-colors"
              >
                {"✕"}
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="Payment proof"
              className="max-w-full rounded-lg"
            />
          </div>
        </div>
      )}
    </div>
  );
}
