"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLanguage } from "@/lib/LanguageContext";
import ColumnMapper from "./ColumnMapper";
import ReconcileReview from "./ReconcileReview";
import { adaptCsvResult, type CsvApiResponse } from "./adaptCsvResult";
import {
  detectInSheets,
  fileExtension,
  isSheetFile,
  readSheet,
  routeFile,
  toCsvRows,
  type ColumnMapping,
  type SavedMapping,
  type Sheet,
} from "./sheet";
import type { PaymentType, ReviewResult } from "./types";

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_SHEET_CHARS = 1_000_000;
const MAX_CSV_ROWS = 5000; // limite de /api/reconcile-csv
const MAX_IMAGE_SIDE = 2000;
const CLIENT_TIMEOUT_MS = 190_000;
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];
const AI_ERRORS = [
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

type Step = "upload" | "map" | "loading" | "review";
type AiInput = { file: Blob; name: string } | { sheetText: string };
/** Hoja ya leida en el navegador: se reusa para el mapeo manual o el asistente. */
type LoadedSheet = { sheets: Sheet[]; text: string };

/**
 * UN solo flujo de conciliacion. Enruta segun el archivo:
 * - CSV/Excel con columnas reconocibles → /api/reconcile-csv (determinista, sin IA).
 * - Cualquier otro caso → /api/reconcile-ai (si el asistente esta disponible).
 * - Sin asistente, o si falla → mapeo manual de columnas (flujo clasico).
 * Ambos caminos terminan en la MISMA pantalla de revision.
 */
export default function ReconcileFlow({
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
  const [step, setStep] = useState<Step>("upload");
  const [loadingKind, setLoadingKind] = useState<"csv" | "ai">("ai");
  const [error, setError] = useState<{ message: string; canRetryCsv: boolean } | null>(null);
  // Tras un fallo del asistente con un PDF/imagen: solo se aceptan hojas.
  const [csvOnly, setCsvOnly] = useState(false);
  const [sheet, setSheet] = useState<LoadedSheet | null>(null);
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [reviewKey, setReviewKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mappingKey = `reconcile-mapping-${concertId}`;
  const aiEnabled = status?.enabled === true;
  const sheetsOnly = !aiEnabled || csvOnly;

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

  if (!hasPagoMovil && !hasZelle) return null;

  const aiErrorText = (code: string) =>
    t(`admin.aiReconcile.errors.${AI_ERRORS.includes(code) ? code : "GENERIC"}`);

  function savedMapping(): SavedMapping | null {
    try {
      const raw = localStorage.getItem(mappingKey);
      return raw ? (JSON.parse(raw) as SavedMapping) : null;
    } catch {
      return null;
    }
  }

  function rememberMapping(rows: string[][], m: ColumnMapping) {
    try {
      const headers = rows[m.headerRow] ?? [];
      if (headers[m.refCol] && headers[m.amountCol]) {
        localStorage.setItem(mappingKey, JSON.stringify({ ref: headers[m.refCol], amount: headers[m.amountCol] }));
      }
    } catch {
      /* sin storage: no pasa nada */
    }
  }

  function reset() {
    setStep("upload");
    setError(null);
    setCsvOnly(false);
    setSheet(null);
    setResult(null);
  }

  function openModal() {
    reset();
    setOpen(true);
  }

  function showResult(r: ReviewResult) {
    setResult(r);
    setReviewKey((k) => k + 1); // estado de revision limpio por resultado
    setStep("review");
  }

  /** Camino determinista: columnas del archivo → /api/reconcile-csv. */
  async function runCsv(rows: string[][], mapping: ColumnMapping) {
    const { rows: csvRows, ignored } = toCsvRows(rows, mapping);
    if (csvRows.length === 0) {
      // Solo pasa con columnas elegidas a mano: se queda en el mapeo para corregirlas.
      setError({ message: t("admin.reconcileFlow.noRows"), canRetryCsv: false });
      setStep("map");
      return;
    }
    if (csvRows.length > MAX_CSV_ROWS) {
      setError({ message: t("admin.reconcileFlow.tooManyRows", { max: MAX_CSV_ROWS }), canRetryCsv: false });
      setStep("upload");
      return;
    }
    rememberMapping(rows, mapping);
    setError(null);
    setLoadingKind("csv");
    setStep("loading");
    try {
      const res = await fetch("/api/reconcile-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${refreshToken}` },
        body: JSON.stringify({ concertId, rows: csvRows, paymentType }),
      });
      if (!res.ok) {
        setError({ message: t("admin.reconcileFlow.csvError"), canRetryCsv: false });
        setStep("upload");
        return;
      }
      showResult(adaptCsvResult((await res.json()) as CsvApiResponse, csvRows, ignored, paymentType));
    } catch {
      setError({ message: t("admin.connectionError"), canRetryCsv: false });
      setStep("upload");
    }
  }

  /** Camino asistente: /api/reconcile-ai. Un fallo ofrece reintentar con CSV. */
  async function runAi(input: AiInput) {
    const form = new FormData();
    form.set("concertId", concertId);
    form.set("paymentType", paymentType);
    if ("file" in input) form.set("file", input.file, input.name);
    else form.set("sheetText", input.sheetText);

    setError(null);
    setLoadingKind("ai");
    setStep("loading");
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
        // Sin codigo = respondio la plataforma (Vercel/Cloudflare), no la ruta.
        const platformCode =
          res.status === 413
            ? "FILE_TOO_LARGE"
            : res.status === 504 || res.status === 524
              ? "AI_TIMEOUT"
              : res.status >= 500
                ? "AI_UNAVAILABLE"
                : "";
        const code = data.code || platformCode || data.error || "";
        setError({ message: aiErrorText(code), canRetryCsv: true });
        setStep("upload");
      } else {
        showResult({ ...(data as Omit<ReviewResult, "source">), source: "ai" });
      }
      loadStatus();
    } catch {
      setError({ message: aiErrorText(controller.signal.aborted ? "AI_TIMEOUT" : "GENERIC"), canRetryCsv: true });
      setStep("upload");
    } finally {
      clearTimeout(timer);
    }
  }

  async function handleFile(file: File) {
    setError(null);
    const ext = fileExtension(file.name);

    if (isSheetFile(file.name)) {
      let loaded: LoadedSheet;
      try {
        loaded = await readSheet(file);
      } catch {
        setError({ message: t("admin.reconcileFlow.parseError"), canRetryCsv: false });
        return;
      }
      if (!loaded.sheets.some((s) => s.rows.length >= 2)) {
        setError({ message: t("admin.reconcileFlow.emptyFile"), canRetryCsv: false });
        return;
      }
      setSheet(loaded);
      const detected = detectInSheets(loaded.sheets, paymentType, savedMapping());
      const route = routeFile({ fileName: file.name, aiAvailable: aiEnabled, sheetsOnly, columnsDetected: !!detected });
      if (route.kind === "csv" && detected) {
        await runCsv(loaded.sheets[detected.sheet].rows, detected.mapping);
      } else if (route.kind === "ai") {
        if (loaded.text.length > MAX_SHEET_CHARS) {
          setError({ message: aiErrorText("FILE_TOO_LARGE"), canRetryCsv: true });
          return;
        }
        await runAi({ sheetText: loaded.text });
      } else {
        setStep("map");
      }
      return;
    }

    if (routeFile({ fileName: file.name, aiAvailable: aiEnabled, sheetsOnly, columnsDetected: false }).kind === "reject") {
      setError({ message: t("admin.reconcileFlow.sheetsOnlyError"), canRetryCsv: false });
      return;
    }
    try {
      if (ext === "pdf") {
        if (file.size > MAX_UPLOAD_BYTES) throw new ClientFileError("FILE_TOO_LARGE");
        await runAi({ file, name: file.name });
      } else if (IMAGE_EXTENSIONS.includes(ext)) {
        const blob = await downscaleImage(file);
        if (blob.size > MAX_UPLOAD_BYTES) throw new ClientFileError("FILE_TOO_LARGE");
        await runAi({ file: blob, name: "statement.jpg" });
      } else {
        throw new ClientFileError("UNSUPPORTED_FORMAT");
      }
    } catch (e) {
      setError({
        message: aiErrorText(e instanceof ClientFileError ? e.message : "UNSUPPORTED_FORMAT"),
        canRetryCsv: false,
      });
    }
  }

  /** Tras un fallo del asistente: con una hoja ya leida → mapeo manual; si no → pedir CSV/Excel. */
  function retryWithCsv() {
    setError(null);
    if (sheet) {
      setStep("map");
    } else {
      setCsvOnly(true);
      setStep("upload");
    }
  }

  const mapperSheet = sheet?.sheets.find((s) => s.rows.length >= 2) ?? null;
  const accept = sheetsOnly
    ? ".csv,.txt,.xls,.xlsx"
    : ".pdf,.png,.jpg,.jpeg,.webp,.csv,.txt,.xls,.xlsx";

  const accountButton = (type: PaymentType, label: string) => (
    <button
      onClick={() => setPaymentType(type)}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
        paymentType === type
          ? "bg-accent text-white shadow-lg shadow-accent/20"
          : "bg-background border border-border text-muted hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );

  return (
    <>
      <button
        onClick={openModal}
        className="px-4 py-2 bg-accent hover:bg-accent-dark text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-accent/20"
      >
        {t("admin.reconcileFlow.button")}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-border">
              <div>
                <h2 className="text-xl font-bold">{t("admin.reconcileFlow.title")}</h2>
                <p className="text-xs text-muted mt-0.5">{t("admin.aiReconcile.neverApproves")}</p>
              </div>
              <button
                onClick={() => step !== "loading" && setOpen(false)}
                disabled={step === "loading"}
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
                <div className="mb-4 p-3 bg-danger/10 border border-danger/30 rounded-lg text-sm flex flex-wrap items-center justify-between gap-3">
                  <p className="text-danger">{error.message}</p>
                  {error.canRetryCsv && (
                    <button
                      onClick={retryWithCsv}
                      className="px-3 py-1.5 text-xs border border-border rounded-lg text-foreground hover:border-accent/50 transition-colors"
                    >
                      {t("admin.reconcileFlow.retryWithCsv")}
                    </button>
                  )}
                </div>
              )}

              {step === "upload" && (
                <div className="space-y-5">
                  <div>
                    <p className="text-sm font-medium mb-2">{t("admin.aiReconcile.whichAccount")}</p>
                    <div className="flex gap-2">
                      {hasPagoMovil && accountButton("pago_movil", t("admin.reconcileFlow.accountPagoMovil"))}
                      {hasZelle && accountButton("zelle", t("admin.reconcileFlow.accountZelle"))}
                    </div>
                  </div>
                  {csvOnly && (
                    <p className="p-3 bg-warning/10 border border-warning/30 rounded-lg text-sm text-warning">
                      {t("admin.reconcileFlow.csvOnlyNotice")}
                    </p>
                  )}
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
                    <p className="text-sm text-muted">
                      {t(sheetsOnly ? "admin.reconcileFlow.formatsSheetsOnly" : "admin.reconcileFlow.formatsAll")}
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={accept}
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
                    {aiEnabled && status?.remainingToday != null && (
                      <span>{t("admin.aiReconcile.remaining", { count: status.remainingToday })}</span>
                    )}
                  </div>
                </div>
              )}

              {step === "map" && mapperSheet && (
                <ColumnMapper
                  rows={mapperSheet.rows}
                  paymentType={paymentType}
                  initial={savedMapping()}
                  busy={false}
                  onSubmit={(m) => runCsv(mapperSheet.rows, m)}
                  onBack={() => {
                    setError(null);
                    setStep("upload");
                  }}
                />
              )}

              {step === "loading" && (
                <div className="py-16 text-center space-y-3">
                  <div className="w-10 h-10 mx-auto border-4 border-accent/30 border-t-accent rounded-full animate-spin" />
                  <p className="font-medium">
                    {loadingKind === "csv" ? t("admin.reconcileFlow.reconciling") : t("admin.aiReconcile.loading")}
                  </p>
                  {loadingKind === "ai" && <p className="text-sm text-muted">{t("admin.aiReconcile.loadingHint")}</p>}
                </div>
              )}

              {step === "review" && result && (
                <ReconcileReview
                  key={reviewKey}
                  result={result}
                  concertId={concertId}
                  refreshToken={refreshToken}
                  onOpenAllotments={() => {
                    setOpen(false);
                    onOpenAllotments();
                  }}
                  onAnother={reset}
                  onClose={() => setOpen(false)}
                  onAskAssistant={
                    result.source === "csv" && aiEnabled && sheet
                      ? () => runAi({ sheetText: sheet.text })
                      : undefined
                  }
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
