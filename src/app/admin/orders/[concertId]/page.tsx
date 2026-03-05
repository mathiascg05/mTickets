"use client";

import { db } from "@/lib/db";
import { id } from "@instantdb/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { getAvailability, getTodayString } from "@/lib/phases";
import { sendTicketEmail, sendConfirmationEmail } from "@/lib/sendTicketEmail";

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
  paymentProofPath?: string;
  proofReferenceNumber?: string;
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
        escapeCsv(new Date(order.createdAt).toLocaleString()),
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

function CouponInlineInput({
  onApply,
  onCancel,
}: {
  onApply: (code: string) => string | null;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleApply() {
    const err = onApply(code);
    if (err) setError(err);
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="text"
        value={code}
        onChange={(e) => { setCode(e.target.value); setError(null); }}
        onKeyDown={(e) => e.key === "Enter" && handleApply()}
        placeholder="Codigo"
        className={`w-24 px-2 py-1 text-xs bg-background border rounded-lg focus:outline-none focus:border-accent ${error ? "border-danger" : "border-border"}`}
        autoFocus
      />
      <button
        onClick={handleApply}
        className="px-2 py-1 text-xs bg-accent/10 text-accent-light border border-accent/30 rounded-lg hover:bg-accent/20 transition-colors"
      >
        OK
      </button>
      <button
        onClick={onCancel}
        className="px-2 py-1 text-xs text-muted border border-border rounded-lg hover:text-foreground transition-colors"
      >
        {"✕"}
      </button>
    </div>
  );
}

type FilterStatus = "all" | "pending" | "approved" | "rejected" | "cancelled";

function CreateOrderModal({
  concert,
  onClose,
}: {
  concert: {
    ticketTypes: {
      id: string;
      name: string;
      price: number;
      quantity: number;
      orders: { id: string; status: string; phaseId?: string }[];
      phases: { id: string; name: string; price: number; quantity: number; endDate?: string; sortOrder: number }[];
    }[];
    paymentMethods: { id: string; name: string }[];
  };
  onClose: () => void;
}) {
  const [selectedTicketTypeId, setSelectedTicketTypeId] = useState(
    concert.ticketTypes[0]?.id || "",
  );
  const [quantity, setQuantity] = useState(1);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [cedula, setCedula] = useState("");
  const [paymentMethod, setPaymentMethod] = useState(concert.paymentMethods[0]?.name || "");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [orderStatus, setOrderStatus] = useState<"approved" | "pending">("approved");
  const [submitting, setSubmitting] = useState(false);

  const today = getTodayString();

  const ticketOptions = concert.ticketTypes.map((tt) => {
    const avail = getAvailability(tt, tt.phases || [], tt.orders, today);
    return { id: tt.id, name: tt.name, price: avail.price, available: avail.available, activePhase: avail.activePhase };
  });

  const selectedOption = ticketOptions.find((o) => o.id === selectedTicketTypeId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedOption || submitting) return;
    setSubmitting(true);

    try {
      let filePath = "admin-created";
      if (proofFile) {
        const ext = proofFile.name.split(".").pop();
        const storagePath = `payment-proofs/${Date.now()}-admin.${ext}`;
        await db.storage.upload(storagePath, proofFile);
        filePath = storagePath;
      }

      const orderIds: string[] = [];
      const txns = Array.from({ length: quantity }, () => {
        const orderId = id();
        orderIds.push(orderId);
        return db.tx.orders[orderId]
          .update({
            firstName,
            lastName,
            email,
            cedula,
            paymentMethod,
            status: orderStatus,
            paymentProofPath: filePath,
            visited: false,
            createdAt: Date.now(),
            ...(selectedOption.activePhase
              ? { phaseId: selectedOption.activePhase.id }
              : {}),
          })
          .link({ ticketType: selectedTicketTypeId });
      });
      await db.transact(txns);
      if (orderStatus === "approved") {
        for (const oid of orderIds) {
          sendTicketEmail(oid).then((res) => {
            if (!res.success) console.error("Email failed for", oid, res.error);
          });
        }
      } else if (orderStatus === "pending") {
        for (const oid of orderIds) {
          sendConfirmationEmail(oid).then((res) => {
            if (!res.success) console.error("Confirmation email failed for", oid, res.error);
          });
        }
      }
      onClose();
    } catch (err) {
      console.error("Failed to create order:", err);
      alert("Error creating order. Check the console for details.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-border rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-semibold">Crear Orden</h3>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground transition-colors"
          >
            {"✕"}
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Ticket Type */}
          <div>
            <label className="block text-sm font-medium mb-1">Tipo de Entrada</label>
            <select
              value={selectedTicketTypeId}
              onChange={(e) => setSelectedTicketTypeId(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-accent"
            >
              {ticketOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.name} — ${opt.price.toFixed(2)} ({opt.available} disponibles)
                </option>
              ))}
            </select>
          </div>

          {/* Quantity */}
          <div>
            <label className="block text-sm font-medium mb-1">Cantidad</label>
            <input
              type="number"
              min={1}
              max={10}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Math.min(10, Number(e.target.value))))}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-accent"
            />
          </div>

          {/* Name */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Nombre</label>
              <input
                type="text"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Apellido</label>
              <input
                type="text"
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-accent"
            />
          </div>

          {/* Cedula */}
          <div>
            <label className="block text-sm font-medium mb-1">Cedula</label>
            <input
              type="text"
              required
              value={cedula}
              onChange={(e) => setCedula(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-accent"
            />
          </div>

          {/* Payment Method */}
          <div>
            <label className="block text-sm font-medium mb-1">Metodo de Pago</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-accent"
            >
              {(concert.paymentMethods || []).map((pm) => (
                <option key={pm.id} value={pm.name}>
                  {pm.name}
                </option>
              ))}
            </select>
          </div>

          {/* Payment Proof (optional) */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Comprobante de Pago <span className="text-muted font-normal">(opcional)</span>
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setProofFile(e.target.files?.[0] || null)}
              className="w-full text-sm text-muted file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-border file:text-sm file:font-medium file:bg-surface-hover file:text-foreground hover:file:bg-surface-hover/80 file:transition-colors"
            />
          </div>

          {/* Status Toggle */}
          <div>
            <label className="block text-sm font-medium mb-2">Estado</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOrderStatus("approved")}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  orderStatus === "approved"
                    ? "bg-success/20 text-success border-success/50"
                    : "border-border text-muted hover:text-foreground"
                }`}
              >
                Aprobado
              </button>
              <button
                type="button"
                onClick={() => setOrderStatus("pending")}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  orderStatus === "pending"
                    ? "bg-warning/20 text-warning border-warning/50"
                    : "border-border text-muted hover:text-foreground"
                }`}
              >
                Pendiente
              </button>
            </div>
          </div>

          {/* Summary */}
          {selectedOption && (
            <div className="bg-background border border-border rounded-lg p-3 text-sm">
              <p className="text-muted">
                Total: <span className="text-foreground font-semibold">{quantity}x ${selectedOption.price.toFixed(2)} = ${(quantity * selectedOption.price).toFixed(2)}</span>
              </p>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 bg-accent hover:bg-accent-dark disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-accent/20"
          >
            {submitting ? "Creando..." : "Crear Orden"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function ConcertOrdersPage() {
  const params = useParams();
  const concertId = params.concertId as string;
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [ticketTypeFilter, setTicketTypeFilter] = useState<string>("all");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [couponOrderId, setCouponOrderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

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
      coupons: {},
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
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const fields = [
        o.firstName,
        o.lastName,
        `${o.firstName} ${o.lastName}`,
        o.email,
        o.cedula,
        o.paymentMethod,
        o.ticketTypeName,
        o.promoter,
        o.couponCode,
        String(orderNumberMap[o.id] ?? ""),
      ];
      if (!fields.some((f) => f && f.toLowerCase().includes(q))) return false;
    }
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

  async function approve(orderId: string) {
    await db.transact(db.tx.orders[orderId].update({ status: "approved" }));
    sendTicketEmail(orderId).then((res) => {
      if (!res.success) console.error("Email failed:", res.error);
    });
  }

  function reject(orderId: string) {
    db.transact(db.tx.orders[orderId].update({ status: "rejected" }));
  }

  function cancel(orderId: string) {
    if (confirm("Cancel this ticket? The QR code will no longer work.")) {
      db.transact(db.tx.orders[orderId].update({ status: "cancelled" }));
    }
  }

  function applyCouponToOrder(orderId: string, code: string, orderPrice: number) {
    const coupon = (concert.coupons || []).find(
      (c) => c.code.toUpperCase() === code.trim().toUpperCase(),
    );
    if (!coupon) return "Cupon invalido";
    if (!coupon.active) return "Cupon inactivo";

    if (coupon.maxUses != null) {
      const usageCount = allOrders.filter(
        (o) =>
          o.couponCode === coupon.code &&
          (o.status === "approved" || o.status === "pending"),
      ).length;
      if (usageCount >= coupon.maxUses) return "Cupon agotado";
    }

    const discount =
      coupon.discountType === "percentage"
        ? orderPrice * (coupon.discountValue / 100)
        : Math.min(coupon.discountValue, orderPrice);

    db.transact(
      db.tx.orders[orderId].update({
        couponCode: coupon.code,
        discountAmount: discount,
      }),
    );
    setCouponOrderId(null);
    return null;
  }

  function removeCouponFromOrder(orderId: string) {
    db.transact(
      db.tx.orders[orderId].update({
        couponCode: "",
        discountAmount: 0,
      }),
    );
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

      {/* Combined Totals Table */}
      {(() => {
        const pmNames = (concert.paymentMethods || []).map((pm) => pm.name);
        const allPmNames = Array.from(
          new Set([
            ...pmNames,
            ...allOrders.map((o) => o.paymentMethod).filter(Boolean),
          ]),
        );
        if (allPmNames.length === 0) return null;

        const statuses = [
          { key: "approved", label: "Approved", color: "text-success", headerBg: "bg-success/10 border-success/30" },
          { key: "pending", label: "Pending", color: "text-warning", headerBg: "bg-warning/10 border-warning/30" },
          { key: "rejected", label: "Rejected", color: "text-danger", headerBg: "bg-danger/10 border-danger/30" },
        ];

        const cells: Record<string, Record<string, { count: number; amount: number }>> = {};
        for (const s of statuses) {
          cells[s.key] = {};
          for (const pm of allPmNames) {
            cells[s.key][pm] = { count: 0, amount: 0 };
          }
        }

        for (const order of allOrders) {
          const s = order.status;
          const pm = order.paymentMethod;
          const finalPrice = order.ticketTypePrice - (order.discountAmount || 0);
          if (cells[s]?.[pm]) {
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

        return (
          <div className="bg-surface border border-border rounded-xl p-6 mb-6">
            <h2 className="text-lg font-semibold mb-1">Combined Totals</h2>
            <p className="text-sm text-muted mb-4">
              All ticket types &middot; {statusTotals[0].count + statusTotals[1].count} sold total
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
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
                  <tr className="border-b border-border/50">
                    {statuses.map((s) =>
                      allPmNames.map((pm) => {
                        const cell = cells[s.key][pm];
                        return (
                          <td key={`${s.key}-${pm}-count`} className="text-center py-2 px-2">
                            <span className={`font-bold ${s.color}`}>{cell.count}</span>
                            <span className="text-muted text-xs"> Cant.</span>
                          </td>
                        );
                      }),
                    )}
                  </tr>
                  <tr className="border-b border-border/50">
                    {statuses.map((s) =>
                      allPmNames.map((pm) => {
                        const cell = cells[s.key][pm];
                        return (
                          <td key={`${s.key}-${pm}-amount`} className="text-center py-2 px-2 text-muted">
                            ${cell.amount.toFixed(2)}
                          </td>
                        );
                      }),
                    )}
                  </tr>
                </tbody>
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
      })()}

      {/* Scanned Codes */}
      {(() => {
        const scannedOrders = allOrders
          .filter((o) => o.visited)
          .sort((a, b) => b.createdAt - a.createdAt);

        return (
          <div className="bg-surface border border-border rounded-xl p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold">Scanned Codes</h2>
                <p className="text-sm text-muted">
                  {scannedOrders.length} of {allOrders.filter((o) => o.status === "approved").length} approved tickets scanned
                </p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold text-success">{scannedOrders.length}</p>
                <p className="text-xs text-muted">scanned</p>
              </div>
            </div>

            {scannedOrders.length === 0 ? (
              <p className="text-muted text-center py-6 text-sm">
                No tickets have been scanned yet.
              </p>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {scannedOrders.map((order) => (
                  <div
                    key={order.id}
                    className="flex items-center justify-between gap-3 p-3 border border-success/20 bg-success/5 rounded-lg"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-success text-lg">{"✓"}</span>
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">
                          <span className="text-xs font-mono text-accent-light mr-2">
                            #{orderNumberMap[order.id]}
                          </span>
                          {order.firstName} {order.lastName}
                        </p>
                        <p className="text-xs text-muted truncate">
                          {order.email} &middot; {order.cedula}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-medium text-muted">{order.ticketTypeName}</p>
                      <p className="text-xs text-muted">
                        {new Date(order.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

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
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">Order List</h2>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-3 py-1.5 bg-accent hover:bg-accent-dark text-white rounded-lg text-xs font-medium transition-colors shadow-lg shadow-accent/20"
            >
              + Crear Orden
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

        <div className="relative mb-4">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, email, cedula, promoter, coupon..."
            className="w-full px-4 py-2.5 pl-10 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-accent-light transition-colors"
          />
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
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

        {filteredOrders.length === 0 ? (
          <p className="text-muted text-center py-8">
            No {filter === "all" ? "" : filter} orders{searchQuery ? ` matching "${searchQuery}"` : ""} for this event.
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
                  {order.paymentProofPath === "admin-created" ? (
                    <span className="px-3 py-1.5 text-xs border border-accent/30 bg-accent/10 text-accent-light rounded-lg font-medium">
                      Admin
                    </span>
                  ) : order.paymentProofPath ? (
                    <button
                      onClick={() => viewProof(order.paymentProofPath!)}
                      className="px-3 py-1.5 text-xs border border-border rounded-lg hover:border-accent/50 transition-colors"
                    >
                      Proof
                    </button>
                  ) : null}
                  {order.proofReferenceNumber && (
                    <span className="px-3 py-1.5 text-xs border border-warning/30 bg-warning/10 text-warning rounded-lg font-medium truncate max-w-[140px]" title={`Ref: ${order.proofReferenceNumber}`}>
                      Ref: {order.proofReferenceNumber}
                    </span>
                  )}
                  {order.status === "pending" && (
                    <>
                      {couponOrderId === order.id ? (
                        <CouponInlineInput
                          onApply={(code) => applyCouponToOrder(order.id, code, order.ticketTypePrice)}
                          onCancel={() => setCouponOrderId(null)}
                        />
                      ) : order.couponCode ? (
                        <button
                          onClick={() => removeCouponFromOrder(order.id)}
                          className="px-3 py-1.5 text-xs bg-danger/10 text-danger border border-danger/30 rounded-lg hover:bg-danger/20 transition-colors font-medium"
                        >
                          {"✕"} {order.couponCode}
                        </button>
                      ) : (
                        <button
                          onClick={() => setCouponOrderId(order.id)}
                          className="px-3 py-1.5 text-xs border border-accent/30 text-accent-light rounded-lg hover:bg-accent/10 transition-colors font-medium"
                        >
                          Coupon
                        </button>
                      )}
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

      {/* Create order modal */}
      {showCreateModal && (
        <CreateOrderModal
          concert={concert}
          onClose={() => setShowCreateModal(false)}
        />
      )}

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
            {previewUrl.startsWith("ref:") ? (
              <div className="bg-background border border-border rounded-lg p-6 text-center">
                <p className="text-sm text-muted mb-1">Reference Number</p>
                <p className="text-xl font-mono font-bold">{previewUrl.slice(4)}</p>
              </div>
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={previewUrl}
                alt="Payment proof"
                className="max-w-full rounded-lg"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
