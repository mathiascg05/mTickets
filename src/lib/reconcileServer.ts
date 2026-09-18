import { adminDb } from "@/lib/adminDb";
import {
  toReconcileOrder,
  type ReconcileOrder,
  type ReconcilePaymentType,
} from "@/lib/reconcile";

/**
 * Ordenes pendientes de un concierto listas para el matcher. Zelle necesita el
 * ticketType (con fases) para el recalculo de ordenes legacy sin snapshot.
 */
export async function loadPendingConcertOrders(
  concertId: string,
  type: ReconcilePaymentType,
): Promise<(ReconcileOrder & { createdAt?: number; idempotencyKey?: string; purchaseGroupId?: string })[]> {
  const where = { status: "pending", "ticketType.concert.id": concertId };
  const { orders } =
    type === "zelle"
      ? await adminDb.query({
          orders: { $: { where }, ticketType: { phases: {} } },
        })
      : await adminDb.query({ orders: { $: { where } } });
  return orders.map((o) => toReconcileOrder(o as Record<string, unknown>));
}

/** Nombres de los metodos de pago del concierto de este tipo. */
export function methodNamesOfType(
  paymentMethods: { type: string; name: string }[] | undefined,
  type: ReconcilePaymentType,
): string[] {
  return (paymentMethods || []).filter((pm) => pm.type === type).map((pm) => pm.name);
}
