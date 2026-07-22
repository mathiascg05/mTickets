"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { db } from "@/lib/db";
import { useLanguage } from "@/lib/LanguageContext";
import { QRCodeSVG } from "qrcode.react";

async function uploadWithRetry(path: string, file: File) {
  try {
    await db.storage.upload(path, file);
  } catch (err) {
    const isIdbClosing =
      err instanceof Error &&
      err.name === "InvalidStateError" &&
      err.message.includes("IDBDatabase");
    if (!isIdbClosing) throw err;
    await new Promise((r) => setTimeout(r, 500));
    await db.storage.upload(path, file);
  }
}

type PaymentMethod = {
  id: string;
  type?: string;
  name: string;
  instructions?: string;
  convertCurrency?: string;
  zelleEmail?: string;
  zelleName?: string;
  pmCedula?: string;
  pmPhone?: string;
  pmBank?: string;
};
type Ticket = {
  orderId: string;
  seq: number;
  orderNumber?: string;
  ticketTypeName: string;
  visited: boolean;
  delivered: boolean;
  viewToken: string;
};
type AllotmentResponse = {
  allotment: {
    id: string;
    schoolName: string;
    status: string;
    totalPrice: number;
    ticketCount: number;
    contactEmail?: string;
    proofReferenceNumber?: string;
    hasProof: boolean;
    paymentMethodId?: string;
  };
  concert: {
    name: string;
    date: string;
    venue?: string;
    flyerUrl?: string;
    logoUrl?: string;
    primaryColor?: string;
  } | null;
  items: { quantity: number; ticketTypeName: string }[];
  paymentMethods: PaymentMethod[];
  tickets: Ticket[];
};

function pad(n: number): string {
  return String(n).padStart(3, "0");
}

