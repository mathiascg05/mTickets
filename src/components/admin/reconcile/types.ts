// Modelo comun de la pantalla de revision: lo producen tanto /api/reconcile-ai
// como el camino CSV determinista (adaptCsvResult).

export type PaymentType = "pago_movil" | "zelle";

export type Bank = {
  rowIndex: number;
  date: string | null;
  description: string | null;
  reference: string | null;
  amount: number;
};

export type OrderRef = {
  orderId: string;
  orderNumber: string;
  name: string;
  reference?: string | null;
  amount: number | null;
};

export type Exact = { bank: Bank; orders: OrderRef[] };

export type Suggestion = {
  rowIndex: number;
  bank: Bank;
  expectedAmount: number;
  difference: number;
  confidence: "alta" | "media";
  reason: string;
  orders: OrderRef[];
};

export type LotMatch = {
  bank: Bank;
  allotmentId: string;
  schoolName: string;
  ticketCount: number;
  expectedAmount: number | null;
  reason: "reference_and_amount" | "reference" | "amount";
};

export type Unmatched = { bank: Bank; code: string; expectedAmount: number | null };

export type OrphanPurchase = {
  reference: string | null;
  expectedAmount: number | null;
  createdAt: number | null;
  orders: OrderRef[];
};

export type ReviewResult = {
  /** Como se obtuvo: columnas del archivo (sin IA) o asistente. Va al audit log. */
  source: "csv" | "ai";
  paymentType: PaymentType;
  currency: "USD" | "BS";
  exactos: Exact[];
  sugerencias: Suggestion[];
  posiblesLotes: LotMatch[];
  sinMatch: Unmatched[];
  ordenesSinMatch: OrphanPurchase[];
  debitosIgnorados?: Bank[];
  /** Solo camino CSV: la ruta no lista las ordenes, solo cuantas quedan. */
  pendingLeft?: number;
  counts: Record<string, number>;
  warnings: string[];
};
