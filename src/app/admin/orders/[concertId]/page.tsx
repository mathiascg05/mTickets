"use client";

import { db } from "@/lib/db";
import { id } from "@instantdb/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { getAvailability, getTodayString } from "@/lib/phases";
import { sendTicketEmail, sendConfirmationEmail } from "@/lib/sendTicketEmail";
import { useLanguage } from "@/lib/LanguageContext";

function StatusBadge({ status }: { status: string }) {
  const { t } = useLanguage();
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
      className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[status] || "bg-muted/10 text-muted border-muted/30"}`}
    >
      {labelMap[status] || status.charAt(0).toUpperCase() + status.slice(1)}
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
  customFieldValues?: string;
  status: string;
  paymentProofPath?: string;
  proofReferenceNumber?: string;
  couponCode?: string;
  discountAmount?: number;
  orderNumber?: string;
  createdAt: number;
  ticketTypeName: string;
  ticketTypePrice: number;
  purchaseRate?: number;
  purchaseRateCurrency?: string;
  purchaseAmountBs?: number;
};

function ExportSection({
  concertName,
  allOrders,
  pmCurrencyMap,
  rateMap,
}: {
  concertName: string;
  allOrders: FlatOrder[];
  pmCurrencyMap: Record<string, string>;
  rateMap: Record<string, number>;
}) {
  const { t } = useLanguage();
  function escapeCsv(val: string) {
    if (val.includes(",") || val.includes('"') || val.includes("\n")) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  }

  function downloadCsv() {
    // Collect all custom field keys across orders
    const cfKeys = new Set<string>();
    for (const order of allOrders) {
      if (order.customFieldValues) {
        try {
          for (const key of Object.keys(JSON.parse(order.customFieldValues))) {
            cfKeys.add(key);
          }
        } catch { /* ignore */ }
      }
    }
    // Fall back to promoter column if any old orders have it and no custom fields use that key
    const hasLegacyPromoter = allOrders.some((o) => o.promoter && !o.customFieldValues);
    const cfKeyList = [...cfKeys];

    const headers = [
      "Order #",
      t("common.firstName"),
      t("common.lastName"),
      t("checkout.paymentMethod"),
      "Amount ($)",
      "Amount (Bs)",
      ...(hasLegacyPromoter ? ["Promoter"] : []),
      ...cfKeyList,
      t("common.status"),
      t("common.date"),
      t("admin.coupon"),
    ];

    const sorted = [...allOrders].sort((a, b) => a.createdAt - b.createdAt);

    const rows = sorted.map((order) => {
      const effectivePrice =
        order.ticketTypePrice - (order.discountAmount || 0);
      const currency = pmCurrencyMap[order.paymentMethod];
      const rate = order.purchaseRate ?? (currency ? rateMap[currency] : null);
      const amountUsd = currency ? "" : effectivePrice.toFixed(2);
      const amountBs = order.purchaseAmountBs != null
        ? order.purchaseAmountBs.toFixed(2)
        : (rate != null ? (effectivePrice * rate).toFixed(2) : "");

      let cfVals: Record<string, string> = {};
      if (order.customFieldValues) {
        try { cfVals = JSON.parse(order.customFieldValues); } catch { /* ignore */ }
      }

      return [
        escapeCsv(order.orderNumber || "---"),
        escapeCsv(order.firstName),
        escapeCsv(order.lastName),
        escapeCsv(order.paymentMethod),
        amountUsd,
        amountBs,
        ...(hasLegacyPromoter ? [escapeCsv(order.promoter || "")] : []),
        ...cfKeyList.map((key) => escapeCsv(cfVals[key] || "")),
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
          <h2 className="text-lg font-semibold">{t("admin.export")}</h2>
          <p className="text-sm text-muted">
            {t("admin.downloadAll", { count: allOrders.length })}
          </p>
        </div>
        <button
          onClick={downloadCsv}
          disabled={allOrders.length === 0}
          className="px-4 py-2 bg-accent hover:bg-accent-dark disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-accent/20"
        >
          {t("admin.downloadCsv")}
        </button>
      </div>
    </div>
  );
}

function EmailInlineEdit({
  currentEmail,
  onSave,
  onCancel,
}: {
  currentEmail: string;
  onSave: (email: string) => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const [email, setEmail] = useState(currentEmail);

  function handleSave() {
    const trimmed = email.trim();
    if (!trimmed) return;
    onSave(trimmed);
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave();
          if (e.key === "Escape") onCancel();
        }}
        className="w-48 px-2 py-0.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:border-accent"
        autoFocus
        required
      />
      <button
        onClick={handleSave}
        className="px-2 py-0.5 text-xs bg-accent/10 text-accent-light border border-accent/30 rounded-lg hover:bg-accent/20 transition-colors"
      >
        {t("common.ok")}
      </button>
      <button
        onClick={onCancel}
        className="px-2 py-0.5 text-xs text-muted border border-border rounded-lg hover:text-foreground transition-colors"
      >
        {"✕"}
      </button>
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
  const { t } = useLanguage();
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
        placeholder={t("admin.code")}
        className={`w-24 px-2 py-1 text-xs bg-background border rounded-lg focus:outline-none focus:border-accent ${error ? "border-danger" : "border-border"}`}
        autoFocus
      />
      <button
        onClick={handleApply}
        className="px-2 py-1 text-xs bg-accent/10 text-accent-light border border-accent/30 rounded-lg hover:bg-accent/20 transition-colors"
      >
        {t("common.ok")}
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
  refreshToken,
  pmCurrencyMap,
  rateMap,
}: {
  refreshToken: string;
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
    customFields?: { id: string; label: string; fieldType: string; required: boolean; options?: string; sortOrder: number }[];
  };
  onClose: () => void;
  pmCurrencyMap: Record<string, string>;
  rateMap: Record<string, number>;
}) {
  const [selectedTicketTypeId, setSelectedTicketTypeId] = useState(
    concert.ticketTypes[0]?.id || "",
  );
  const [quantity, setQuantity] = useState(1);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [cedula, setCedula] = useState("");
  const [cfValues, setCfValues] = useState<Record<string, string>>({});
  const [isCortesia, setIsCortesia] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState(concert.paymentMethods[0]?.name || "");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [orderStatus, setOrderStatus] = useState<"approved" | "pending">("approved");
  const [submitting, setSubmitting] = useState(false);
  const { t } = useLanguage();

  const today = getTodayString();

  const ticketOptions = concert.ticketTypes.map((tt) => {
    const avail = getAvailability(tt, tt.phases || [], tt.orders, today);
    const fp = (tt as { feePercent?: number }).feePercent ?? 0;
    const ff = (tt as { feeFixed?: number }).feeFixed ?? 0;
    const fee = (avail.price * fp) / 100 + ff;
    return { id: tt.id, name: tt.name, price: avail.price + fee, available: avail.available, activePhase: avail.activePhase };
  });

  const selectedOption = ticketOptions.find((o) => o.id === selectedTicketTypeId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedOption || submitting) return;
    setSubmitting(true);

    try {
      const effectivePaymentMethod = isCortesia ? "Cortesia" : paymentMethod;
      let filePath = isCortesia ? "cortesia" : "admin-created";
      if (!isCortesia && proofFile) {
        const ext = proofFile.name.split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "") || "jpg";
        const storagePath = `payment-proofs/${Date.now()}-admin.${ext}`;
        await db.storage.upload(storagePath, proofFile);
        filePath = storagePath;
      }

      const orderIds: string[] = [];
      const purchaseGroupId = quantity > 1 ? id() : undefined;
      const txns = Array.from({ length: quantity }, () => {
        const orderId = id();
        orderIds.push(orderId);
        return db.tx.orders[orderId]
          .update({
            firstName,
            lastName,
            email,
            cedula,
            paymentMethod: effectivePaymentMethod,
            status: orderStatus,
            paymentProofPath: filePath,
            visited: false,
            createdAt: Date.now(),
            ...(selectedOption.activePhase
              ? { phaseId: selectedOption.activePhase.id }
              : {}),
            ...(purchaseGroupId ? { purchaseGroupId } : {}),
            ...(isCortesia
              ? { discountAmount: selectedOption.price }
              : pmCurrencyMap[paymentMethod] && rateMap[pmCurrencyMap[paymentMethod]]
                ? {
                    purchaseRate: rateMap[pmCurrencyMap[paymentMethod]],
                    purchaseRateCurrency: pmCurrencyMap[paymentMethod],
                    purchaseAmountBs: Math.round(selectedOption.price * rateMap[pmCurrencyMap[paymentMethod]] * 100) / 100,
                  }
                : {}),
            ...(Object.keys(cfValues).length > 0
              ? {
                  customFieldValues: JSON.stringify(
                    Object.fromEntries(
                      (concert.customFields || [])
                        .filter((cf) => cfValues[cf.id])
                        .map((cf) => [cf.label, cfValues[cf.id]]),
                    ),
                  ),
                }
              : {}),
          })
          .link({ ticketType: selectedTicketTypeId });
      });
      await db.transact(txns);
      // Assign order numbers for all created orders
      await Promise.allSettled(
        orderIds.map((oid) =>
          fetch("/api/assign-order-number", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId: oid }),
          }),
        ),
      );
      if (orderStatus === "approved") {
        await Promise.allSettled(orderIds.map((oid) => sendTicketEmail(oid, refreshToken)));
      } else if (orderStatus === "pending") {
        await Promise.allSettled(orderIds.map((oid) => sendConfirmationEmail(oid, refreshToken)));
      }
      onClose();
    } catch (err) {
      console.error("Failed to create order:", err);
      alert(t("admin.errorCreatingOrder"));
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
          <h3 className="text-lg font-semibold">{t("admin.createOrderTitle")}</h3>
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
            <label className="block text-sm font-medium mb-1">{t("admin.ticketTypeLabel")}</label>
            <select
              value={selectedTicketTypeId}
              onChange={(e) => setSelectedTicketTypeId(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-accent"
            >
              {ticketOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.name} — ${opt.price.toFixed(2)} ({t("admin.available", { count: opt.available })})
                </option>
              ))}
            </select>
          </div>

          {/* Quantity */}
          <div>
            <label className="block text-sm font-medium mb-1">{t("common.quantity")}</label>
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
              <label className="block text-sm font-medium mb-1">{t("common.firstName")}</label>
              <input
                type="text"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("common.lastName")}</label>
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
            <label className="block text-sm font-medium mb-1">{t("common.email")}</label>
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
            <label className="block text-sm font-medium mb-1">{t("common.cedula")}</label>
            <input
              type="text"
              required
              value={cedula}
              onChange={(e) => setCedula(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-accent"
            />
          </div>

          {/* Custom Fields */}
          {(concert.customFields || [])
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((cf) => {
              const val = cfValues[cf.id] || "";
              let parsedOptions: string[] = [];
              try { parsedOptions = cf.options ? JSON.parse(cf.options) : []; } catch { /* ignore */ }
              return (
                <div key={cf.id}>
                  <label className="block text-sm font-medium mb-1">
                    {cf.label}{cf.required ? " *" : ""}
                  </label>
                  {(cf.fieldType === "text" || cf.fieldType === "number" || cf.fieldType === "email" || cf.fieldType === "date") && (
                    <input
                      type={cf.fieldType}
                      required={cf.required}
                      value={val}
                      onChange={(e) => setCfValues((p) => ({ ...p, [cf.id]: e.target.value }))}
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-accent"
                    />
                  )}
                  {cf.fieldType === "checkbox" && (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={val === "true"}
                        onChange={(e) => setCfValues((p) => ({ ...p, [cf.id]: e.target.checked ? "true" : "false" }))}
                        className="accent-accent"
                      />
                      <span className="text-sm">{cf.label}</span>
                    </label>
                  )}
                  {cf.fieldType === "select" && (
                    <select
                      required={cf.required}
                      value={val}
                      onChange={(e) => setCfValues((p) => ({ ...p, [cf.id]: e.target.value }))}
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-accent"
                    >
                      <option value="">{t("common.select")}</option>
                      {parsedOptions.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  )}
                  {cf.fieldType === "multiselect" && (
                    <div className="space-y-1">
                      {parsedOptions.map((opt) => {
                        let selected: string[] = [];
                        try { selected = val ? JSON.parse(val) : []; } catch { /* ignore */ }
                        const isChecked = selected.includes(opt);
                        return (
                          <label key={opt} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                const next = isChecked ? selected.filter((s) => s !== opt) : [...selected, opt];
                                setCfValues((p) => ({ ...p, [cf.id]: JSON.stringify(next) }));
                              }}
                              className="accent-accent"
                            />
                            <span className="text-sm">{opt}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

          {/* Cortesia Toggle */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsCortesia(!isCortesia)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                isCortesia ? "bg-accent" : "bg-border"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  isCortesia ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
            <label className="text-sm font-medium">{t("admin.cortesia")}</label>
          </div>

          {!isCortesia && (
            <>
              {/* Payment Method */}
              <div>
                <label className="block text-sm font-medium mb-1">{t("admin.paymentMethodLabel")}</label>
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
                  {t("admin.paymentProof")} <span className="text-muted font-normal">({t("common.optional")})</span>
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setProofFile(e.target.files?.[0] || null)}
                  className="w-full text-sm text-muted file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-border file:text-sm file:font-medium file:bg-surface-hover file:text-foreground hover:file:bg-surface-hover/80 file:transition-colors"
                />
              </div>
            </>
          )}

          {/* Status Toggle */}
          <div>
            <label className="block text-sm font-medium mb-2">{t("common.status")}</label>
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
                {t("common.approved")}
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
                {t("common.pending")}
              </button>
            </div>
          </div>

          {/* Summary */}
          {selectedOption && (
            <div className="bg-background border border-border rounded-lg p-3 text-sm">
              <p className="text-muted">
                {isCortesia ? (
                  <>{t("admin.orderTotal")}<span className="text-foreground font-semibold">{t("admin.cortesiaTotal", { qty: quantity })}</span></>
                ) : (
                  <>{t("admin.orderTotal")}<span className="text-foreground font-semibold">{quantity}x ${selectedOption.price.toFixed(2)} = ${(quantity * selectedOption.price).toFixed(2)}</span></>
                )}
              </p>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 bg-accent hover:bg-accent-dark disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-accent/20"
          >
            {submitting ? t("admin.creating") : t("admin.createOrderTitle")}
          </button>
        </form>
      </div>
    </div>
  );
}

type ParsedRow = {
  firstName: string;
  lastName: string;
  email: string;
  cedula: string;
  customFieldValues: Record<string, string>;
  errors: string[];
};

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
  }
  result.push(current.trim());
  return result;
}

function ImportCsvModal({
  concert,
  onClose,
  refreshToken,
}: {
  concert: {
    name: string;
    ticketTypes: {
      id: string;
      name: string;
      price: number;
      quantity: number;
      orders: { id: string; status: string; phaseId?: string }[];
      phases: { id: string; name: string; price: number; quantity: number; endDate?: string; sortOrder: number }[];
    }[];
    paymentMethods: { id: string; name: string }[];
    customFields?: { id: string; label: string; fieldType: string; required: boolean; options?: string; sortOrder: number }[];
  };
  onClose: () => void;
  refreshToken: string;
}) {
  const [selectedTicketTypeId, setSelectedTicketTypeId] = useState(concert.ticketTypes[0]?.id || "");
  const [paymentMethod, setPaymentMethod] = useState("Cortesia");
  const [orderStatus, setOrderStatus] = useState<"approved" | "pending">("approved");
  const [sendEmails, setSendEmails] = useState(false);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number } | null>(null);
  const { t } = useLanguage();

  const today = getTodayString();
  const customFields = (concert.customFields || []).sort((a, b) => a.sortOrder - b.sortOrder);
  const fixedHeaders = [t("common.firstName"), t("common.lastName"), t("common.email"), t("common.cedula")];
  const cfHeaders = customFields.map((cf) => cf.label);
  const allHeaders = [...fixedHeaders, ...cfHeaders];

  const selectedTt = concert.ticketTypes.find((tt) => tt.id === selectedTicketTypeId);
  const avail = selectedTt ? getAvailability(selectedTt, selectedTt.phases || [], selectedTt.orders, today) : null;

  const validRows = rows.filter((r) => r.errors.length === 0);
  const errorRows = rows.filter((r) => r.errors.length > 0);

  function downloadTemplate() {
    const csv = "\uFEFF" + allHeaders.join(",") + "\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${concert.name.replace(/[^a-zA-Z0-9]/g, "_")}_plantilla.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function validateRow(values: string[]): ParsedRow {
    const firstName = values[0] || "";
    const lastName = values[1] || "";
    const email = values[2] || "";
    const cedula = values[3] || "";
    const errors: string[] = [];

    if (!firstName) errors.push(t("admin.nameRequired"));
    if (!lastName) errors.push(t("admin.lastNameRequired"));
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push(t("admin.emailInvalid"));
    if (!cedula || !/^\d+$/.test(cedula)) errors.push(t("admin.cedulaInvalid"));

    const cfValues: Record<string, string> = {};
    customFields.forEach((cf, i) => {
      const val = values[4 + i] || "";
      if (cf.required && !val) {
        errors.push(t("admin.fieldRequired", { field: cf.label }));
      }
      if (val && (cf.fieldType === "select" || cf.fieldType === "multiselect")) {
        let opts: string[] = [];
        try { opts = cf.options ? JSON.parse(cf.options) : []; } catch { /* ignore */ }
        if (opts.length > 0 && !opts.includes(val)) {
          errors.push(t("admin.invalidOption", { field: cf.label }));
        }
      }
      if (val) cfValues[cf.label] = val;
    });

    return { firstName, lastName, email, cedula, customFieldValues: cfValues, errors };
  }

  function handleFileUpload(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string || "").replace(/^\uFEFF/, "");
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) {
        setRows([]);
        return;
      }
      // Skip header row
      const dataLines = lines.slice(1);
      const parsed = dataLines.map((line) => validateRow(parseCsvLine(line)));
      setRows(parsed);
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!selectedTt || validRows.length === 0 || importing) return;
    if (avail && validRows.length > avail.available) {
      alert(t("admin.notAvailable", { available: avail.available, count: validRows.length }));
      return;
    }
    setImporting(true);

    try {
      const orderIds: string[] = [];
      const txns = validRows.map((row) => {
        const orderId = id();
        orderIds.push(orderId);
        const cfJson = Object.keys(row.customFieldValues).length > 0
          ? JSON.stringify(row.customFieldValues)
          : undefined;
        return db.tx.orders[orderId]
          .update({
            firstName: row.firstName,
            lastName: row.lastName,
            email: row.email,
            cedula: row.cedula,
            paymentMethod,
            status: orderStatus,
            paymentProofPath: "csv-import",
            visited: false,
            createdAt: Date.now(),
            ...(avail?.activePhase ? { phaseId: avail.activePhase.id } : {}),
            ...(cfJson ? { customFieldValues: cfJson } : {}),
          })
          .link({ ticketType: selectedTicketTypeId });
      });
      await db.transact(txns);

      // Assign order numbers
      await Promise.allSettled(
        orderIds.map((oid) =>
          fetch("/api/assign-order-number", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId: oid }),
          }),
        ),
      );

      // Send emails if enabled
      if (sendEmails) {
        const emailFn = orderStatus === "approved" ? sendTicketEmail : sendConfirmationEmail;
        await Promise.allSettled(orderIds.map((oid) => emailFn(oid, refreshToken)));
      }

      setImportResult({ created: validRows.length });
    } catch (err) {
      console.error("Import failed:", err);
      alert(t("admin.errorImport"));
    } finally {
      setImporting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-border rounded-2xl p-6 w-full max-w-4xl max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-semibold">{t("admin.importTitle")}</h3>
          <button onClick={onClose} className="text-muted hover:text-foreground transition-colors">
            {"✕"}
          </button>
        </div>

        {importResult ? (
          <div className="text-center py-8">
            <div className="text-4xl mb-3">{"✓"}</div>
            <p className="text-lg font-semibold mb-1">{t("admin.ordersCreated", { count: importResult.created })}</p>
            <p className="text-sm text-muted mb-4">{t("admin.importSuccess")}</p>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-accent hover:bg-accent-dark text-white rounded-lg text-sm font-medium transition-colors"
            >
              {t("common.close")}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Config row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">{t("admin.ticketTypeLabel")}</label>
                <select
                  value={selectedTicketTypeId}
                  onChange={(e) => setSelectedTicketTypeId(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-accent"
                >
                  {concert.ticketTypes.map((tt) => {
                    const a = getAvailability(tt, tt.phases || [], tt.orders, today);
                    return (
                      <option key={tt.id} value={tt.id}>
                        {tt.name} — ${a.price.toFixed(2)} ({t("admin.available", { count: a.available })})
                      </option>
                    );
                  })}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("admin.paymentMethodLabel")}</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-accent"
                >
                  <option value="Cortesia">{t("admin.cortesia")}</option>
                  {(concert.paymentMethods || []).map((pm) => (
                    <option key={pm.id} value={pm.name}>{pm.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Status + email toggles */}
            <div className="flex items-center gap-4">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOrderStatus("approved")}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    orderStatus === "approved"
                      ? "bg-success/20 text-success border-success/50"
                      : "border-border text-muted hover:text-foreground"
                  }`}
                >
                  {t("common.approved")}
                </button>
                <button
                  type="button"
                  onClick={() => setOrderStatus("pending")}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    orderStatus === "pending"
                      ? "bg-warning/20 text-warning border-warning/50"
                      : "border-border text-muted hover:text-foreground"
                  }`}
                >
                  {t("common.pending")}
                </button>
              </div>
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={sendEmails}
                  onChange={(e) => setSendEmails(e.target.checked)}
                  className="accent-accent"
                />
                {t("admin.sendEmails")}
              </label>
            </div>

            {/* Template + Upload */}
            <div className="flex items-center gap-3">
              <button
                onClick={downloadTemplate}
                className="px-3 py-2 border border-border hover:border-accent/50 text-muted hover:text-accent-light rounded-lg text-sm font-medium transition-colors"
              >
                {t("admin.downloadTemplate")}
              </button>
              <label className="flex-1 flex items-center justify-center px-4 py-3 border-2 border-dashed border-border hover:border-accent/40 rounded-lg cursor-pointer transition-colors">
                <span className="text-sm text-muted">
                  {rows.length > 0 ? t("admin.rowsLoaded", { count: rows.length }) : t("admin.selectFile")}
                </span>
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileUpload(f);
                  }}
                />
              </label>
            </div>

            {/* Preview table */}
            {rows.length > 0 && (
              <>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-success font-medium">{t("admin.validRows", { count: validRows.length })}</span>
                  {errorRows.length > 0 && (
                    <span className="text-danger font-medium">{t("admin.errorRows", { count: errorRows.length })}</span>
                  )}
                </div>

                <div className="border border-border rounded-lg overflow-auto max-h-72">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-background border-b border-border">
                        <th className="px-3 py-2 text-left font-medium text-muted">#</th>
                        {allHeaders.map((h) => (
                          <th key={h} className="px-3 py-2 text-left font-medium text-muted whitespace-nowrap">{h}</th>
                        ))}
                        <th className="px-3 py-2 text-left font-medium text-muted">{t("common.status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <tr
                          key={i}
                          className={`border-b border-border last:border-0 ${
                            row.errors.length > 0 ? "bg-danger/5" : ""
                          }`}
                        >
                          <td className="px-3 py-2 text-muted">{i + 1}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{row.firstName}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{row.lastName}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{row.email}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{row.cedula}</td>
                          {customFields.map((cf) => (
                            <td key={cf.id} className="px-3 py-2 whitespace-nowrap">
                              {row.customFieldValues[cf.label] || ""}
                            </td>
                          ))}
                          <td className="px-3 py-2">
                            {row.errors.length === 0 ? (
                              <span className="text-success text-xs">{t("common.ok")}</span>
                            ) : (
                              <span className="text-danger text-xs">{row.errors.join(", ")}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <button
                  onClick={handleImport}
                  disabled={validRows.length === 0 || importing}
                  className="w-full py-2.5 bg-accent hover:bg-accent-dark disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-accent/20"
                >
                  {importing
                    ? t("admin.importing")
                    : t("admin.importButton", { count: validRows.length })}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ConcertOrdersPage() {
  const { t } = useLanguage();
  const params = useParams();
  const concertId = params.concertId as string;
  const { user } = db.useAuth();
  const refreshToken = user?.refresh_token || "";
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [ticketTypeFilter, setTicketTypeFilter] = useState<string>("all");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [couponOrderId, setCouponOrderId] = useState<string | null>(null);
  const [editingEmailOrderId, setEditingEmailOrderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [scannedSearch, setScannedSearch] = useState("");
  const [resendOrderId, setResendOrderId] = useState<string | null>(null);
  const [resendType, setResendType] = useState<"confirmation" | "ticket">("confirmation");
  const [resendingOrderId, setResendingOrderId] = useState<string | null>(null);

  const userEmail = user?.email || "";
  const { data: balanceData } = db.useQuery(
    userEmail
      ? { organizerBalances: { $: { where: { email: userEmail.toLowerCase() } } } }
      : null,
  );
  const organizerBalance = balanceData?.organizerBalances?.[0];

  const { data: feeConfigData } = db.useQuery(
    concertId
      ? { platformFeeConfigs: { $: { where: { "concert.id": concertId } } } }
      : null,
  );
  const platformFeeConfig = feeConfigData?.platformFeeConfigs?.[0];

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
      customFields: {
        $: { order: { sortOrder: "asc" } },
      },
      coupons: {},
    },
    exchangeRates: {},
  });

  // Direct subscription to orders for this concert — ensures real-time updates
  // for attribute changes (like 'visited') propagate reliably
  const { data: liveOrderData } = db.useQuery({
    orders: {
      $: { where: { "ticketType.concert.id": concertId } },
    },
  });

  if (isLoading || !data) {
    return <div className="animate-pulse text-muted">{t("common.loading")}</div>;
  }

  const concert = data.concerts[0];
  if (!concert) {
    return <div className="text-muted">{t("admin.eventNotFound")}</div>;
  }

  // Build a live lookup for order fields (especially 'visited') from the direct subscription
  const liveOrderMap = new Map(
    (liveOrderData?.orders || []).map((o) => [o.id, o]),
  );

  // Flatten all orders with their ticket type info (use phase price when available)
  const allOrders = concert.ticketTypes.flatMap((tt) =>
    tt.orders.map((order) => {
      const phase = (tt.phases || []).find((p: { id: string }) => p.id === order.phaseId);
      const live = liveOrderMap.get(order.id);
      return {
        ...order,
        // Prefer live data for 'visited' to ensure real-time scanner updates
        visited: live ? live.visited : order.visited,
        ticketTypeName: tt.name,
        ticketTypePrice: (phase ? phase.price : tt.price) + ((phase ? phase.price : tt.price) * ((tt as { feePercent?: number }).feePercent ?? 0)) / 100 + ((tt as { feeFixed?: number }).feeFixed ?? 0),
        purchaseRate: (order as { purchaseRate?: number }).purchaseRate,
        purchaseRateCurrency: (order as { purchaseRateCurrency?: string }).purchaseRateCurrency,
        purchaseAmountBs: (order as { purchaseAmountBs?: number }).purchaseAmountBs,
      };
    }),
  );
  allOrders.sort((a, b) => b.createdAt - a.createdAt);

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
      let cfText = "";
      if (o.customFieldValues) {
        try { cfText = Object.values(JSON.parse(o.customFieldValues)).join(" "); } catch { /* ignore */ }
      }
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
        o.orderNumber,
        cfText,
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
    const basePrice = phase ? phase.price : tt.price;
    const feePercent = (tt as { feePercent?: number }).feePercent ?? 0;
    const feeFixed = (tt as { feeFixed?: number }).feeFixed ?? 0;
    const fee = (basePrice * feePercent) / 100 + feeFixed;
    return basePrice + fee - (order.discountAmount || 0);
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

  async function updateOrderStatus(orderId: string, action: "approve" | "reject" | "cancel") {
    try {
      const res = await fetch("/api/approve-order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${refreshToken}`,
        },
        body: JSON.stringify({ orderId, action }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "NO_BALANCE" || data.error === "INSUFFICIENT_BALANCE") {
          alert(t("admin.insufficientBalance", {
            required: `$${data.requiredFee?.toFixed(2) || "?"}`,
            current: data.currentBalance != null ? `$${data.currentBalance.toFixed(2)}` : "$0.00",
          }));
        } else {
          alert(data.message || data.error || t("admin.errorUpdatingOrder"));
        }
        return;
      }
      if (action === "approve" && !res.ok) {
        alert(t("admin.approveEmailFail"));
      }
    } catch (err) {
      console.error(`Failed to ${action} order:`, err);
      alert(t("admin.errorUpdatingOrder"));
    }
  }

  async function approve(orderId: string) {
    await updateOrderStatus(orderId, "approve");
  }

  function reject(orderId: string) {
    updateOrderStatus(orderId, "reject");
  }

  function cancel(orderId: string) {
    if (confirm(t("admin.cancelTicketConfirm"))) {
      updateOrderStatus(orderId, "cancel");
    }
  }

  function applyCouponToOrder(orderId: string, code: string, orderPrice: number) {
    const coupon = (concert.coupons || []).find(
      (c) => c.code.toUpperCase() === code.trim().toUpperCase(),
    );
    if (!coupon) return t("checkout.invalidCoupon");
    if (!coupon.active) return t("checkout.couponInactive");

    if (coupon.maxUses != null) {
      const usageCount = allOrders.filter(
        (o) =>
          o.couponCode === coupon.code &&
          (o.status === "approved" || o.status === "pending"),
      ).length;
      if (usageCount >= coupon.maxUses) return t("checkout.couponLimit");
    }

    const discount =
      coupon.discountType === "percentage"
        ? Math.min(orderPrice, orderPrice * (coupon.discountValue / 100))
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
        {t("admin.allEvents")}
      </Link>

      <h1 className="text-3xl font-bold mb-2">{concert.name}</h1>
      <p className="text-muted mb-8">
        {concert.venue} &middot; {concert.date}
      </p>

      {/* Summary Stats */}
      <div className="bg-surface border border-border rounded-xl p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">{t("admin.eventSummary")}</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="border-l-4 border-accent-light pl-4">
            <p className="text-sm text-muted">{t("admin.totalOrders")}</p>
            <p className="text-3xl font-bold text-accent-light">{totalOrders}</p>
          </div>
          <div className="border-l-4 border-success pl-4">
            <p className="text-sm text-muted">{t("admin.ticketsIssued")}</p>
            <p className="text-3xl font-bold text-success">{totalTicketsIssued}</p>
          </div>
          <div className="border-l-4 border-accent-light pl-4">
            <p className="text-sm text-muted">{t("admin.totalRevenue")}</p>
            <p className="text-3xl font-bold text-accent-light">
              ${totalRevenue.toFixed(2)}
            </p>
          </div>
          <div className="border-l-4 border-warning pl-4">
            <p className="text-sm text-muted">{t("admin.pendingApproval")}</p>
            <p className="text-3xl font-bold text-warning">{pendingCount}</p>
          </div>
        </div>
      </div>

      {/* Platform Balance & Fee Info */}
      {platformFeeConfig && platformFeeConfig.billingMode !== "postpaid" && (
        <div className={`border rounded-xl p-4 mb-6 ${
          !organizerBalance || organizerBalance.balance <= 0
            ? "bg-danger/5 border-danger/30"
            : organizerBalance.balance < 10
              ? "bg-warning/5 border-warning/30"
              : "bg-surface border-border"
        }`}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-sm text-muted">{t("admin.platformBalance")}</p>
              <p className={`text-2xl font-bold ${
                !organizerBalance || organizerBalance.balance <= 0
                  ? "text-danger"
                  : organizerBalance.balance < 10
                    ? "text-warning"
                    : "text-foreground"
              }`}>
                ${organizerBalance?.balance?.toFixed(2) || "0.00"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted">{t("admin.platformFee")}</p>
              <p className="text-sm font-medium">
                {platformFeeConfig.feePercent}%
                {platformFeeConfig.feeFixed > 0 && ` + $${platformFeeConfig.feeFixed.toFixed(2)}`}
              </p>
            </div>
          </div>
          {(!organizerBalance || organizerBalance.balance <= 0) && (
            <p className="text-sm text-danger mt-2 font-medium">
              {t("admin.noBalanceWarning")}
            </p>
          )}
        </div>
      )}
      {platformFeeConfig && platformFeeConfig.billingMode === "postpaid" && (
        <div className="border rounded-xl p-4 mb-6 bg-warning/5 border-warning/30">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-sm text-muted">{t("admin.accumulatedFees")}</p>
              <p className="text-2xl font-bold text-warning">
                ${Math.abs(organizerBalance?.balance || 0).toFixed(2)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted">{t("admin.platformFee")}</p>
              <p className="text-sm font-medium">
                {platformFeeConfig.feePercent}%
                {platformFeeConfig.feeFixed > 0 && ` + $${platformFeeConfig.feeFixed.toFixed(2)}`}
              </p>
            </div>
          </div>
          <p className="text-sm text-warning mt-2 font-medium">
            {t("admin.postpaidMode")}
          </p>
        </div>
      )}

      {/* Per-ticket-type breakdown: Status x Payment Method */}
      {concert.ticketTypes.map((tt) => {
        const pmNames = (concert.paymentMethods || []).map((pm) => pm.name);
        const statuses = [
          { key: "approved", label: t("common.approved"), color: "text-success", headerBg: "bg-success/10 border-success/30" },
          { key: "pending", label: t("common.pending"), color: "text-warning", headerBg: "bg-warning/10 border-warning/30" },
          { key: "rejected", label: t("common.rejected"), color: "text-danger", headerBg: "bg-danger/10 border-danger/30" },
        ];

        // Build data: for each status × payment method, count, amount, and Bs amount
        const cells: Record<string, Record<string, { count: number; amount: number; amountBs: number }>> = {};
        for (const s of statuses) {
          cells[s.key] = {};
          for (const pm of pmNames) {
            cells[s.key][pm] = { count: 0, amount: 0, amountBs: 0 };
          }
        }
        for (const order of tt.orders) {
          const s = order.status;
          const pm = order.paymentMethod;
          const orderPhase = (tt.phases || []).find((p: { id: string }) => p.id === order.phaseId);
          const basePrice = orderPhase ? orderPhase.price : tt.price;
          const fee = (basePrice * ((tt as { feePercent?: number }).feePercent ?? 0)) / 100 + ((tt as { feeFixed?: number }).feeFixed ?? 0);
          const finalPrice = basePrice + fee - (order.discountAmount || 0);
          const orderRate = (order as { purchaseRate?: number }).purchaseRate;
          const currency = pmCurrencyMap[pm];
          const rate = orderRate ?? (currency ? rateMap[currency] : null);
          const bsAmount = (order as { purchaseAmountBs?: number }).purchaseAmountBs ?? (rate != null ? finalPrice * rate : 0);
          if (cells[s] && cells[s][pm]) {
            cells[s][pm].count += 1;
            cells[s][pm].amount += finalPrice;
            cells[s][pm].amountBs += bsAmount;
          } else if (cells[s]) {
            cells[s][pm] = cells[s][pm] || { count: 0, amount: 0, amountBs: 0 };
            cells[s][pm].count += 1;
            cells[s][pm].amount += finalPrice;
            cells[s][pm].amountBs += bsAmount;
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
                  ${(tt.price + (tt.price * ((tt as { feePercent?: number }).feePercent ?? 0)) / 100 + ((tt as { feeFixed?: number }).feeFixed ?? 0)).toFixed(2)} {t("admin.perTicket")} &middot;{" "}
                  {t("admin.sold", { sold: statusTotals[0].count + statusTotals[1].count, total: tt.quantity })}
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
                            <span className="text-muted text-xs"> {t("common.quantity")}</span>
                          </td>
                        );
                      }),
                    )}
                  </tr>
                  {/* Amount row */}
                  <tr className="border-b border-border/50">
                    {statuses.map((s) =>
                      allPmNames.map((pm) => {
                        const cell = cells[s.key][pm] || { count: 0, amount: 0, amountBs: 0 };
                        return (
                          <td
                            key={`${s.key}-${pm}-amount`}
                            className="text-center py-2 px-2 text-muted"
                          >
                            ${cell.amount.toFixed(2)}
                            {cell.amountBs > 0 && (
                              <div className="text-xs text-muted">
                                {cell.amountBs.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs
                              </div>
                            )}
                          </td>
                        );
                      }),
                    )}
                  </tr>
                </tbody>
                {/* Totals per status */}
                <tfoot>
                  <tr className="border-t border-border">
                    {statuses.map((st) => {
                      const bsAmount = allPmNames.reduce((sum, pm) => {
                        const cell = cells[st.key][pm] || { count: 0, amount: 0, amountBs: 0 };
                        return sum + cell.amountBs;
                      }, 0);
                      return (
                        <td
                          key={st.key}
                          colSpan={allPmNames.length}
                          className={`text-center py-2.5 px-2 font-semibold ${st.color}`}
                        >
                          {t("common.total")} {st.label}: ${statusTotals.find((tt) => tt.key === st.key)!.amount.toFixed(2)}
                          {bsAmount > 0 && (
                            <span className="ml-2 text-sm font-normal text-accent-light">
                              / {bsAmount.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs
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
          { key: "approved", label: t("common.approved"), color: "text-success", headerBg: "bg-success/10 border-success/30" },
          { key: "pending", label: t("common.pending"), color: "text-warning", headerBg: "bg-warning/10 border-warning/30" },
          { key: "rejected", label: t("common.rejected"), color: "text-danger", headerBg: "bg-danger/10 border-danger/30" },
        ];

        const cells: Record<string, Record<string, { count: number; amount: number; amountBs: number }>> = {};
        for (const s of statuses) {
          cells[s.key] = {};
          for (const pm of allPmNames) {
            cells[s.key][pm] = { count: 0, amount: 0, amountBs: 0 };
          }
        }

        for (const order of allOrders) {
          const s = order.status;
          const pm = order.paymentMethod;
          const finalPrice = order.ticketTypePrice - (order.discountAmount || 0);
          const currency = pmCurrencyMap[pm];
          const rate = order.purchaseRate ?? (currency ? rateMap[currency] : null);
          const bsAmount = order.purchaseAmountBs ?? (rate != null ? finalPrice * rate : 0);
          if (cells[s]?.[pm]) {
            cells[s][pm].count += 1;
            cells[s][pm].amount += finalPrice;
            cells[s][pm].amountBs += bsAmount;
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
            <h2 className="text-lg font-semibold mb-1">{t("admin.combinedTotals")}</h2>
            <p className="text-sm text-muted mb-4">
              {t("admin.allTicketTypes")} &middot; {t("admin.soldTotal", { count: statusTotals[0].count + statusTotals[1].count })}
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
                            <span className="text-muted text-xs"> {t("common.quantity")}</span>
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
                            {cell.amountBs > 0 && (
                              <div className="text-xs text-muted">
                                {cell.amountBs.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs
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
                    {statuses.map((st) => {
                      const bsAmount = allPmNames.reduce((sum, pm) => {
                        const cell = cells[st.key][pm];
                        return sum + cell.amountBs;
                      }, 0);
                      return (
                        <td
                          key={st.key}
                          colSpan={allPmNames.length}
                          className={`text-center py-2.5 px-2 font-semibold ${st.color}`}
                        >
                          {t("common.total")} {st.label}: ${statusTotals.find((tt) => tt.key === st.key)!.amount.toFixed(2)}
                          {bsAmount > 0 && (
                            <span className="ml-2 text-sm font-normal text-accent-light">
                              / {bsAmount.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs
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
      })()}

      {/* Scanned Codes */}
      {(() => {
        const scannedOrders = allOrders
          .filter((o) => o.visited)
          .sort((a, b) => b.createdAt - a.createdAt);

        const filteredScanned = scannedSearch
          ? scannedOrders.filter((o) => {
              const q = scannedSearch.toLowerCase();
              return [o.firstName, o.lastName, `${o.firstName} ${o.lastName}`, o.email, o.cedula, o.orderNumber, o.ticketTypeName]
                .some((f) => f && f.toLowerCase().includes(q));
            })
          : scannedOrders;

        return (
          <div className="bg-surface border border-border rounded-xl p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold">{t("admin.scannedCodes")}</h2>
                <p className="text-sm text-muted">
                  {t("admin.scannedOf", { scanned: scannedOrders.length, total: allOrders.filter((o) => o.status === "approved").length })}
                </p>
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
                <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
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
                {filteredScanned.map((order) => (
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
        pmCurrencyMap={pmCurrencyMap}
        rateMap={rateMap}
      />

      {/* Order List */}
      <div className="bg-surface border border-border rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">{t("admin.orderList")}</h2>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-3 py-1.5 bg-accent hover:bg-accent-dark text-white rounded-lg text-xs font-medium transition-colors shadow-lg shadow-accent/20"
            >
              {t("admin.createOrder")}
            </button>
            <button
              onClick={() => setShowImportModal(true)}
              className="px-3 py-1.5 border border-border hover:border-accent/50 text-muted hover:text-accent-light rounded-lg text-xs font-medium transition-colors"
            >
              {t("admin.importCsv")}
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
                  {t("admin.allTypes")}
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
            placeholder={t("admin.searchPlaceholder")}
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
            {t("admin.noOrders", { filter: filter === "all" ? "" : filter, search: searchQuery ? t("admin.matching", { query: searchQuery }) : "" })}
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
                      {order.orderNumber || "---"}
                    </span>
                    <StatusBadge status={order.status} />
                    {order.visited && (
                      <span className="text-xs text-success">
                        {"✓"} {t("admin.visited")}
                      </span>
                    )}
                    <span className="text-xs text-muted">
                      {order.ticketTypeName}
                    </span>
                  </div>
                  <p className="font-medium text-sm">{order.firstName} {order.lastName}</p>
                  {editingEmailOrderId === order.id ? (
                    <EmailInlineEdit
                      currentEmail={order.email}
                      onSave={(newEmail) => {
                        db.transact(db.tx.orders[order.id].update({ email: newEmail }));
                        setEditingEmailOrderId(null);
                      }}
                      onCancel={() => setEditingEmailOrderId(null)}
                    />
                  ) : (
                    <p
                      className="text-xs text-muted cursor-pointer hover:text-accent-light transition-colors group inline-flex items-center gap-1"
                      onClick={() => setEditingEmailOrderId(order.id)}
                      title="Click to edit email"
                    >
                      {order.email}
                      <svg className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </p>
                  )}
                  <p className="text-xs text-muted">{t("common.cedula")}: {order.cedula}</p>
                  <p className="text-xs text-muted">{t("admin.paymentMethodLabel")}: {order.paymentMethod}</p>
                  {order.promoter && (
                    <p className="text-xs text-muted">{t("ticket.promoter")}: {order.promoter}</p>
                  )}
                  {order.customFieldValues && (() => {
                    try {
                      const vals = JSON.parse(order.customFieldValues);
                      return Object.entries(vals).map(([key, val]) => (
                        <p key={key} className="text-xs text-muted">{key}: {String(val)}</p>
                      ));
                    } catch { return null; }
                  })()}
                  <p className="text-xs text-muted mt-0.5">
                    ${order.ticketTypePrice.toFixed(2)}
                    {order.couponCode && (
                      <span className="text-success">
                        {" "}({t("admin.coupon")}: {order.couponCode}, -${(order.discountAmount || 0).toFixed(2)})
                      </span>
                    )}
                    {(() => {
                      const currency = pmCurrencyMap[order.paymentMethod];
                      const rate = order.purchaseRate ?? (currency ? rateMap[currency] : null);
                      const bsAmt = order.purchaseAmountBs ?? (rate != null ? (order.ticketTypePrice - (order.discountAmount || 0)) * rate : null);
                      return bsAmt != null ? (
                        <span className="text-accent-light font-medium">
                          {" / "}{bsAmt.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs
                        </span>
                      ) : null;
                    })()}
                    {" "}&middot;{" "}
                    {new Date(order.createdAt).toLocaleString()}
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {order.paymentProofPath === "admin-created" ? (
                    <span className="px-3 py-1.5 text-xs border border-accent/30 bg-accent/10 text-accent-light rounded-lg font-medium">
                      {t("admin.adminLabel")}
                    </span>
                  ) : order.paymentProofPath ? (
                    <button
                      onClick={() => viewProof(order.paymentProofPath!)}
                      className="px-3 py-1.5 text-xs border border-border rounded-lg hover:border-accent/50 transition-colors"
                    >
                      {t("admin.proof")}
                    </button>
                  ) : null}
                  {order.proofReferenceNumber && (
                    <span className="px-3 py-1.5 text-xs border border-warning/30 bg-warning/10 text-warning rounded-lg font-medium truncate max-w-[140px]" title={`${t("admin.referenceNumber")}: ${order.proofReferenceNumber}`}>
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
                          {t("admin.coupon")}
                        </button>
                      )}
                      <button
                        onClick={() => approve(order.id)}
                        className="px-3 py-1.5 text-xs bg-success/10 text-success border border-success/30 rounded-lg hover:bg-success/20 transition-colors font-medium"
                      >
                        {t("admin.approve")}
                      </button>
                      <button
                        onClick={() => reject(order.id)}
                        className="px-3 py-1.5 text-xs bg-danger/10 text-danger border border-danger/30 rounded-lg hover:bg-danger/20 transition-colors font-medium"
                      >
                        {t("admin.reject")}
                      </button>
                    </>
                  )}
                  {order.status === "approved" && (
                    <button
                      onClick={() => cancel(order.id)}
                      className="px-3 py-1.5 text-xs bg-muted/10 text-muted border border-muted/30 rounded-lg hover:bg-muted/20 transition-colors font-medium"
                    >
                      {t("common.cancel")}
                    </button>
                  )}
                  {(order.status === "pending" || order.status === "approved") && (
                    <div className="relative">
                      <button
                        onClick={() => {
                          if (resendOrderId === order.id) {
                            setResendOrderId(null);
                          } else {
                            setResendOrderId(order.id);
                            setResendType(order.status === "approved" ? "ticket" : "confirmation");
                          }
                        }}
                        disabled={resendingOrderId === order.id}
                        className="px-3 py-1.5 text-xs border border-accent/30 text-accent-light rounded-lg hover:bg-accent/10 transition-colors font-medium disabled:opacity-50"
                      >
                        {resendingOrderId === order.id ? t("admin.sending") : t("admin.resend")}
                      </button>
                      {resendOrderId === order.id && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setResendOrderId(null)} />
                          <div className="absolute right-0 top-full mt-1 z-50 bg-surface border border-border rounded-lg shadow-xl p-3 w-56">
                            <p className="text-xs font-semibold mb-2">{t("admin.emailType")}</p>
                            <label className="flex items-center gap-2 cursor-pointer mb-1.5">
                              <input
                                type="radio"
                                name={`resend-${order.id}`}
                                checked={resendType === "confirmation"}
                                onChange={() => setResendType("confirmation")}
                                className="accent-accent"
                              />
                              <span className="text-xs">{t("admin.confirmationEmail")}</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer mb-3">
                              <input
                                type="radio"
                                name={`resend-${order.id}`}
                                checked={resendType === "ticket"}
                                onChange={() => setResendType("ticket")}
                                className="accent-accent"
                              />
                              <span className="text-xs">{t("admin.ticketEmailQR")}</span>
                            </label>
                            <button
                              onClick={async () => {
                                setResendOrderId(null);
                                setResendingOrderId(order.id);
                                try {
                                  const res = resendType === "ticket"
                                    ? await sendTicketEmail(order.id, refreshToken)
                                    : await sendConfirmationEmail(order.id, refreshToken);
                                  if (res.success) {
                                    alert(t("admin.emailSent"));
                                  } else {
                                    alert(t("admin.emailSentFail", { error: res.error || "Unknown error" }));
                                  }
                                } catch (err) {
                                  console.error("Resend failed:", err);
                                  alert(t("admin.emailSendError"));
                                } finally {
                                  setResendingOrderId(null);
                                }
                              }}
                              className="w-full py-1.5 bg-accent hover:bg-accent-dark text-white rounded-lg text-xs font-medium transition-colors"
                            >
                              {t("admin.sendButton")}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  <a
                    href={`/ticket/${order.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 text-xs text-muted border border-border rounded-lg hover:border-accent/50 transition-colors"
                  >
                    {t("admin.ticket")}
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
          refreshToken={refreshToken}
          pmCurrencyMap={pmCurrencyMap}
          rateMap={rateMap}
        />
      )}

      {/* Import CSV modal */}
      {showImportModal && (
        <ImportCsvModal
          concert={concert}
          onClose={() => setShowImportModal(false)}
          refreshToken={refreshToken}
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
              <h3 className="font-semibold">{t("admin.paymentProof")}</h3>
              <button
                onClick={() => setPreviewUrl(null)}
                className="text-muted hover:text-foreground transition-colors"
              >
                {"✕"}
              </button>
            </div>
            {previewUrl.startsWith("ref:") ? (
              <div className="bg-background border border-border rounded-lg p-6 text-center">
                <p className="text-sm text-muted mb-1">{t("admin.referenceNumber")}</p>
                <p className="text-xl font-mono font-bold">{previewUrl.slice(4)}</p>
              </div>
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={previewUrl}
                alt={t("admin.paymentProof")}
                className="max-w-full rounded-lg"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
