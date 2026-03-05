import { adminDb } from "./adminDb";

const VOWELS = new Set("AEIOUaeiou".split(""));

/**
 * Generate a short prefix from a concert name.
 * Strips vowels, takes first 4 uppercase consonants.
 * Falls back to first alpha chars if too few consonants.
 */
export function generatePrefix(concertName: string): string {
  const consonants = concertName
    .split("")
    .filter((c) => /[a-zA-Z]/.test(c) && !VOWELS.has(c))
    .map((c) => c.toUpperCase());

  if (consonants.length >= 4) {
    return consonants.slice(0, 4).join("");
  }

  // Fallback: use first alpha characters
  const alphas = concertName
    .split("")
    .filter((c) => /[a-zA-Z]/.test(c))
    .map((c) => c.toUpperCase());

  return alphas.slice(0, 4).join("") || "EVNT";
}

export function formatOrderNumber(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

/**
 * Assign a sequential order number to an order within its concert.
 * Skips if the order already has one.
 */
export async function assignOrderNumber(
  db: typeof adminDb,
  orderId: string,
  concertId: string,
  concertName: string,
): Promise<string> {
  // Check if order already has a number
  const { orders: existingOrders } = await db.query({
    orders: {
      $: { where: { id: orderId } },
    },
  });
  const existing = existingOrders[0];
  if (existing?.orderNumber) {
    return existing.orderNumber as string;
  }

  const prefix = generatePrefix(concertName);

  // Query all orders for this concert to find the max sequence
  const { concerts } = await db.query({
    concerts: {
      $: { where: { id: concertId } },
      ticketTypes: {
        orders: {},
      },
    },
  });

  const concert = concerts[0];
  if (!concert) {
    throw new Error(`Concert ${concertId} not found`);
  }

  // Collect all existing order numbers for this concert
  let maxSeq = 0;
  const ticketTypes = concert.ticketTypes as { orders: { orderNumber?: string }[] }[];
  for (const tt of ticketTypes) {
    for (const order of tt.orders) {
      if (order.orderNumber) {
        const match = order.orderNumber.match(/-(\d+)$/);
        if (match) {
          const seq = parseInt(match[1], 10);
          if (seq > maxSeq) maxSeq = seq;
        }
      }
    }
  }

  const newSeq = maxSeq + 1;
  const orderNumber = formatOrderNumber(prefix, newSeq);

  await db.transact(
    db.tx.orders[orderId].update({ orderNumber }),
  );

  return orderNumber;
}
