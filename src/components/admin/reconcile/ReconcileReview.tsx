"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useLanguage } from "@/lib/LanguageContext";
import type { Bank, OrderRef, ReviewResult, Suggestion } from "./types";

type ItemState = "idle" | "approving" | "approved" | "dismissed" | "failed";

// La revision reemplaza al paso anterior en el mismo lugar: un doble clic en
// "Conciliar" no debe caer en un boton que gasta un analisis del asistente.
const ACCIDENTAL_CLICK_GUARD_MS = 700;

const APPROVE_ERROR_CODES = ["NO_BALANCE", "INSUFFICIENT_BALANCE", "INVALID_STATUS", "NOT_IN_CONCERT", "NOT_FOUND"];

/**
 * Pantalla de revision UNICA para ambos caminos (columnas del archivo o
 * asistente). Aprobar siempre pasa por el flujo existente
 * (/api/reconcile-csv/confirm → approveOrderInternal).
 */
export default function ReconcileReview({
  result,
  concertId,
  refreshToken,
  onOpenAllotments,
  onAnother,
  onClose,
  onAskAssistant,
}: {
  result: ReviewResult;
  concertId: string;
  refreshToken: string;
  onOpenAllotments: () => void;
  onAnother: () => void;
  onClose: () => void;
  /** Camino CSV con asistente disponible: pedirle sugerencias para lo que quedo sin pareja. */
  onAskAssistant?: () => void;
}) {
  const { t } = useLanguage();
  const [exactState, setExactState] = useState<ItemState>("idle");
  const [suggestionState, setSuggestionState] = useState<Record<number, ItemState>>({});
  const [settledIds, setSettledIds] = useState<Set<string>>(new Set());
  const [excludedRows, setExcludedRows] = useState<Set<number>>(new Set());
  const [mountedAt] = useState(() => Date.now());

  const isZelle = result.paymentType === "zelle";
  const fmt = (n: number | null | undefined) => {
    if (n == null) return "—";
    return isZelle
      ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `${n.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs`;
  };

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
        body: JSON.stringify({ concertId, orderIds: toSend, source: result.source }),
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
        toast.error(
          `${t("admin.reconcileResult", { approved, failed: failures.length })} — ${t(
            `admin.aiReconcile.approveErrors.${APPROVE_ERROR_CODES.includes(code) ? code : "GENERIC"}`,
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

  const includedExact = result.exactos.filter((e) => !excludedRows.has(e.bank.rowIndex));
  const exactOrderCount = includedExact.reduce((n, e) => n + e.orders.length, 0);

  async function approveExact() {
    setExactState("approving");
    const ok = await approve(includedExact.flatMap((e) => e.orders.map((o) => o.orderId)));
    setExactState(ok ? "approved" : "failed");
  }

  async function approveSuggestion(s: Suggestion) {
    setSuggestionState((prev) => ({ ...prev, [s.rowIndex]: "approving" }));
    const ok = await approve(s.orders.map((o) => o.orderId));
    setSuggestionState((prev) => ({ ...prev, [s.rowIndex]: ok ? "approved" : "failed" }));
  }

  const toggleExact = (rowIndex: number) =>
    setExcludedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });

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

  const isCsv = result.source === "csv";
  const unmatchedCount = result.sinMatch.length + result.ordenesSinMatch.length;

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="px-3 py-1.5 bg-background border border-border rounded-lg">
            {t(isCsv ? "admin.reconcileFlow.summaryCsv" : "admin.aiReconcile.summary", {
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
        <p className="text-xs text-muted">
          {isCsv ? t("admin.reconcileFlow.sourceCsv") : t("admin.aiReconcile.crossCheck")}
        </p>
      </div>

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
              {result.exactos.map((e) => {
                const excluded = excludedRows.has(e.bank.rowIndex);
                return (
                  <div
                    key={e.bank.rowIndex}
                    className={`grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] items-start gap-2 p-3 ${excluded ? "opacity-50" : ""}`}
                  >
                    {bankLine(e.bank)}
                    {orderLines(e.orders)}
                    {exactState !== "approved" && (
                      <button
                        onClick={() => toggleExact(e.bank.rowIndex)}
                        disabled={exactState === "approving"}
                        className="px-3 py-1.5 text-xs text-muted border border-border rounded-lg hover:text-foreground transition-colors disabled:opacity-50 justify-self-start sm:justify-self-end"
                      >
                        {excluded ? t("admin.reconcileFlow.includeExact") : t("admin.reconcileFlow.removeExact")}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end mt-3">
              {exactState === "approved" ? (
                <span className="text-sm text-success font-medium">{t("admin.aiReconcile.approved")}</span>
              ) : (
                <button
                  onClick={approveExact}
                  disabled={exactState === "approving" || exactOrderCount === 0}
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

      {/* 2. Sugerencias (solo el asistente las calcula) */}
      {isCsv ? (
        onAskAssistant &&
        result.sinMatch.length > 0 && (
          <section className="p-4 border border-accent/30 bg-accent/5 rounded-lg flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted max-w-xl">{t("admin.reconcileFlow.askAssistantHint")}</p>
            <button
              onClick={() => {
                if (Date.now() - mountedAt < ACCIDENTAL_CLICK_GUARD_MS) return;
                onAskAssistant();
              }}
              className="px-4 py-2 border border-accent/50 text-accent-light hover:bg-accent/10 rounded-lg text-sm font-medium transition-colors"
            >
              {t("admin.reconcileFlow.askAssistant")}
            </button>
          </section>
        )
      ) : (
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
      )}

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
              onClick={onOpenAllotments}
              className="px-4 py-2 border border-border hover:border-accent/50 text-muted hover:text-accent-light rounded-lg text-sm font-medium transition-colors"
            >
              {t("admin.aiReconcile.openLots")}
            </button>
          </div>
        </section>
      )}

      {/* 4. Sin coincidencia */}
      {(unmatchedCount > 0 || (result.pendingLeft ?? 0) > 0) && (
        <section className="space-y-4">
          {sectionTitle(t("admin.aiReconcile.unmatchedTitle"), unmatchedCount, "bg-muted/10 text-muted")}
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
          {isCsv && (result.pendingLeft ?? 0) > 0 && (
            <p className="text-sm text-muted">
              {t("admin.reconcileFlow.pendingLeft", { count: result.pendingLeft! })}
            </p>
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
          onClick={onAnother}
          className="px-4 py-2 text-sm text-muted border border-border rounded-lg hover:text-foreground transition-colors"
        >
          {t("admin.aiReconcile.another")}
        </button>
        <button
          onClick={onClose}
          className="px-6 py-2 bg-accent hover:bg-accent-dark text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-accent/20"
        >
          {t("admin.reconcileClose")}
        </button>
      </div>
    </div>
  );
}
