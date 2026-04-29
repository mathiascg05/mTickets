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

const MUTATION_CHARS = "23456789ZYXWVTSRQPNMLKJHGFDCB".split("");

/**
 * Pick a globally-unique 4-char prefix for a concert.
 * Starts from generatePrefix(name); if taken, mutates the last
 * character through digits 2-9 then non-vowel letters Z..B.
 * If all 29 mutations of the last char are taken, also mutates
 * the second-to-last char. Throws if exhausted.
 */
export function pickUniquePrefix(concertName: string, taken: Set<string>): string {
  const base = generatePrefix(concertName);
  if (!taken.has(base)) return base;

  for (const c of MUTATION_CHARS) {
    const candidate = base.slice(0, -1) + c;
    if (!taken.has(candidate)) return candidate;
  }

  if (base.length >= 2) {
    for (const c2 of MUTATION_CHARS) {
      for (const c1 of MUTATION_CHARS) {
        const candidate = base.slice(0, -2) + c2 + c1;
        if (!taken.has(candidate)) return candidate;
      }
    }
  }

  throw new Error(
    `pickUniquePrefix: exhausted mutations for "${concertName}" (base="${base}")`,
  );
}

/**
 * Query existing concert prefixes via adminDb and return a unique one
 * for the given name.
 */
export async function assignUniquePrefix(
  db: typeof adminDb,
  concertName: string,
): Promise<string> {
  const { concerts } = await db.query({ concerts: {} });
  const taken = new Set<string>(
    (concerts as { orderNumberPrefix?: string }[])
      .map((c) => c.orderNumberPrefix)
      .filter((p): p is string => typeof p === "string" && p.length > 0),
  );
  return pickUniquePrefix(concertName, taken);
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

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // Read current lastOrderSeq and stored prefix from concert
    const { concerts } = await db.query({
      concerts: {
        $: { where: { id: concertId } },
      },
    });

    const concert = concerts[0];
    if (!concert) {
      throw new Error(`Concert ${concertId} not found`);
    }

    const prefix =
      (concert as { orderNumberPrefix?: string }).orderNumberPrefix ||
      generatePrefix(concertName);
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
      await new Promise((r) => setTimeout(r, 50 + Math.random() * 200));
    }
  }

  // Should never reach here, but TypeScript needs it
  throw new Error("assignOrderNumber: exhausted retries");
}
