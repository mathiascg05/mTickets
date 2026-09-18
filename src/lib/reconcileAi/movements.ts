// Validacion defensiva de los movimientos que devuelve Gemini y su mapeo a
// BankRow. Puro: sin SDK ni DB, testeable.
import { ReconcileAiError } from "./errors";
import type { BankRow, ReconcilePaymentType } from "@/lib/reconcile";

export const MAX_MOVEMENTS = 1500;
// Por encima de esta fraccion de filas corruptas no confiamos en la extraccion.
const MAX_INVALID_RATIO = 0.2;
const MAX_AMOUNT = 1e10;

export type Movement = {
  index: number;
  date: string | null;
  description: string | null;
  reference: string | null;
  amount: number;
  direction: "credit" | "debit";
};

function cleanString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
}

/**
 * Valida la salida cruda de la extraccion. Descarta filas malformadas; si son
 * demasiadas, o hay mas movimientos que el limite, falla entero: preferimos un
 * error claro a una conciliacion parcial silenciosa.
 */
export function validateExtraction(raw: unknown): {
  movements: Movement[];
  invalid: number;
} {
  const list = (raw as { movements?: unknown })?.movements;
  if (!Array.isArray(list)) throw new ReconcileAiError("AI_BAD_OUTPUT");
  if (list.length > MAX_MOVEMENTS) throw new ReconcileAiError("TOO_MANY_MOVEMENTS");
  if (list.length === 0) throw new ReconcileAiError("NO_MOVEMENTS");

  const movements: Movement[] = [];
  let invalid = 0;
  list.forEach((item, index) => {
    const m = item as Record<string, unknown> | null;
    const amount = m?.amount;
    const direction = m?.direction;
    if (
      !m ||
      typeof amount !== "number" ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      amount > MAX_AMOUNT ||
      (direction !== "credit" && direction !== "debit")
    ) {
      invalid++;
      return;
    }
    movements.push({
      index,
      date: cleanString(m.date, 40),
      description: cleanString(m.description, 300),
      reference: cleanString(m.reference, 100),
      amount: Math.round(amount * 100) / 100,
      direction,
    });
  });

  if (invalid / list.length > MAX_INVALID_RATIO) {
    throw new ReconcileAiError("AI_BAD_OUTPUT");
  }
  return { movements, invalid };
}

/**
 * Convierte creditos a filas del matcher determinista.
 * - Pago Movil: solo la referencia extraida. No se rellena con digitos de la
 *   descripcion (fechas/montos darian un last-4 falso); una fila sin
 *   referencia queda para el paso de sugerencias.
 * - Zelle: descripcion + referencia en mayusculas, donde el matcher busca el
 *   memo MT-XXXXX.
 */
export function toBankRow(m: Movement, type: ReconcilePaymentType): BankRow {
  const reference =
    type === "zelle"
      ? [m.description, m.reference].filter(Boolean).join(" ").toUpperCase()
      : (m.reference ?? "");
  return { index: m.index, reference, amount: m.amount };
}
