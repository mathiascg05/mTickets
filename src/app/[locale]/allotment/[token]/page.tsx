"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { db } from "@/lib/db";
import { useLanguage, LanguageToggle } from "@/lib/LanguageContext";
import EventTheme from "@/components/EventTheme";
import { QRCodeCanvas } from "qrcode.react";
import Link from "next/link";
import { toast } from "sonner";
import { parseBank, formatBank } from "@/lib/pago-movil";
import { dateLocale } from "@/lib/i18n";

// Métodos pagados en bolívares que muestran conversión Bs (Pago Móvil, Punto de Venta).
const supportsConversion = (type?: string) =>
  type === "pago_movil" || type === "punto_de_venta";

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
  customRate?: number;
  showConversionDetail?: boolean;
  requireReferenceNumber?: boolean;
  requireScreenshot?: boolean;
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
    themeColors?: string;
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
  const { t, lang } = useLanguage();

  const [data, setData] = useState<AllotmentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Proof form
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // BCV rate per currency (fetched when a converting method is selected).
  const [rateByCurrency, setRateByCurrency] = useState<Record<string, number>>({});
  const [rateLoading, setRateLoading] = useState(false);
  // QR canvas containers per ticket, to read pixels synchronously when sharing.
  const qrBoxRefs = useRef<Map<string, HTMLDivElement>>(new Map());

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

  // Fetch the BCV rate when a currency-converting method is selected (and the
  // organizer didn't set a fixed customRate). The endpoint returns dolarapi's
  // raw JSON with `promedio`; no InstantDB session needed on this token page.
  const selectedPm = (data?.paymentMethods || []).find((m) => m.id === paymentMethodId);
  // Solo los métodos pagados en bolívares (Pago Móvil, Punto de Venta) muestran
  // conversión Bs — Zelle/Efectivo nunca, aunque tengan convertCurrency mal configurado.
  const convertCurrency =
    supportsConversion(selectedPm?.type) ? selectedPm?.convertCurrency : undefined;
  useEffect(() => {
    if (!convertCurrency || selectedPm?.customRate || rateByCurrency[convertCurrency] != null) {
      return;
    }
    let cancelled = false;
    setRateLoading(true);
    fetch(`/api/exchange-rates?currency=${encodeURIComponent(convertCurrency)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.promedio) {
          setRateByCurrency((prev) => ({ ...prev, [convertCurrency]: d.promedio }));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setRateLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [convertCurrency, selectedPm?.customRate, rateByCurrency]);

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
      const pm = (data?.paymentMethods || []).find((m) => m.id === paymentMethodId);
      const cur = supportsConversion(pm?.type) ? pm?.convertCurrency : undefined;
      const rate = pm?.customRate ?? (cur ? rateByCurrency[cur] : undefined);
      const amountBs =
        rate != null && data
          ? Math.round(data.allotment.totalPrice * rate * 100) / 100
          : undefined;
      const res = await fetch(`/api/allotments/by-token/${token}/proof`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentMethodId: paymentMethodId || undefined,
          paymentProofPath,
          proofReferenceNumber: referenceNumber || undefined,
          ...(rate != null
            ? {
                purchaseRate: rate,
                purchaseRateCurrency: pm?.customRate ? "USD" : cur,
                purchaseAmountBs: amountBs,
              }
            : {}),
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

  // Compose a shareable PNG (QR + ticket number + type + event) on an offscreen
  // canvas — fully synchronous, so it works inside the click gesture that iOS
  // Safari requires for navigator.share().
  function composeTicketImage(tk: Ticket): File | null {
    const box = qrBoxRefs.current.get(tk.orderId);
    const qr = box?.querySelector("canvas");
    if (!qr) return null;
    const W = 620;
    const H = 760;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    // Event name (top, muted).
    if (data?.concert?.name) {
      ctx.fillStyle = "#7a8599";
      ctx.font = "26px -apple-system, Helvetica, Arial, sans-serif";
      ctx.fillText(data.concert.name, W / 2, 52);
    }
    // QR centered.
    const qrSize = 460;
    ctx.drawImage(qr, (W - qrSize) / 2, 90, qrSize, qrSize);
    // Ticket number (bold) + type at the bottom, for reference.
    ctx.fillStyle = "#1a2b4a";
    ctx.font = "bold 60px -apple-system, Helvetica, Arial, sans-serif";
    ctx.fillText(`#${pad(tk.seq)}`, W / 2, 90 + qrSize + 70);
    if (tk.ticketTypeName) {
      ctx.fillStyle = "#7a8599";
      ctx.font = "30px -apple-system, Helvetica, Arial, sans-serif";
      ctx.fillText(tk.ticketTypeName, W / 2, 90 + qrSize + 112);
    }
    const dataUrl = c.toDataURL("image/png");
    const [, b64] = dataUrl.split(",");
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], `entrada-${pad(tk.seq)}.png`, { type: "image/png" });
  }

  // Share a single ticket the easiest way for the person distributing: the OS
  // native share sheet with the labeled QR image (WhatsApp/Telegram/Mail/…).
  // Everything up to navigator.share() is synchronous to preserve the iOS
  // Safari user-activation requirement.
  async function shareTicket(tk: Ticket) {
    const ticketUrl = `${window.location.origin}/ticket/${tk.orderId}?vt=${tk.viewToken}`;
    const label = `#${pad(tk.seq)} · ${tk.ticketTypeName}`;
    const nav = navigator as Navigator & {
      canShare?: (data?: unknown) => boolean;
      share?: (data?: unknown) => Promise<void>;
    };
    try {
      if (nav.share) {
        const file = composeTicketImage(tk);
        if (file && nav.canShare && nav.canShare({ files: [file] })) {
          await nav.share({ files: [file], title: label, text: ticketUrl });
          return;
        }
        // No file sharing — share the link (still native, choose any method).
        await nav.share({ title: label, text: ticketUrl, url: ticketUrl });
        return;
      }
      // Desktop fallback: copy link + open WhatsApp Web.
      try {
        await navigator.clipboard.writeText(ticketUrl);
        toast.success(t("allotment.linkCopied"));
      } catch {
        /* ignore clipboard errors */
      }
      window.open(
        `https://wa.me/?text=${encodeURIComponent(ticketUrl)}`,
        "_blank",
        "noopener,noreferrer",
      );
    } catch (err) {
      // User cancelled the share sheet — not an error.
      if (err instanceof DOMException && err.name === "AbortError") return;
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
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted">{t("common.loading")}</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="bg-surface border border-border rounded-2xl p-8 text-center max-w-md">
          <p className="text-danger font-medium">
            {error === "TOKEN_EXPIRED"
              ? t("allotment.expired")
              : error === "TOKEN_REVOKED"
                ? t("allotment.revoked")
                : t("allotment.notFound")}
          </p>
        </div>
      </div>
    );
  }

  const { allotment, concert, items, paymentMethods, tickets } = data;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const inputClass =
    "w-full px-4 py-2.5 bg-field border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors";
  const cardClass = "bg-surface border border-border rounded-2xl p-6 sm:p-8";

  // Payment method + Bs conversion (mirrors the buyer purchase page).
  const pmSelected = paymentMethods.find((m) => m.id === paymentMethodId);
  const pmCurrency =
    supportsConversion(pmSelected?.type) ? pmSelected?.convertCurrency : undefined;
  const rateValue = pmSelected?.customRate ?? (pmCurrency ? rateByCurrency[pmCurrency] : undefined);
  const totalBs = rateValue != null ? Math.round(allotment.totalPrice * rateValue * 100) / 100 : null;
  const bsFmt = (n: number) =>
    n.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pmCompact = supportsConversion(pmSelected?.type) && pmSelected?.showConversionDetail === false;
  const needsScreenshot = !!pmSelected && pmSelected.requireScreenshot !== false;
  const needsReference = !!pmSelected && pmSelected.requireReferenceNumber === true;
  const canSubmitProof =
    !!pmSelected &&
    (!needsScreenshot || !!file) &&
    (!needsReference || referenceNumber.trim().length > 0) &&
    (!!file || referenceNumber.trim().length > 0);

  return (
    <EventTheme concert={{ primaryColor: concert?.primaryColor, themeColors: concert?.themeColors }}>
      <header className="bg-accent text-white sticky top-0 z-10 shadow-md">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-xl font-bold tracking-wide text-white">
              ma<span className="text-white/60">Tickets</span>
            </Link>
            {concert?.logoUrl && (
              <>
                <span className="text-white/30">|</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={concert.logoUrl} alt="" className="h-9 w-auto object-contain" />
              </>
            )}
          </div>
          <LanguageToggle className="border-white/30 text-white/80 hover:text-white" />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {concert?.flyerUrl && (
          <div className="rounded-2xl overflow-hidden border border-border shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={concert.flyerUrl} alt={concert.name} className="w-full object-cover" />
          </div>
        )}

        <div className={cardClass}>
          <h1 className="text-2xl font-bold">{concert?.name}</h1>
          {concert?.venue && <p className="text-muted mt-1">{concert.venue}</p>}
          <div className="mt-4 space-y-1.5 text-sm">
            <div className="font-semibold">{allotment.schoolName}</div>
            <div className="text-muted">
              {items.map((it) => `${it.quantity}× ${it.ticketTypeName}`).join(" · ")}
            </div>
            <div className="text-xl font-bold text-accent pt-1">
              {t("allotment.total")}: ${allotment.totalPrice}
            </div>
          </div>
        </div>

        {/* Payment / status */}
        {allotment.status === "pending" && (
          <form onSubmit={handleSubmitProof} className={`${cardClass} space-y-4`}>
            <h2 className="text-lg font-semibold">{t("allotment.payTitle")}</h2>
            {paymentMethods.length > 0 && (
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  {t("allotment.paymentMethod")}
                </label>
                <select
                  value={paymentMethodId}
                  onChange={(e) => setPaymentMethodId(e.target.value)}
                  className={inputClass}
                >
                  <option value="">—</option>
                  {paymentMethods.map((pm) => (
                    <option key={pm.id} value={pm.id}>
                      {pm.type === "pago_movil" ? "Pago Móvil" : pm.name}
                    </option>
                  ))}
                </select>
                {pmSelected && (
                  <div className="mt-3 text-sm bg-accent/5 border border-accent/20 rounded-xl p-4 space-y-1">
                    {pmSelected.type === "zelle" &&
                      (pmSelected.zelleName || pmSelected.zelleEmail) && (
                        <>
                          {pmSelected.zelleName && (
                            <p>
                              <span className="text-muted">{t("checkout.zelleNameLabel")}</span>{" "}
                              {pmSelected.zelleName}
                            </p>
                          )}
                          {pmSelected.zelleEmail && (
                            <p className="select-all">
                              <span className="text-muted">{t("checkout.zelleEmailLabel")}</span>{" "}
                              {pmSelected.zelleEmail}
                            </p>
                          )}
                        </>
                      )}
                    {pmSelected.type === "pago_movil" && (
                      <>
                        {pmSelected.pmCedula && (
                          <p className="select-all">{pmSelected.pmCedula}</p>
                        )}
                        {pmSelected.pmPhone && (
                          <p className="select-all">{pmSelected.pmPhone}</p>
                        )}
                        {pmSelected.pmBank && (
                          <p>{formatBank(parseBank(pmSelected.pmBank))}</p>
                        )}
                      </>
                    )}
                    {pmSelected.instructions && (
                      <p className="whitespace-pre-wrap text-muted">{pmSelected.instructions}</p>
                    )}
                    {/* Bs conversion */}
                    {pmCurrency &&
                      (rateLoading && rateValue == null ? (
                        <p className="text-muted pt-1">{t("checkout.loadingRate")}</p>
                      ) : totalBs != null ? (
                        <div className="pt-2 mt-1 border-t border-accent/20">
                          <p className="font-semibold text-accent">
                            {pmCompact
                              ? t("checkout.totalBsOnly", { bs: bsFmt(totalBs) })
                              : t("checkout.totalBs", {
                                  symbol: "$",
                                  total: allotment.totalPrice.toFixed(2),
                                  bs: bsFmt(totalBs),
                                })}
                          </p>
                          {!pmCompact && (
                            <p className="text-xs text-muted mt-0.5">
                              {pmSelected.customRate
                                ? t("checkout.customRate", { rate: rateValue!.toFixed(2) })
                                : t("checkout.bcvRate", {
                                    rate: rateValue!.toFixed(2),
                                    currency: pmCurrency,
                                    updated: new Date().toLocaleString(dateLocale(lang)),
                                  })}
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="text-muted pt-1">{t("checkout.rateError")}</p>
                      ))}
                  </div>
                )}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium mb-1.5">
                {t("allotment.reference")}
                {needsReference && <span className="text-danger"> *</span>}
              </label>
              <input
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">
                {t("allotment.proof")}
                {needsScreenshot && <span className="text-danger"> *</span>}
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="w-full text-sm file:mr-4 file:px-3 file:py-1.5 file:rounded-md file:bg-field file:border file:border-border file:font-medium file:text-foreground"
              />
            </div>
            <button
              type="submit"
              disabled={submitting || !canSubmitProof}
              className="w-full py-3 bg-accent hover:bg-accent-dark disabled:opacity-50 text-white rounded-lg font-semibold transition-colors shadow-lg shadow-accent/20"
            >
              {submitting ? t("common.loading") : t("allotment.submitPayment")}
            </button>
          </form>
        )}

        {allotment.status === "submitted" && (
          <div className={`${cardClass} text-center`}>
            <p className="font-semibold">{t("allotment.underReview")}</p>
            <p className="text-sm text-muted mt-1">{t("allotment.underReviewHint")}</p>
          </div>
        )}

        {(allotment.status === "rejected" || allotment.status === "cancelled") && (
          <div className={`${cardClass} text-center`}>
            <p className="font-semibold text-danger">{t("allotment.rejected")}</p>
          </div>
        )}

        {/* Tickets */}
        {allotment.status === "approved" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">
                {t("allotment.yourTickets")} ({tickets.length})
              </h2>
              <a
                href={`/api/allotments/${allotment.id}/pdf?token=${token}`}
                className="px-5 py-2.5 bg-accent hover:bg-accent-dark text-white rounded-lg text-sm font-semibold transition-colors shadow-lg shadow-accent/20 whitespace-nowrap"
              >
                {t("allotment.downloadPdf")}
              </a>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              {tickets.map((tk) => {
                const url = `${origin}/ticket/${tk.orderId}?vt=${tk.viewToken}`;
                return (
                  <div
                    key={tk.orderId}
                    className="bg-surface border border-border rounded-2xl p-5 flex flex-col items-center text-center"
                  >
                    <div className="text-sm font-semibold">
                      #{pad(tk.seq)} · {tk.ticketTypeName}
                    </div>
                    <div
                      ref={(el) => {
                        if (el) qrBoxRefs.current.set(tk.orderId, el);
                        else qrBoxRefs.current.delete(tk.orderId);
                      }}
                      className="my-3 inline-block p-3 bg-white rounded-2xl shadow-lg shadow-accent/10"
                    >
                      <QRCodeCanvas
                        value={url}
                        size={512}
                        level="H"
                        fgColor="#1a2b4a"
                        style={{ width: 140, height: 140 }}
                      />
                    </div>
                    {tk.visited && (
                      <div className="text-xs text-danger mb-1 font-medium">
                        {t("allotment.alreadyScanned")}
                      </div>
                    )}
                    <button
                      onClick={() => shareTicket(tk)}
                      className="w-full py-2 bg-accent hover:bg-accent-dark text-white rounded-lg text-xs font-semibold transition-colors shadow-lg shadow-accent/20 inline-flex items-center justify-center gap-1.5"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                      </svg>
                      {t("allotment.share")}
                    </button>
                    <label className="mt-2.5 flex items-center gap-2 text-xs text-muted cursor-pointer">
                      <input
                        type="checkbox"
                        checked={tk.delivered}
                        onChange={(e) => toggleDelivered(tk.orderId, e.target.checked)}
                        className="accent-accent"
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
    </EventTheme>
  );
}
