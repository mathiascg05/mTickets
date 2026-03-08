import { adminDb } from "./adminDb";

const MAX_RETRIES = 10;
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
 * Uses the atomic lastOrderSeq counter on the concert entity.
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

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // Read current lastOrderSeq from concert
    const { concerts } = await db.query({
      concerts: {
        $: { where: { id: concertId } },
      },
    });

    const concert = concerts[0];
    if (!concert) {
      throw new Error(`Concert ${concertId} not found`);
    }

    const currentSeq = (concert as { lastOrderSeq?: number }).lastOrderSeq || 0;
    const newSeq = currentSeq + 1;
    const orderNumber = formatOrderNumber(prefix, newSeq);

    try {
      await db.transact([
        db.tx.orders[orderId].update({ orderNumber }),
        db.tx.concerts[concertId].update({ lastOrderSeq: newSeq }),
      ]);
      return orderNumber;
    } catch (err) {
      if (attempt === MAX_RETRIES - 1) {
        throw err;
      }
      console.warn(`[assignOrderNumber] Attempt ${attempt + 1} failed, retrying...`);
      const backoff = Math.min(50 * Math.pow(2, attempt), 2000) + Math.random() * 200;
      await new Promise((r) => setTimeout(r, backoff));
    }
  }

  // Should never reach here, but TypeScript needs it
  throw new Error("assignOrderNumber: exhausted retries");
}
