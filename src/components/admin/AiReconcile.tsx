"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { useLanguage } from "@/lib/LanguageContext";

type PaymentType = "pago_movil" | "zelle";

type Bank = {
  rowIndex: number;
  date: string | null;
  description: string | null;
  reference: string | null;
  amount: number;
};
type OrderRef = {
  orderId: string;
  orderNumber: string;
  name: string;
  reference?: string | null;
  amount: number | null;
};
type Exact = { bank: Bank; orders: OrderRef[] };
type Suggestion = {
  rowIndex: number;
  bank: Bank;
  expectedAmount: number;
  difference: number;
  confidence: "alta" | "media";
  reason: string;
  orders: OrderRef[];
};
type LotMatch = {
  bank: Bank;
  allotmentId: string;
  schoolName: string;
  ticketCount: number;
  expectedAmount: number | null;
  reason: "reference_and_amount" | "reference" | "amount";
};
type Unmatched = { bank: Bank; code: string; expectedAmount: number | null };
type OrphanPurchase = {
  reference: string | null;
  expectedAmount: number | null;
  createdAt: number | null;
  orders: OrderRef[];
};
type AiResult = {
  paymentType: PaymentType;
  currency: "USD" | "BS";
  exactos: Exact[];
  sugerencias: Suggestion[];
  posiblesLotes: LotMatch[];
  sinMatch: Unmatched[];
  ordenesSinMatch: OrphanPurchase[];
  debitosIgnorados?: Bank[];
  counts: Record<string, number>;
  warnings: string[];
};
type ItemState = "idle" | "approving" | "approved" | "dismissed" | "failed";

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_SHEET_CHARS = 1_000_000;
const MAX_IMAGE_SIDE = 2000;
const CLIENT_TIMEOUT_MS = 190_000;
const KNOWN_ERRORS = [
  "AI_DISABLED",
  "AI_TIMEOUT",
  "AI_UNAVAILABLE",
  "AI_BAD_OUTPUT",
  "AI_TRUNCATED",
  "AI_BLOCKED",
  "TOO_MANY_MOVEMENTS",
  "NO_MOVEMENTS",
  "FILE_TOO_LARGE",
  "UNSUPPORTED_FORMAT",
  "RATE_LIMITED",
  "NO_PAYMENT_METHOD",
  "FILE_UNREADABLE",
];

class ClientFileError extends Error {}

/** Reduce una captura a <= 2000px en JPEG para respetar el limite de 4 MB. */
async function downscaleImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ClientFileError("UNSUPPORTED_FORMAT");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.85),
  );
  if (!blob) throw new ClientFileError("UNSUPPORTED_FORMAT");
  return blob;
}

/**
 * Prepara el archivo en el navegador: las hojas se pasan a texto CSV (el server
 * nunca parsea binarios xlsx) y las imagenes se reducen. PDF va tal cual.
 */
async function prepareUpload(file: File): Promise<{ file?: Blob; name?: string; sheetText?: string }> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "csv" || ext === "txt") {
    // Muchos bancos exportan en Windows-1252/Latin-1: si no es UTF-8 valido,
    // se decodifica asi para no romper nombres con ñ/acentos.
    const buf = await file.arrayBuffer();
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    } catch {
      text = new TextDecoder("windows-1252").decode(buf);
    }
    if (text.length > MAX_SHEET_CHARS) throw new ClientFileError("FILE_TOO_LARGE");
    return { sheetText: text };
  }
  if (ext === "xls" || ext === "xlsx") {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const text = wb.SheetNames.map((name) => {
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false });
      return wb.SheetNames.length > 1 ? `# ${name}\n${csv}` : csv;
    }).join("\n\n");
    if (text.length > MAX_SHEET_CHARS) throw new ClientFileError("FILE_TOO_LARGE");
    return { sheetText: text };
  }
  if (ext === "pdf") {
    if (file.size > MAX_UPLOAD_BYTES) throw new ClientFileError("FILE_TOO_LARGE");
    return { file, name: file.name };
  }
  if (["png", "jpg", "jpeg", "webp"].includes(ext)) {
    const blob = await downscaleImage(file);
    if (blob.size > MAX_UPLOAD_BYTES) throw new ClientFileError("FILE_TOO_LARGE");
    return { file: blob, name: "statement.jpg" };
  }
  throw new ClientFileError("UNSUPPORTED_FORMAT");
}

