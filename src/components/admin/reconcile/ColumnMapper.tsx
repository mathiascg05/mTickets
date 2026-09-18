"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/LanguageContext";
import { guessHeaderRow, type ColumnMapping, type Matrix } from "./sheet";
import type { PaymentType } from "./types";

/**
 * Mapeo manual de columnas (el paso del flujo clasico). Solo aparece como
 * fallback: sin asistente y con columnas que no se reconocen solas, o cuando
 * el asistente fallo y el organizador reintenta con su CSV/Excel.
 */
export default function ColumnMapper({
  rows,
  paymentType,
  initial,
  busy,
  onSubmit,
  onBack,
}: {
  rows: Matrix;
  paymentType: PaymentType;
  initial?: { ref: string; amount: string } | null;
  busy: boolean;
  onSubmit: (mapping: ColumnMapping) => void;
  onBack: () => void;
}) {
  const { t } = useLanguage();
  const [headerRow] = useState(() => guessHeaderRow(rows));
  const headers = rows[headerRow] ?? [];
  const idxOf = (name?: string) => (name ? headers.indexOf(name) : -1);
  const [refCol, setRefCol] = useState<number>(() => idxOf(initial?.ref));
  const [amountCol, setAmountCol] = useState<number>(() => idxOf(initial?.amount));
  const preview = rows.slice(headerRow + 1, headerRow + 6);
  const isZelle = paymentType === "zelle";

  const select = (label: string, value: number, onChange: (v: number) => void) => (
    <label className="block">
      <span className="block text-sm font-medium mb-1.5">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full px-3 py-2 bg-field border border-border rounded-lg focus:outline-none focus:border-accent-light text-sm"
      >
        <option value={-1}>{t("admin.reconcileFlow.pickColumn")}</option>
        {headers.map((h, i) => (
          <option key={i} value={i}>
            {h || t("admin.reconcileFlow.columnN", { n: i + 1 })}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-semibold">{t("admin.reconcileFlow.mapTitle")}</h3>
        <p className="text-sm text-muted">{t("admin.reconcileFlow.mapHint")}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {select(
          t(isZelle ? "admin.reconcileFlow.memoColumn" : "admin.reconcileFlow.refColumn"),
          refCol,
          setRefCol,
        )}
        {select(
          t(isZelle ? "admin.reconcileFlow.amountColumnUsd" : "admin.reconcileFlow.amountColumn"),
          amountCol,
          setAmountCol,
        )}
      </div>
      {preview.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-2">{t("admin.reconcileFlow.preview")}</p>
          <div className="overflow-x-auto border border-border rounded-lg">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-background text-left">
                  {headers.map((h, i) => (
                    <th
                      key={i}
                      className={`px-3 py-2 font-medium whitespace-nowrap ${
                        i === refCol || i === amountCol ? "text-accent-light" : "text-muted"
                      }`}
                    >
                      {h || `#${i + 1}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((r, ri) => (
                  <tr key={ri} className="border-t border-border/50">
                    {headers.map((_, ci) => (
                      <td key={ci} className="px-3 py-1.5 whitespace-nowrap">
                        {r[ci] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="px-4 py-2 text-sm text-muted border border-border rounded-lg hover:text-foreground transition-colors"
        >
          {t("common.back")}
        </button>
        <button
          onClick={() => onSubmit({ headerRow, refCol, amountCol })}
          disabled={busy || refCol < 0 || amountCol < 0 || refCol === amountCol}
          className="px-6 py-2 bg-accent hover:bg-accent-dark disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-accent/20"
        >
          {busy ? t("admin.reconcileFlow.reconciling") : t("admin.reconcileFlow.reconcile")}
        </button>
      </div>
    </div>
  );
}
