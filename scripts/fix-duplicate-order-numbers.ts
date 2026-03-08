import { init } from "@instantdb/admin";
import schema from "../src/instant.schema";

const appId = process.env.NEXT_PUBLIC_INSTANT_APP_ID!;
const adminToken = process.env.INSTANT_APP_ADMIN_TOKEN!;
const db = init({ appId, adminToken, schema });

function generatePrefix(concertName: string): string {
  const vowels = new Set("AEIOUaeiou".split(""));
  const consonants = concertName
    .split("")
    .filter((c) => /[a-zA-Z]/.test(c) && !vowels.has(c))
    .map((c) => c.toUpperCase());

  if (consonants.length >= 4) return consonants.slice(0, 4).join("");

  const alphas = concertName
    .split("")
    .filter((c) => /[a-zA-Z]/.test(c))
    .map((c) => c.toUpperCase());

  return alphas.slice(0, 4).join("") || "EVNT";
}

function formatOrderNumber(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

async function main() {
  const { concerts } = await db.query({
    concerts: {
      ticketTypes: {
        orders: {},
      },
    },
  });

  let totalFixed = 0;

  for (const concert of concerts) {
    const concertData = concert as {
      id: string;
      name: string;
      lastOrderSeq?: number;
      ticketTypes: { orders: { id: string; orderNumber?: string; createdAt: number }[] }[];
    };

    // Collect all orders for this concert
    const allOrders: { id: string; orderNumber?: string; createdAt: number }[] = [];
    for (const tt of concertData.ticketTypes) {
      allOrders.push(...tt.orders);
    }

    if (allOrders.length === 0) continue;

    // Group by orderNumber to find duplicates
    const byNumber: Record<string, typeof allOrders> = {};
    for (const o of allOrders) {
      const num = o.orderNumber || "";
      if (!num) continue;
      if (!byNumber[num]) byNumber[num] = [];
      byNumber[num].push(o);
    }

    const duplicateGroups = Object.entries(byNumber).filter(
      ([, group]) => group.length > 1,
    );

    if (duplicateGroups.length === 0) continue;

    console.log(`\nConcert: ${concertData.name} (${concertData.id})`);
    const prefix = generatePrefix(concertData.name);

    // Find the current max seq from existing order numbers
    let maxSeq = concertData.lastOrderSeq || 0;
    for (const o of allOrders) {
      if (!o.orderNumber) continue;
      const match = o.orderNumber.match(/-(\d+)$/);
      if (match) {
        const seq = parseInt(match[1], 10);
        if (seq > maxSeq) maxSeq = seq;
      }
    }

    const txns: ReturnType<typeof db.tx.orders[string]["update"]>[] = [];

    for (const [num, group] of duplicateGroups) {
      // Sort by createdAt — keep the earliest, reassign the rest
      group.sort((a, b) => a.createdAt - b.createdAt);

      console.log(`  Duplicate: ${num} (${group.length} orders)`);
      console.log(`    Keeping: ${group[0].id} (created ${new Date(group[0].createdAt).toISOString()})`);

      for (let i = 1; i < group.length; i++) {
        maxSeq++;
        const newOrderNumber = formatOrderNumber(prefix, maxSeq);
        console.log(`    Reassigning: ${group[i].id} → ${newOrderNumber}`);
        txns.push(db.tx.orders[group[i].id].update({ orderNumber: newOrderNumber }));
        totalFixed++;
      }
    }

    // Update concert's lastOrderSeq to the new max
    txns.push(
      db.tx.concerts[concertData.id].update({ lastOrderSeq: maxSeq }) as any,
    );

    if (txns.length > 0) {
      await db.transact(txns);
      console.log(`  Updated lastOrderSeq to ${maxSeq}`);
    }
  }

  if (totalFixed === 0) {
    console.log("\nNo duplicate order numbers found.");
  } else {
    console.log(`\nFixed ${totalFixed} duplicate order number(s).`);
  }
}

main().catch(console.error);