export default function AiReconcile({
  concertId,
  hasPagoMovil,
  hasZelle,
  refreshToken,
  onOpenAllotments,
}: {
  concertId: string;
  hasPagoMovil: boolean;
  hasZelle: boolean;
  refreshToken: string;
  onOpenAllotments: () => void;
}) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<{ enabled: boolean; remainingToday?: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [paymentType, setPaymentType] = useState<PaymentType>(hasPagoMovil ? "pago_movil" : "zelle");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AiResult | null>(null);
  const [exactState, setExactState] = useState<ItemState>("idle");
  const [suggestionState, setSuggestionState] = useState<Record<number, ItemState>>({});
  const [settledIds, setSettledIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch(`/api/reconcile-ai?concertId=${encodeURIComponent(concertId)}`, {
        headers: { Authorization: `Bearer ${refreshToken}` },
      });
      setStatus(r.ok ? await r.json() : { enabled: false });
    } catch {
      setStatus({ enabled: false });
    }
  }, [concertId, refreshToken]);

  useEffect(() => {
    if (!refreshToken || (!hasPagoMovil && !hasZelle)) return;
    loadStatus();
  }, [refreshToken, hasPagoMovil, hasZelle, loadStatus]);

  // Sin GEMINI_API_KEY la feature se apaga limpia: no hay boton.
  if (!status?.enabled || (!hasPagoMovil && !hasZelle)) return null;

  const isZelle = (result?.paymentType ?? paymentType) === "zelle";
  const fmt = (n: number | null | undefined) => {
    if (n == null) return "—";
    return isZelle
      ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `${n.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs`;
  };
  const errorText = (code: string) =>
    t(`admin.aiReconcile.errors.${KNOWN_ERRORS.includes(code) ? code : "GENERIC"}`);

  function openModal() {
    setResult(null);
    setError(null);
    setExactState("idle");
    setSuggestionState({});
    setSettledIds(new Set());
    setOpen(true);
  }

  async function handleFile(file: File) {
    setError(null);
    let prepared: Awaited<ReturnType<typeof prepareUpload>>;
    try {
      prepared = await prepareUpload(file);
    } catch (e) {
      setError(errorText(e instanceof ClientFileError ? e.message : "UNSUPPORTED_FORMAT"));
      return;
    }
    const form = new FormData();
    form.set("concertId", concertId);
    form.set("paymentType", paymentType);
    if (prepared.file) form.set("file", prepared.file, prepared.name);
    if (prepared.sheetText) form.set("sheetText", prepared.sheetText);

    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    try {
      const res = await fetch("/api/reconcile-ai", {
        method: "POST",
        headers: { Authorization: `Bearer ${refreshToken}` },
        body: form,
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          errorText(
            res.status === 413
              ? "FILE_TOO_LARGE"
              : res.status === 504 && !data.code
                ? "AI_TIMEOUT"
                : data.code || data.error || "",
          ),
        );
      } else {
        setResult(data as AiResult);
      }
      loadStatus();
    } catch {
      setError(errorText(controller.signal.aborted ? "AI_TIMEOUT" : "GENERIC"));
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }

  /**
   * Aprueba por el flujo existente. Solo envia las ordenes que aun no quedaron
   * resueltas (un reintento tras un fallo parcial no reenvia las ya aprobadas).
   * Una orden que ya no esta pendiente (aprobada por otra via, rechazada) se da
   * por resuelta. true = todas resueltas.
   */
  async function approve(orderIds: string[]): Promise<boolean> {
    const toSend = orderIds.filter((id) => !settledIds.has(id));
    if (toSend.length === 0) return true;
    try {
      const res = await fetch("/api/reconcile-csv/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${refreshToken}` },
        body: JSON.stringify({ concertId, orderIds: toSend, source: "ai" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(t("admin.aiReconcile.approveErrors.GENERIC"));
        return false;
      }
      const results = (data.results || []) as { orderId: string; success: boolean; errorCode?: string }[];
      const settledNow = results
        .filter((r) => r.success || r.errorCode === "INVALID_STATUS")
        .map((r) => r.orderId);
      setSettledIds((prev) => new Set([...prev, ...settledNow]));
      const failures = results.filter((r) => !r.success);
      const approved = results.filter((r) => r.success).length;
      if (failures.length > 0) {
        const code = failures[0].errorCode ?? "GENERIC";
        const known = ["NO_BALANCE", "INSUFFICIENT_BALANCE", "INVALID_STATUS", "NOT_IN_CONCERT", "NOT_FOUND"];
        toast.error(
          `${t("admin.reconcileResult", { approved, failed: failures.length })} — ${t(
            `admin.aiReconcile.approveErrors.${known.includes(code) ? code : "GENERIC"}`,
          )}`,
        );
      } else {
        toast.success(t("admin.reconcileResult", { approved, failed: 0 }));
      }
      return toSend.every((id) => settledNow.includes(id));
    } catch {
      toast.error(t("admin.connectionError"));
      return false;
    }
  }

  async function approveExact() {
    if (!result) return;
    setExactState("approving");
    const ok = await approve(result.exactos.flatMap((e) => e.orders.map((o) => o.orderId)));
    setExactState(ok ? "approved" : "failed");
  }

  async function approveSuggestion(s: Suggestion) {
    setSuggestionState((prev) => ({ ...prev, [s.rowIndex]: "approving" }));
    const ok = await approve(s.orders.map((o) => o.orderId));
    setSuggestionState((prev) => ({ ...prev, [s.rowIndex]: ok ? "approved" : "failed" }));
  }

  const bankLine = (b: Bank) => (
    <div className="min-w-0">
      <p className="font-semibold">{fmt(b.amount)}</p>
      <p className="text-xs text-muted truncate">
        {[b.date, b.reference && `Ref ${b.reference}`].filter(Boolean).join(" · ")}
      </p>
      {b.description && <p className="text-xs text-muted truncate" title={b.description}>{b.description}</p>}
    </div>
  );
  const orderLines = (orders: OrderRef[]) => (
    <ul className="space-y-0.5 min-w-0">
      {orders.map((o) => (
        <li key={o.orderId} className="text-sm truncate">
          <span className="font-mono text-xs text-muted mr-1.5">{o.orderNumber}</span>
          {o.name}
        </li>
      ))}
    </ul>
  );
  const sectionTitle = (label: string, count: number, tone: string) => (
    <div className="flex items-center gap-2 mb-2">
      <h3 className="font-semibold">{label}</h3>
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${tone}`}>{count}</span>
    </div>
  );

  const exactOrderCount = result?.exactos.reduce((n, e) => n + e.orders.length, 0) ?? 0;

  return (
    <>
      <button
        onClick={openModal}
        className="px-4 py-2 border border-accent/50 text-accent-light hover:bg-accent/10 rounded-lg text-sm font-medium transition-colors"
      >
        {t("admin.aiReconcile.button")}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-border">
              <div>
                <h2 className="text-xl font-bold">{t("admin.aiReconcile.title")}</h2>
                <p className="text-xs text-muted mt-0.5">{t("admin.aiReconcile.neverApproves")}</p>
              </div>
              <button
                onClick={() => !loading && setOpen(false)}
                disabled={loading}
                aria-label={t("admin.reconcileClose")}
                className="p-2 hover:bg-muted/10 rounded-lg transition-colors disabled:opacity-40"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6">
              {error && (
                <div className="mb-4 p-3 bg-danger/10 border border-danger/30 rounded-lg text-sm">
                  <p className="text-danger">{error}</p>
                  <p className="text-muted mt-1">{t("admin.aiReconcile.csvFallback")}</p>
                </div>
              )}

              {/* Paso 1: cuenta + archivo */}
              {!result && !loading && (
                <div className="space-y-5">
                  <div>
                    <p className="text-sm font-medium mb-2">{t("admin.aiReconcile.whichAccount")}</p>
                    <div className="flex gap-2">
                      {hasPagoMovil && (
                        <button
                          onClick={() => setPaymentType("pago_movil")}
                          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                            paymentType === "pago_movil"
                              ? "bg-accent text-white shadow-lg shadow-accent/20"
                              : "bg-background border border-border text-muted hover:text-foreground"
                          }`}
                        >
                          Pago M&oacute;vil
                        </button>
                      )}
                      {hasZelle && (
                        <button
                          onClick={() => setPaymentType("zelle")}
                          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                            paymentType === "zelle"
                              ? "bg-accent text-white shadow-lg shadow-accent/20"
                              : "bg-background border border-border text-muted hover:text-foreground"
                          }`}
                        >
                          Zelle
                        </button>
                      )}
                    </div>
                  </div>
                  <div
                    className="border-2 border-dashed border-border rounded-xl p-12 text-center cursor-pointer hover:border-accent/50 transition-colors"
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const file = e.dataTransfer.files[0];
                      if (file) handleFile(file);
                    }}
                  >
                    <svg className="w-12 h-12 mx-auto mb-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="text-foreground font-medium mb-1">{t("admin.aiReconcile.dropzone")}</p>
                    <p className="text-sm text-muted">{t("admin.aiReconcile.formats")}</p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.txt,.xls,.xlsx"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) handleFile(file);
                      }}
                    />
                  </div>
                  <div className="flex flex-wrap justify-between gap-2 text-xs text-muted">
                    <span>{t("admin.aiReconcile.privacy")}</span>
                    {status.remainingToday != null && (
                      <span>{t("admin.aiReconcile.remaining", { count: status.remainingToday })}</span>
                    )}
                  </div>
                </div>
              )}

              {loading && (
                <div className="py-16 text-center space-y-3">
                  <div className="w-10 h-10 mx-auto border-4 border-accent/30 border-t-accent rounded-full animate-spin" />
                  <p className="font-medium">{t("admin.aiReconcile.loading")}</p>
                  <p className="text-sm text-muted">{t("admin.aiReconcile.loadingHint")}</p>
                </div>
              )}

              {/* Paso 2: revision */}
              {result && (
                <div className="space-y-8">
                  <div className="flex flex-wrap gap-2 text-sm">
                    <span className="px-3 py-1.5 bg-background border border-border rounded-lg">
                      {t("admin.aiReconcile.summary", {
                        credits: result.counts.credits ?? 0,
                        debits: result.counts.debitsIgnored ?? 0,
                      })}
                    </span>
                    {result.counts.creditsTotal != null && (
                      <span className="px-3 py-1.5 bg-background border border-border rounded-lg">
                        {t("admin.aiReconcile.creditsTotal", { amount: fmt(result.counts.creditsTotal) })}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted -mt-6">{t("admin.aiReconcile.crossCheck")}</p>

                  {result.warnings.length > 0 && (
                    <div className="space-y-2">
                      {result.warnings.map((w) => (
                        <div key={w} className="p-3 bg-warning/10 border border-warning/30 rounded-lg text-sm text-warning">
                          {t(`admin.aiReconcile.warnings.${w}`, { count: result.counts.invalidRows ?? 0 })}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 1. Exactos */}
                  <section>
                    {sectionTitle(t("admin.aiReconcile.exactTitle"), result.exactos.length, "bg-success/10 text-success")}
                    {result.exactos.length === 0 ? (
                      <p className="text-sm text-muted">{t("admin.aiReconcile.exactEmpty")}</p>
                    ) : (
                      <>
                        <div className="border border-border rounded-lg divide-y divide-border/50">
                          {result.exactos.map((e) => (
                            <div key={e.bank.rowIndex} className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3">
                              {bankLine(e.bank)}
                              {orderLines(e.orders)}
                            </div>
                          ))}
                        </div>
                        <div className="flex justify-end mt-3">
                          {exactState === "approved" ? (
                            <span className="text-sm text-success font-medium">{t("admin.aiReconcile.approved")}</span>
                          ) : (
                            <button
                              onClick={approveExact}
                              disabled={exactState === "approving"}
                              className="px-6 py-2 bg-success hover:bg-success/80 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-success/20"
                            >
                              {exactState === "approving"
                                ? t("admin.reconcileApproving")
                                : t("admin.aiReconcile.approveAll", { count: exactOrderCount })}
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </section>

                  {/* 2. Sugerencias */}
                  <section>
                    {sectionTitle(t("admin.aiReconcile.suggestionsTitle"), result.sugerencias.length, "bg-accent/10 text-accent-light")}
                    <p className="text-xs text-muted mb-2">{t("admin.aiReconcile.suggestionsHint")}</p>
                    {result.sugerencias.length === 0 ? (
                      <p className="text-sm text-muted">{t("admin.aiReconcile.suggestionsEmpty")}</p>
                    ) : (
                      <div className="border border-border rounded-lg divide-y divide-border/50">
                        {result.sugerencias.map((s) => {
                          const st = suggestionState[s.rowIndex] ?? "idle";
                          if (st === "dismissed") return null;
                          return (
                            <div key={s.rowIndex} className="p-3 space-y-2">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {bankLine(s.bank)}
                                <div className="min-w-0">
                                  {orderLines(s.orders)}
                                  <p className="text-xs text-muted mt-1">
                                    {t("admin.aiReconcile.expected", { amount: fmt(s.expectedAmount) })}
                                    {s.difference !== 0 && (
                                      <span className="text-warning">
                                        {" · "}
                                        {t("admin.aiReconcile.difference", {
                                          amount: `${s.difference > 0 ? "+" : "−"}${fmt(Math.abs(s.difference))}`,
                                        })}
                                      </span>
                                    )}
                                  </p>
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-sm">
                                  <span
                                    className={`inline-block px-2 py-0.5 mr-2 rounded-full text-xs font-medium ${
                                      s.confidence === "alta" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
                                    }`}
                                  >
                                    {t(`admin.aiReconcile.confidence.${s.confidence}`)}
                                  </span>
                                  <span className="text-muted">{s.reason}</span>
                                </p>
                                {st === "approved" ? (
                                  <span className="text-sm text-success font-medium">{t("admin.aiReconcile.approved")}</span>
                                ) : (
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => setSuggestionState((p) => ({ ...p, [s.rowIndex]: "dismissed" }))}
                                      disabled={st === "approving"}
                                      className="px-3 py-1.5 text-xs text-muted border border-border rounded-lg hover:text-foreground transition-colors disabled:opacity-50"
                                    >
                                      {t("admin.aiReconcile.dismiss")}
                                    </button>
                                    <button
                                      onClick={() => approveSuggestion(s)}
                                      disabled={st === "approving"}
                                      className="px-3 py-1.5 text-xs bg-success hover:bg-success/80 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                                    >
                                      {st === "approving" ? t("admin.reconcileApproving") : t("admin.aiReconcile.approve")}
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>

                  {/* 3. Lotes */}
                  {result.posiblesLotes.length > 0 && (
                    <section>
                      {sectionTitle(t("admin.aiReconcile.lotsTitle"), result.posiblesLotes.length, "bg-warning/10 text-warning")}
                      <p className="text-xs text-muted mb-2">{t("admin.aiReconcile.lotsHint")}</p>
                      <div className="border border-border rounded-lg divide-y divide-border/50">
                        {result.posiblesLotes.map((l) => (
                          <div key={l.bank.rowIndex} className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3">
                            {bankLine(l.bank)}
                            <div className="min-w-0">
                              <p className="text-sm font-medium">{l.schoolName}</p>
                              <p className="text-xs text-muted">
                                {t("admin.aiReconcile.lotDetail", { count: l.ticketCount, amount: fmt(l.expectedAmount) })}
                                {" · "}
                                {t(`admin.aiReconcile.lotReason.${l.reason}`)}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-end mt-3">
                        <button
                          onClick={() => {
                            setOpen(false);
                            onOpenAllotments();
                          }}
                          className="px-4 py-2 border border-border hover:border-accent/50 text-muted hover:text-accent-light rounded-lg text-sm font-medium transition-colors"
                        >
                          {t("admin.aiReconcile.openLots")}
                        </button>
                      </div>
                    </section>
                  )}

                  {/* 4. Sin coincidencia */}
                  {(result.sinMatch.length > 0 || result.ordenesSinMatch.length > 0) && (
                    <section className="space-y-4">
                      {sectionTitle(
                        t("admin.aiReconcile.unmatchedTitle"),
                        result.sinMatch.length + result.ordenesSinMatch.length,
                        "bg-muted/10 text-muted",
                      )}
                      {result.sinMatch.length > 0 && (
                        <details className="border border-border rounded-lg">
                          <summary className="px-3 py-2 text-sm cursor-pointer">
                            {t("admin.aiReconcile.unmatchedRows", { count: result.sinMatch.length })}
                          </summary>
                          <div className="divide-y divide-border/50 border-t border-border">
                            {result.sinMatch.map((u) => (
                              <div key={u.bank.rowIndex} className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3">
                                {bankLine(u.bank)}
                                <p className="text-xs text-muted">
                                  {t(`admin.aiReconcile.reasons.${u.code}`, { amount: fmt(u.expectedAmount) })}
                                </p>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                      {result.ordenesSinMatch.length > 0 && (
                        <details className="border border-border rounded-lg">
                          <summary className="px-3 py-2 text-sm cursor-pointer">
                            {t("admin.aiReconcile.unmatchedOrders", { count: result.ordenesSinMatch.length })}
                          </summary>
                          <div className="divide-y divide-border/50 border-t border-border">
                            {result.ordenesSinMatch.map((p) => (
                              <div key={p.orders[0].orderId} className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3">
                                {orderLines(p.orders)}
                                <p className="text-xs text-muted">
                                  {t("admin.aiReconcile.expected", { amount: fmt(p.expectedAmount) })}
                                  {p.reference && ` · Ref ${p.reference}`}
                                </p>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </section>
                  )}

                  {/* Debitos ignorados: para verificar que no se descarto un pago */}
                  {(result.debitosIgnorados?.length ?? 0) > 0 && (
                    <details className="border border-border rounded-lg">
                      <summary className="px-3 py-2 text-sm cursor-pointer text-muted">
                        {t("admin.aiReconcile.ignoredDebits", { count: result.debitosIgnorados!.length })}
                      </summary>
                      <div className="divide-y divide-border/50 border-t border-border">
                        {result.debitosIgnorados!.map((d) => (
                          <div key={d.rowIndex} className="p-3">
                            {bankLine(d)}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  <div className="flex justify-between pt-2">
                    <button
                      onClick={openModal}
                      className="px-4 py-2 text-sm text-muted border border-border rounded-lg hover:text-foreground transition-colors"
                    >
                      {t("admin.aiReconcile.another")}
                    </button>
                    <button
                      onClick={() => setOpen(false)}
                      className="px-6 py-2 bg-accent hover:bg-accent-dark text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-accent/20"
                    >
                      {t("admin.reconcileClose")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