export default function AllotmentManagePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const { t } = useLanguage();

  const [data, setData] = useState<AllotmentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Proof form
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/allotments/by-token/${token}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "ERROR");
      setLoading(false);
      return;
    }
    const json = (await res.json()) as AllotmentResponse;
    setData(json);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while awaiting approval.
  const status = data?.allotment.status;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (status === "approved" || status === "rejected" || status === "cancelled") {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(load, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [status, load]);

  async function handleSubmitProof(e: React.FormEvent) {
    e.preventDefault();
    if (!file && !referenceNumber) return;
    setSubmitting(true);
    try {
      let paymentProofPath: string | undefined;
      if (file) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        paymentProofPath = `payment-proofs/${Date.now()}-${safeName}`;
        await uploadWithRetry(paymentProofPath, file);
      }
      const res = await fetch(`/api/allotments/by-token/${token}/proof`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentMethodId: paymentMethodId || undefined,
          paymentProofPath,
          proofReferenceNumber: referenceNumber || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "ERROR");
        return;
      }
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleDelivered(orderId: string, delivered: boolean) {
    // Optimistic
    setData((prev) =>
      prev
        ? {
            ...prev,
            tickets: prev.tickets.map((tk) =>
              tk.orderId === orderId ? { ...tk, delivered } : tk,
            ),
          }
        : prev,
    );
    await fetch(`/api/allotments/by-token/${token}/deliver`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, delivered }),
    }).catch(() => {});
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted">{t("common.loading")}</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 text-center">
        <div className="text-danger">
          {error === "TOKEN_EXPIRED"
            ? t("allotment.expired")
            : error === "TOKEN_REVOKED"
              ? t("allotment.revoked")
              : t("allotment.notFound")}
        </div>
      </div>
    );
  }

  const { allotment, concert, items, paymentMethods, tickets } = data;
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="min-h-screen">
      <header className="bg-accent text-white sticky top-0 z-10 shadow-md">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <span className="text-xl font-bold tracking-wide">
            ma<span className="text-white/60">Tickets</span>
          </span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div className="bg-surface border border-border rounded-xl p-6">
          <h1 className="text-2xl font-bold">{concert?.name}</h1>
          <p className="text-muted">{concert?.venue}</p>
          <div className="mt-4 space-y-1 text-sm">
            <div className="font-medium">{allotment.schoolName}</div>
            <div>
              {items.map((it) => `${it.quantity}× ${it.ticketTypeName}`).join(" · ")}
            </div>
            <div className="text-lg font-bold mt-2">
              {t("allotment.total")}: ${allotment.totalPrice}
            </div>
          </div>
        </div>

        {/* Payment / status */}
        {allotment.status === "pending" && (
          <form
            onSubmit={handleSubmitProof}
            className="bg-surface border border-border rounded-xl p-6 space-y-4"
          >
            <h2 className="text-lg font-semibold">{t("allotment.payTitle")}</h2>
            {paymentMethods.length > 0 && (
              <div>
                <label className="block text-sm font-medium mb-1">
                  {t("allotment.paymentMethod")}
                </label>
                <select
                  value={paymentMethodId}
                  onChange={(e) => setPaymentMethodId(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                >
                  <option value="">—</option>
                  {paymentMethods.map((pm) => (
                    <option key={pm.id} value={pm.id}>
                      {pm.name}
                    </option>
                  ))}
                </select>
                {paymentMethodId && (
                  <div className="mt-2 text-sm text-muted whitespace-pre-wrap">
                    {(() => {
                      const pm = paymentMethods.find((m) => m.id === paymentMethodId);
                      if (!pm) return null;
                      return (
                        <>
                          {pm.instructions && <p>{pm.instructions}</p>}
                          {pm.zelleEmail && <p>Zelle: {pm.zelleEmail} ({pm.zelleName})</p>}
                          {pm.pmPhone && (
                            <p>
                              {pm.pmBank} · {pm.pmCedula} · {pm.pmPhone}
                            </p>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium mb-1">
                {t("allotment.reference")}
              </label>
              <input
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                {t("allotment.proof")}
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="w-full text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={submitting || (!file && !referenceNumber)}
              className="w-full py-2.5 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium disabled:opacity-50"
            >
              {submitting ? t("common.loading") : t("allotment.submitPayment")}
            </button>
          </form>
        )}

        {allotment.status === "submitted" && (
          <div className="bg-surface border border-border rounded-xl p-6 text-center">
            <p className="font-medium">{t("allotment.underReview")}</p>
            <p className="text-sm text-muted mt-1">{t("allotment.underReviewHint")}</p>
          </div>
        )}

        {(allotment.status === "rejected" || allotment.status === "cancelled") && (
          <div className="bg-surface border border-border rounded-xl p-6 text-center">
            <p className="font-medium text-danger">{t("allotment.rejected")}</p>
          </div>
        )}

        {/* Tickets */}
        {allotment.status === "approved" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {t("allotment.yourTickets")} ({tickets.length})
              </h2>
              <a
                href={`/api/allotments/${allotment.id}/pdf?token=${token}`}
                className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium"
              >
                {t("allotment.downloadPdf")}
              </a>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              {tickets.map((tk) => {
                const url = `${origin}/ticket/${tk.orderId}?vt=${tk.viewToken}`;
                const wa = `https://wa.me/?text=${encodeURIComponent(url)}`;
                return (
                  <div
                    key={tk.orderId}
                    className="bg-surface border border-border rounded-xl p-4 flex flex-col items-center text-center"
                  >
                    <div className="text-sm font-medium">
                      #{pad(tk.seq)} · {tk.ticketTypeName}
                    </div>
                    <div className="my-3 bg-white p-2 rounded-lg">
                      <QRCodeSVG value={url} size={140} />
                    </div>
                    {tk.visited && (
                      <div className="text-xs text-danger mb-1">
                        {t("allotment.alreadyScanned")}
                      </div>
                    )}
                    <div className="flex gap-2 w-full">
                      <a
                        href={wa}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 py-1.5 border border-border rounded-lg text-xs hover:bg-background"
                      >
                        {t("allotment.shareWhatsApp")}
                      </a>
                    </div>
                    <label className="mt-2 flex items-center gap-2 text-xs text-muted">
                      <input
                        type="checkbox"
                        checked={tk.delivered}
                        onChange={(e) => toggleDelivered(tk.orderId, e.target.checked)}
                      />
                      {t("allotment.delivered")}
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
