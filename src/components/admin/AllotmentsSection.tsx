"use client";

import { useState } from "react";
import { db } from "@/lib/db";
import { toast } from "sonner";
import { useLanguage } from "@/lib/LanguageContext";
import { getAvailability, getTodayString } from "@/lib/phases";

type AllotmentTicketType = {
  id: string;
  name: string;
  price: number;
  quantity: number;
  peoplePerTicket?: number;
  phases?: { id: string }[];
  orders: {
    id: string;
    status: string;
    phaseId?: string;
    priceSnapshot?: number;
    allotmentId?: string;
  }[];
  reservations?: { expiresAt: number; quantity?: number }[];
};

type AllotmentItemData = {
  id: string;
  quantity: number;
  status?: string;
  ticketType?: { id: string; name: string }[] | { id: string; name: string };
};
export type AllotmentData = {
  id: string;
  schoolName: string;
  contactEmail?: string;
  contactPhone?: string;
  status: string;
  totalPrice: number;
  ticketCount: number;
  proofReferenceNumber?: string;
  paymentProofPath?: string;
  paymentMethod?: string;
  feeAmountSnapshot?: number;
  inviteSentAt?: number;
  items: AllotmentItemData[];
};

export default function AllotmentsSection({
  concertId,
  ticketTypes,
  allotments,
  allOrders,
}: {
  concertId: string;
  ticketTypes: AllotmentTicketType[];
  allotments: AllotmentData[];
  allOrders: { id: string; status: string; allotmentId?: string; visited?: boolean }[];
}) {
  const { t } = useLanguage();
  const { user } = db.useAuth();
  const [showForm, setShowForm] = useState(false);
  const [schoolName, setSchoolName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [totalPrice, setTotalPrice] = useState("");
  const [qtyByType, setQtyByType] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const token = user?.refresh_token || "";
  const today = getTodayString();

  // Only flat-priced (no-phase) ticket types can carry allotments in v1.
  const eligibleTypes = ticketTypes.filter((tt) => (tt.phases || []).length === 0);

  // Committed quantity per ticket type across active allotments (for the hint).
  const committedByType: Record<string, number> = {};
  for (const a of allotments) {
    if (!["pending", "submitted", "approved"].includes(a.status)) continue;
    for (const it of a.items || []) {
      const tt = Array.isArray(it.ticketType) ? it.ticketType[0] : it.ticketType;
      if (tt) committedByType[tt.id] = (committedByType[tt.id] || 0) + it.quantity;
    }
  }

  function availableFor(tt: AllotmentTicketType): number {
    const activeReservations = (tt.reservations || [])
      .filter((r) => r.expiresAt > Date.now())
      .map((r) => ({
        quantity: r.quantity ?? 1,
        expiresAt: r.expiresAt,
      }));
    const { available } = getAvailability(
      tt,
      [],
      tt.orders,
      today,
      activeReservations,
      committedByType[tt.id] || 0,
    );
    return available;
  }

  function attendanceFor(allotmentId: string): { total: number; visited: number } {
    const rows = allOrders.filter((o) => o.allotmentId === allotmentId);
    return { total: rows.length, visited: rows.filter((o) => o.visited).length };
  }

  async function authFetch(url: string, init?: RequestInit) {
    return fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init?.headers || {}),
      },
    });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const items = eligibleTypes
      .map((tt) => ({ ticketTypeId: tt.id, quantity: parseInt(qtyByType[tt.id] || "0", 10) }))
      .filter((it) => it.quantity > 0);
    if (items.length === 0) {
      toast.error(t("admin.allotments.needItems"));
      return;
    }
    setBusy("create");
    try {
      const res = await authFetch("/api/allotments", {
        method: "POST",
        body: JSON.stringify({
          concertId,
          schoolName,
          contactEmail: contactEmail || undefined,
          contactPhone: contactPhone || undefined,
          totalPrice: parseFloat(totalPrice || "0"),
          items,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(
          data.error === "NOT_ENOUGH_TICKETS"
            ? t("admin.allotments.notEnough")
            : data.error || t("common.error"),
        );
        return;
      }
      toast.success(t("admin.allotments.created"));
      setSchoolName("");
      setContactEmail("");
      setContactPhone("");
      setTotalPrice("");
      setQtyByType({});
      setShowForm(false);
    } finally {
      setBusy(null);
    }
  }

  async function act(allotmentId: string, action: "approve" | "reject" | "cancel") {
    if (action !== "approve" && !confirm(t("admin.allotments.confirmAction"))) return;
    setBusy(allotmentId);
    try {
      const res = await authFetch("/api/allotments/approve", {
        method: "POST",
        body: JSON.stringify({ allotmentId, action }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(
          data.error === "INSUFFICIENT_BALANCE" || data.error === "NO_BALANCE"
            ? t("admin.allotments.insufficientBalance")
            : data.error || t("common.error"),
        );
        return;
      }
      toast.success(t("common.saved"));
    } finally {
      setBusy(null);
    }
  }

  async function sendLink(allotmentId: string) {
    setBusy(allotmentId);
    try {
      const res = await authFetch(`/api/allotments/${allotmentId}/send-link`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok || data.sent === false) {
        toast.error(data.suppressed ? t("admin.allotments.suppressed") : data.error || t("common.error"));
        return;
      }
      toast.success(t("admin.allotments.linkSent"));
    } finally {
      setBusy(null);
    }
  }

  async function openBlob(url: string, download?: string) {
    setBusy(url);
    try {
      const res = await authFetch(url, { method: "GET" });
      if (!res.ok) {
        toast.error(t("common.error"));
        return;
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      if (download) {
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = download;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        window.open(objectUrl, "_blank");
      }
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    } finally {
      setBusy(null);
    }
  }

  const statusLabel = (s: string) => t(`admin.allotments.status.${s}` as never);

  return (
    <div className="bg-surface border border-border rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">{t("admin.allotments.title")}</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-3 py-1.5 bg-accent hover:bg-accent-dark text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-accent/20"
          disabled={eligibleTypes.length === 0}
        >
          {showForm ? t("common.cancel") : t("common.add")}
        </button>
      </div>

      <p className="text-sm text-muted mb-4">{t("admin.allotments.help")}</p>

      {eligibleTypes.length === 0 && (
        <p className="text-sm text-danger mb-4">{t("admin.allotments.noEligibleTypes")}</p>
      )}

      {showForm && eligibleTypes.length > 0 && (
        <form
          onSubmit={handleCreate}
          className="bg-background border border-border rounded-lg p-4 mb-4 space-y-3"
        >
          <div>
            <label className="block text-sm font-medium mb-1">{t("admin.allotments.schoolName")}</label>
            <input
              required
              value={schoolName}
              onChange={(e) => setSchoolName(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">{t("admin.allotments.contactEmail")}</label>
              <input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("admin.allotments.contactPhone")}</label>
              <input
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light text-sm"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium">{t("admin.allotments.composition")}</label>
            {eligibleTypes.map((tt) => (
              <div key={tt.id} className="flex items-center gap-3">
                <span className="flex-1 text-sm">
                  {tt.name}{" "}
                  <span className="text-muted">
                    ({t("admin.allotments.available")}: {availableFor(tt)})
                  </span>
                </span>
                <input
                  type="number"
                  min={0}
                  value={qtyByType[tt.id] || ""}
                  onChange={(e) =>
                    setQtyByType((prev) => ({ ...prev, [tt.id]: e.target.value }))
                  }
                  placeholder="0"
                  className="w-24 px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light text-sm"
                />
              </div>
            ))}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("admin.allotments.totalPrice")}</label>
            <input
              required
              type="number"
              min={0}
              step="0.01"
              value={totalPrice}
              onChange={(e) => setTotalPrice(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={busy === "create"}
            className="w-full py-2 bg-accent hover:bg-accent-dark text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {busy === "create" ? t("common.loading") : t("common.create")}
          </button>
        </form>
      )}

      <div className="space-y-3">
        {allotments.length === 0 && (
          <p className="text-sm text-muted">{t("admin.allotments.empty")}</p>
        )}
        {allotments.map((a) => {
          const att = attendanceFor(a.id);
          const active = ["pending", "submitted"].includes(a.status);
          return (
            <div key={a.id} className="bg-background border border-border rounded-lg p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{a.schoolName}</div>
                  <div className="text-sm text-muted">
                    {a.ticketCount} {t("admin.allotments.tickets")} · ${a.totalPrice}
                  </div>
                  {a.contactEmail && (
                    <div className="text-xs text-muted">{a.contactEmail}</div>
                  )}
                </div>
                <span className="text-xs px-2 py-1 rounded-full bg-surface border border-border whitespace-nowrap">
                  {statusLabel(a.status)}
                </span>
              </div>

              {a.status === "approved" && (
                <div className="text-sm text-muted mt-2">
                  {t("admin.allotments.attendance")}: {att.visited}/{att.total}
                </div>
              )}

              <div className="flex flex-wrap gap-2 mt-3">
                {a.contactEmail && a.status !== "rejected" && a.status !== "cancelled" && (
                  <button
                    onClick={() => sendLink(a.id)}
                    disabled={busy === a.id}
                    className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-surface disabled:opacity-50"
                  >
                    {a.inviteSentAt ? t("admin.allotments.resendLink") : t("admin.allotments.sendLink")}
                  </button>
                )}
                {a.paymentProofPath && (
                  <button
                    onClick={() => openBlob(`/api/allotments/${a.id}/payment-proof`)}
                    disabled={busy === `/api/allotments/${a.id}/payment-proof`}
                    className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-surface disabled:opacity-50"
                  >
                    {t("admin.allotments.viewProof")}
                  </button>
                )}
                {a.status === "submitted" && (
                  <button
                    onClick={() => act(a.id, "approve")}
                    disabled={busy === a.id}
                    className="px-3 py-1.5 text-sm bg-accent text-white rounded-lg hover:bg-accent-dark disabled:opacity-50"
                  >
                    {t("admin.allotments.approve")}
                  </button>
                )}
                {active && (
                  <button
                    onClick={() => act(a.id, "reject")}
                    disabled={busy === a.id}
                    className="px-3 py-1.5 text-sm border border-danger text-danger rounded-lg hover:bg-danger/10 disabled:opacity-50"
                  >
                    {t("admin.allotments.reject")}
                  </button>
                )}
                {a.status === "approved" && (
                  <>
                    <button
                      onClick={() =>
                        openBlob(`/api/allotments/${a.id}/pdf`, `lote-${a.schoolName}.pdf`)
                      }
                      disabled={busy === `/api/allotments/${a.id}/pdf`}
                      className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-surface disabled:opacity-50"
                    >
                      {t("admin.allotments.downloadPdf")}
                    </button>
                    <button
                      onClick={() => act(a.id, "cancel")}
                      disabled={busy === a.id}
                      className="px-3 py-1.5 text-sm border border-danger text-danger rounded-lg hover:bg-danger/10 disabled:opacity-50"
                    >
                      {t("admin.allotments.cancel")}
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
