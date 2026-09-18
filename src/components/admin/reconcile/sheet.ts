// Lectura de hojas del banco (CSV/Excel) en el navegador y deteccion
// conservadora de columnas para ir DIRECTO al matcher determinista, sin IA.
// Puro salvo readSheet (File); testeable.
import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { PaymentType } from "./types";

export type Matrix = string[][];
export type Sheet = { name: string; rows: Matrix };
export type ColumnMapping = { headerRow: number; refCol: number; amountCol: number };
export type SavedMapping = { ref: string; amount: string };
export type CsvRow = { reference: string; amount: number };

export const SHEET_EXTENSIONS = ["csv", "txt", "xls", "xlsx"];
const HEADER_SCAN_ROWS = 15;
const MAX_BAD_AMOUNT_RATIO = 0.1;

export function fileExtension(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

export function isSheetFile(name: string): boolean {
  return SHEET_EXTENSIONS.includes(fileExtension(name));
}

export function parseLocaleAmount(raw: string): number {
  const cleaned = raw.replace(/[^0-9.,\-]/g, "");
  if (!cleaned) return NaN;
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  if (lastComma === -1 && lastDot === -1) return parseFloat(cleaned);
  if (lastComma > -1 && lastDot > -1) {
    return lastComma > lastDot
      ? parseFloat(cleaned.replace(/\./g, "").replace(",", "."))
      : parseFloat(cleaned.replace(/,/g, ""));
  }
  const sep = lastComma > -1 ? "," : ".";
  const occurrences = cleaned.split(sep).length - 1;
  const afterLast = cleaned.length - cleaned.lastIndexOf(sep) - 1;
  if (occurrences > 1 || afterLast === 3) {
    return parseFloat(cleaned.split(sep).join(""));
  }
  return sep === "," ? parseFloat(cleaned.replace(",", ".")) : parseFloat(cleaned);
}

/** Muchos bancos exportan en Windows-1252/Latin-1: si no es UTF-8 valido, se decodifica asi. */
export function decodeText(buf: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1252").decode(buf);
  }
}

const cell = (v: unknown) => (v == null ? "" : String(v).trim());

/**
 * Lee el archivo a hojas de celdas (CSV = una hoja) y a texto CSV (todas las
 * hojas) para el asistente. Lanza si no se puede leer.
 */
export async function readSheet(file: File): Promise<{ sheets: Sheet[]; text: string }> {
  const ext = fileExtension(file.name);
  if (ext === "csv" || ext === "txt") {
    const text = decodeText(await file.arrayBuffer());
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
    return { sheets: [{ name: file.name, rows: parsed.data.map((r) => r.map(cell)) }], text };
  }
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheets = wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils
      .sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: false, blankrows: false })
      .map((r) => r.map(cell)),
  }));
  const text = wb.SheetNames.map((name) => {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false });
    return wb.SheetNames.length > 1 ? `# ${name}\n${csv}` : csv;
  }).join("\n\n");
  return { sheets, text };
}

const normalizeHeader = (h: string) =>
  h.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

const PM_REF = /(referencia|reference|confirmacion|comprobante)|^ref\.?$|^(nro|n°|no|num)\.?\s*(de\s*)?ref/;
const ZELLE_MEMO = /(memo|descripcion|concepto|detalle|description|details|nota|mensaje)/;
const CREDIT = /(credito|abono|haber|credit|deposit|ingreso)/;
const GENERIC_AMOUNT = /(monto|importe|amount|valor)/;
const NOT_AMOUNT = /(saldo|balance|disponible)/;
const MEMO_IN_TEXT = /MT[\s\-–—_.]?[A-HJ-NP-Z2-9]{5}/i;

function onlyOne(headers: string[], re: RegExp, exclude?: RegExp): number | null {
  const idx = headers
    .map((h, i) => (re.test(h) && !(exclude && exclude.test(h)) ? i : -1))
    .filter((i) => i >= 0);
  return idx.length === 1 ? idx[0] : null;
}

/** ¿Las filas de datos confirman que esas columnas son referencia y monto recibido? */
function validates(rows: Matrix, m: ColumnMapping, type: PaymentType): boolean {
  let valid = 0;
  let withDigits = 0;
  let withMemo = 0;
  let nonEmptyAmounts = 0;
  let badAmounts = 0;
  for (const row of rows.slice(m.headerRow + 1)) {
    const rawAmount = row[m.amountCol] ?? "";
    if (!rawAmount) continue;
    nonEmptyAmounts++;
    const amount = parseLocaleAmount(rawAmount);
    if (Number.isNaN(amount)) {
      badAmounts++;
      continue;
    }
    const ref = row[m.refCol] ?? "";
    if (amount <= 0 || !ref) continue;
    valid++;
    if ((ref.match(/\d/g) || []).length >= 4) withDigits++;
    if (MEMO_IN_TEXT.test(ref)) withMemo++;
  }
  if (valid === 0) return false;
  if (badAmounts > nonEmptyAmounts * MAX_BAD_AMOUNT_RATIO) return false;
  // La columna elegida tiene que parecer de referencias / memos de verdad.
  if (type === "pago_movil" && withDigits < valid * 0.5) return false;
  if (type === "zelle" && withMemo === 0) return false;
  return true;
}

