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
  /** Leido de imagen y las dos lecturas no coinciden en la referencia/memo: no
   * puede conciliar exacto, solo como sugerencia (revision humana). */
  uncertainRef?: boolean;
};

function cleanString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
}

/**
 * Convierte el monto TAL COMO APARECE en el documento ("Bs. 98.431,37",
 * "$1,234.56", "(45,00)", "-1.000") a numero, con reglas fijas. El modelo a
 * veces transcribe bien los caracteres pero convierte mal el separador de miles
 * (98.431,37 → 98.43); esta conversion determinista manda sobre la suya.
 * - Con ambos separadores, el ultimo es el decimal.
 * - Con uno solo: si aparece varias veces o le siguen exactamente 3 digitos,
 *   es de miles (el dinero lleva 2 decimales); si no, es decimal.
 * null si el texto no es un unico monto reconocible.
 */
export function parseAmountText(text: unknown): number | null {
  if (typeof text !== "string") return null;
  const stripped = text
    .replace(/[A-Za-z$€]|\s| |\+/g, "")
    .replace(/^\.+/, "") // "Bs." deja un punto suelto al inicio
    .replace(/[()]/g, "")
    .replace(/^-|-$/g, "");
  if (!/^\d[\d.,]*$/.test(stripped) || !/\d$/.test(stripped)) return null;
  const lastDot = stripped.lastIndexOf(".");
  const lastComma = stripped.lastIndexOf(",");
  let normalized: string;
  if (lastDot > -1 && lastComma > -1) {
    const dec = lastDot > lastComma ? "." : ",";
    const thousands = dec === "." ? "," : ".";
    normalized = stripped.split(thousands).join("").replace(dec, ".");
  } else if (lastDot > -1 || lastComma > -1) {
    const sep = lastDot > -1 ? "." : ",";
    const occurrences = stripped.split(sep).length - 1;
    const after = stripped.length - stripped.lastIndexOf(sep) - 1;
    normalized =
      occurrences > 1 || after === 3
        ? stripped.split(sep).join("")
        : stripped.replace(sep, ".");
  } else {
    normalized = stripped;
  }
  if ((normalized.match(/\./g) || []).length > 1) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/**
 * Valida la salida cruda de la extraccion. Descarta filas malformadas; si son
 * demasiadas, o hay mas movimientos que el limite, falla entero: preferimos un
 * error claro a una conciliacion parcial silenciosa.
 */
export function validateExtraction(raw: unknown): {
  movements: Movement[];
  invalid: number;
  amountsCorrected: number;
} {
  const list = (raw as { movements?: unknown })?.movements;
  if (!Array.isArray(list)) throw new ReconcileAiError("AI_BAD_OUTPUT");
  if (list.length > MAX_MOVEMENTS) throw new ReconcileAiError("TOO_MANY_MOVEMENTS");
  if (list.length === 0) throw new ReconcileAiError("NO_MOVEMENTS");

  const movements: Movement[] = [];
  let invalid = 0;
  let amountsCorrected = 0;
  list.forEach((item, index) => {
    const m = item as Record<string, unknown> | null;
    const direction = m?.direction;
    const modelAmount =
      typeof m?.amount === "number" && Number.isFinite(m.amount) ? Math.abs(m.amount) : null;
    const textAmount = parseAmountText(m?.amountText);
    const amount = textAmount ?? modelAmount;
    if (
      !m ||
      amount == null ||
      amount <= 0 ||
      amount > MAX_AMOUNT ||
      (direction !== "credit" && direction !== "debit")
    ) {
      invalid++;
      return;
    }
    if (textAmount != null && modelAmount != null && Math.abs(textAmount - modelAmount) > 0.005) {
      amountsCorrected++;
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
  return { movements, invalid, amountsCorrected };
}

/**
 * Variantes con que el comprador escribe el memo en el concepto: "MT ABCDE",
 * "MTABCDE", "MT–ABCDE" (guion largo del teclado movil), "mt_abcde". Solo
 * letras/digitos del alfabeto del memo (sin I, O, 0, 1).
 */
const MEMO_VARIANT = /\bMT[\s\-–—_.]{0,2}([A-HJ-NP-Z2-9]{5})\b/gi;

export function normalizeMemos(text: string): string {
  return text.replace(MEMO_VARIANT, (_, code: string) => `MT-${code.toUpperCase()}`);
}

/** Referencia etiquetada dentro del concepto ("REF 123456", "Ref.: 0012345", "Nro 99887766"). */
const LABELED_REF = /\b(?:REF(?:ERENCIA)?|NRO|N[°º]|CONF(?:IRMACION)?)\.?\s*:?\s*#?\s*(\d{4,})/i;

/**
 * Convierte creditos a filas del matcher determinista.
 * - Pago Movil: la referencia extraida; si el banco no tiene columna, solo una
 *   referencia ETIQUETADA en el concepto. Nunca digitos sueltos (fechas y
 *   montos darian un last-4 falso); sin referencia, la fila va a sugerencias.
 * - Zelle: descripcion + referencia en mayusculas y con el memo normalizado,
 *   donde el matcher busca MT-XXXXX.
 */
export function toBankRow(m: Movement, type: ReconcilePaymentType): BankRow {
  if (type === "zelle") {
    const text = normalizeMemos([m.description, m.reference].filter(Boolean).join(" ")).toUpperCase();
    // Memo dudoso: se quita para que no concilie exacto.
    return { index: m.index, reference: m.uncertainRef ? text.replace(/MT-[A-Z0-9]{5}/g, "") : text, amount: m.amount };
  }
  if (m.uncertainRef) return { index: m.index, reference: "", amount: m.amount };
  const labeled = m.description?.match(LABELED_REF)?.[1];
  return { index: m.index, reference: m.reference ?? labeled ?? "", amount: m.amount };
}

/** Lo que identifica al pago: digitos de la referencia (Pago Movil) o memo (Zelle). */
function identityKey(m: Movement, type: ReconcilePaymentType): string {
  if (type === "zelle") {
    const text = normalizeMemos([m.description, m.reference].filter(Boolean).join(" ")).toUpperCase();
    return (text.match(/MT-[A-Z0-9]{5}/g) ?? []).sort().join(",");
  }
  const ref = m.reference ?? m.description?.match(LABELED_REF)?.[1] ?? "";
  return ref.replace(/\D/g, "");
}

/**
 * Cruza dos lecturas independientes del mismo documento (imagenes y PDFs
 * escaneados, donde un digito puede leerse mal). La lectura A manda; cada fila
 * se busca en B por direccion y monto. Si no aparece en B, o aparece con otra
 * referencia/memo, la identidad de esa fila queda como dudosa: sigue en el
 * resultado, pero ya no puede conciliar exacto.
 */
export function crossCheckReads(
  a: Movement[],
  b: Movement[],
  type: ReconcilePaymentType,
): { movements: Movement[]; uncertain: number } {
  const used = new Set<number>();
  let uncertain = 0;
  const movements = a.map((m) => {
    const j = b.findIndex(
      (n, idx) => !used.has(idx) && n.direction === m.direction && Math.abs(n.amount - m.amount) < 0.005 &&
        identityKey(n, type) === identityKey(m, type),
    );
    if (j >= 0) {
      used.add(j);
      return m;
    }
    if (m.direction === "credit") uncertain++;
    return { ...m, uncertainRef: true };
  });
  return { movements, uncertain };
}
