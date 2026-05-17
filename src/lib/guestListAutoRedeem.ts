import { id as genId } from "@instantdb/admin";
import { adminDb } from "@/lib/adminDb";
import { generateOrderToken } from "@/lib/guestListTokens";
import { sendGuestListTicketEmail } from "@/lib/guestListTicketSender";
import {
  assignGuestListOrderNumber,
  assignUniqueGuestListPrefix,
} from "@/lib/guestListOrderNumber";
import { isEmailSuppressed } from "@/lib/emailSuppression";
import { resolveEmailLang } from "@/lib/serverLocale";

type AutoRedeemEntry = {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  cedula?: string;
  priceOverride?: number;
  ticketType?: unknown;
};

type AutoRedeemEvent = {
  id: string;
  name: string;
  defaultPrice: number;
  defaultLanguage?: string;
  orderNumberPrefix?: string;
};

export type AutoRedeemResult =
  | { success: true; orderId: string }
  | { error: string };

/**
 * Crea automáticamente la orden y manda el QR para una entrada gratis ($0),
 * saltando el paso de "click en link + confirmar" del flujo invitee-driven.
 * Replica la lógica de create-order/route.ts para entradas con finalPrice === 0.
 */
export async function autoRedeemFreeEntry(
  entry: AutoRedeemEntry,
  event: AutoRedeemEvent,
): Promise<AutoRedeemResult> {
  if (!entry.email) {
    return { error: "no_email" };
  }

  const rawTicketType = entry.ticketType as unknown;
  const ticketType = (
    Array.isArray(rawTicketType) ? rawTicketType[0] : rawTicketType
  ) as
    | {
        id: string;
        price: number;
        feePercent?: number;
        feeFixed?: number;
      }
    | undefined;

  const hasOverride = typeof entry.priceOverride === "number";
  const basePrice = ticketType ? ticketType.price : event.defaultPrice;
  const feePercentSnapshot = ticketType?.feePercent ?? 0;
  const feeFixedSnapshot = ticketType?.feeFixed ?? 0;
  const feeAmountSnapshot = hasOverride
    ? 0
    : Math.round(
        ((basePrice * feePercentSnapshot) / 100 + feeFixedSnapshot) * 100,
      ) / 100;
  const finalPrice = hasOverride
    ? (entry.priceOverride as number)
    : Math.round((basePrice + feeAmountSnapshot) * 100) / 100;

  if (finalPrice !== 0) {
    return { error: "not_free" };
  }

  if (await isEmailSuppressed(entry.email)) {
    return { error: "suppressed" };
  }

  // Asegurar que el evento tenga prefix único antes de asignar order number
  if (!event.orderNumberPrefix) {
    const prefix = await assignUniqueGuestListPrefix(event.name);
    await adminDb.transact([
      adminDb.tx.guestListEvents[event.id].update({
        orderNumberPrefix: prefix,
      }),
    ]);
    event.orderNumberPrefix = prefix;
  }

  const orderId = genId();
  const orderToken = generateOrderToken();
  const orderLanguage = resolveEmailLang(undefined, event.defaultLanguage);

  const fields: Record<string, unknown> = {
    firstName: entry.firstName || "",
    lastName: entry.lastName || "",
    email: entry.email,
    cedula: entry.cedula || "",
    status: "approved",
    visited: false,
    pricePaid: 0,
    priceSnapshot: basePrice,
    feePercentSnapshot,
    feeFixedSnapshot,
    feeAmountSnapshot,
    platformFeePercentSnapshot: 0,
    platformFeeFixedSnapshot: 0,
    platformFeeAmountSnapshot: 0,
    orderToken,
    language: orderLanguage,
    createdAt: Date.now(),
  };

  const orderTx = adminDb.tx.guestListOrders[orderId]
    .update(fields)
    .link({ entry: entry.id });

  try {
    await adminDb.transact([
      ticketType ? orderTx.link({ ticketType: ticketType.id }) : orderTx,
      adminDb.tx.guestListEntries[entry.id].update({
        status: "registered",
        registeredAt: Date.now(),
      }),
    ]);
  } catch (err) {
    return {
      error: `transact_failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  try {
    await assignGuestListOrderNumber(orderId, event.id, event.name);
    await sendGuestListTicketEmail(orderId);
  } catch (err) {
    return {
      error: `email_failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return { success: true, orderId };
}
