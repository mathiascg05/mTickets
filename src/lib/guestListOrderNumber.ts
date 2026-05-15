import { adminDb } from "./adminDb";
import { generatePrefix, formatOrderNumber, pickUniquePrefix } from "./orderNumber";

const MAX_RETRIES = 10;

export async function assignUniqueGuestListPrefix(
  eventName: string,
): Promise<string> {
  const { guestListEvents } = await adminDb.query({ guestListEvents: {} });
  const taken = new Set<string>(
    (guestListEvents as { orderNumberPrefix?: string }[])
      .map((e) => e.orderNumberPrefix)
      .filter((p): p is string => typeof p === "string" && p.length > 0),
  );
  return pickUniquePrefix(eventName, taken);
}

export async function assignGuestListOrderNumber(
  orderId: string,
  eventId: string,
  eventName: string,
): Promise<string> {
  const { guestListOrders } = await adminDb.query({
    guestListOrders: { $: { where: { id: orderId } } },
  });
  const existing = guestListOrders[0];
  if (existing?.orderNumber) return existing.orderNumber as string;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { guestListEvents } = await adminDb.query({
      guestListEvents: { $: { where: { id: eventId } } },
    });
    const event = guestListEvents[0];
    if (!event) throw new Error(`GuestListEvent ${eventId} not found`);

    const prefix =
      (event as { orderNumberPrefix?: string }).orderNumberPrefix ||
      generatePrefix(eventName);
    const currentSeq = (event as { lastOrderSeq?: number }).lastOrderSeq || 0;
    const newSeq = currentSeq + 1;
    const orderNumber = formatOrderNumber(prefix, newSeq);

    try {
      await adminDb.transact([
        adminDb.tx.guestListOrders[orderId].update({ orderNumber }),
        adminDb.tx.guestListEvents[eventId].update({ lastOrderSeq: newSeq }),
      ]);
      return orderNumber;
    } catch (err) {
      if (attempt === MAX_RETRIES - 1) throw err;
      await new Promise((r) => setTimeout(r, 50 + Math.random() * 200));
    }
  }
  throw new Error("assignGuestListOrderNumber: exhausted retries");
}