/**
 * Deteccion CONSERVADORA de columnas: ante la duda devuelve null (el archivo
 * va al asistente o al mapeo manual). Busca la fila de encabezados en las
 * primeras filas (los bancos ponen titulos arriba). Un mapeo guardado de una
 * conciliacion anterior tiene prioridad si esos encabezados existen.
 */
export function detectColumns(
  rows: Matrix,
  type: PaymentType,
  saved?: SavedMapping | null,
): ColumnMapping | null {
  const limit = Math.min(HEADER_SCAN_ROWS, rows.length - 1);
  for (let headerRow = 0; headerRow < limit; headerRow++) {
    const raw = rows[headerRow];
    if (saved) {
      const refCol = raw.indexOf(saved.ref);
      const amountCol = raw.indexOf(saved.amount);
      if (refCol >= 0 && amountCol >= 0 && refCol !== amountCol) {
        const m = { headerRow, refCol, amountCol };
        if (validates(rows, m, type)) return m;
      }
    }
    const headers = raw.map(normalizeHeader);
    const refCol = onlyOne(headers, type === "zelle" ? ZELLE_MEMO : PM_REF);
    if (refCol == null) continue;
    const creditCols = headers
      .map((h, i) => (CREDIT.test(h) && !NOT_AMOUNT.test(h) && i !== refCol ? i : -1))
      .filter((i) => i >= 0);
    let amountCol: number | null = null;
    if (creditCols.length === 1) amountCol = creditCols[0];
    else if (creditCols.length === 0) {
      const generic = onlyOne(headers, GENERIC_AMOUNT, NOT_AMOUNT);
      amountCol = generic !== refCol ? generic : null;
    }
    if (amountCol == null) continue;
    const m = { headerRow, refCol, amountCol };
    if (validates(rows, m, type)) return m;
  }
  return null;
}

/** Busca la hoja y las columnas: la primera hoja con deteccion limpia. */
export function detectInSheets(
  sheets: Sheet[],
  type: PaymentType,
  saved?: SavedMapping | null,
): { sheet: number; mapping: ColumnMapping } | null {
  for (let i = 0; i < sheets.length; i++) {
    const mapping = detectColumns(sheets[i].rows, type, saved);
    if (mapping) return { sheet: i, mapping };
  }
  return null;
}

/** Fila de encabezados probable para el mapeo manual: la primera con mas celdas llenas. */
export function guessHeaderRow(rows: Matrix): number {
  let best = 0;
  let bestCount = -1;
  for (let i = 0; i < Math.min(HEADER_SCAN_ROWS, rows.length); i++) {
    const count = rows[i].filter(Boolean).length;
    if (count > bestCount) {
      best = i;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Filas para /api/reconcile-csv, igual que el flujo clasico: solo montos > 0
 * con referencia. Las demas (debitos, vacias) se cuentan como ignoradas.
 */
export function toCsvRows(rows: Matrix, m: ColumnMapping): { rows: CsvRow[]; ignored: number } {
  const out: CsvRow[] = [];
  let ignored = 0;
  for (const row of rows.slice(m.headerRow + 1)) {
    const reference = (row[m.refCol] ?? "").trim();
    const amount = parseLocaleAmount(row[m.amountCol] ?? "");
    if (reference && !Number.isNaN(amount) && amount > 0) out.push({ reference, amount });
    else if (row.some(Boolean)) ignored++;
  }
  return { rows: out, ignored };
}

export type RouteDecision =
  | { kind: "csv" } // columnas reconocidas → matcher determinista, sin IA
  | { kind: "ai" } // asistente
  | { kind: "map" } // mapeo manual de columnas (flujo clasico)
  | { kind: "reject" }; // formato no aceptado en este modo

/**
 * A donde va un archivo. Puro para poder probar todas las combinaciones:
 * hoja reconocida → csv; hoja no reconocida → asistente si esta disponible,
 * si no mapeo manual; PDF/imagen → asistente, o rechazo si solo se aceptan
 * hojas (sin asistente, o tras un fallo del asistente).
 */
export function routeFile(opts: {
  fileName: string;
  aiAvailable: boolean;
  sheetsOnly: boolean;
  columnsDetected: boolean;
}): RouteDecision {
  if (isSheetFile(opts.fileName)) {
    if (opts.columnsDetected) return { kind: "csv" };
    return opts.aiAvailable && !opts.sheetsOnly ? { kind: "ai" } : { kind: "map" };
  }
  if (!opts.aiAvailable || opts.sheetsOnly) return { kind: "reject" };
  return { kind: "ai" };
}
