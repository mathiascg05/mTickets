import { describe, it, expect, vi, beforeEach } from "vitest";
import { feeTxnId } from "@/lib/deterministicId";

// ── adminDb mock ─────────────────────────────────────────────────────────────
const mockQuery = vi.fn();
const mockTransact = vi.fn();

vi.mock("@/lib/adminDb", () => {
  // Defined inside the (hoisted) factory so it can't reference outer scope vars.
  const makeTxProxy = () =>
    new Proxy(
      {},
      {
        get: (_t, entity: string) =>
          new Proxy(
            {},
            {
              get: (_t2, id: string) => ({
                update: (data: Record<string, unknown>) => {
                  const node = { __type: "update", entity, id, data };
                  return {
                    ...node,
                    link: (links: Record<string, string>) => ({
                      ...node,
                      __type: "link",
                      links,
                    }),
                  };
                },
              }),
            },
          ),
      },
    );
  return {
    adminDb: {
      query: (...a: unknown[]) => mockQuery(...a),
      transact: (...a: unknown[]) => mockTransact(...a),
      tx: makeTxProxy(),
    },
  };
});

// Don't actually send emails.
vi.mock("@/lib/ticketEmailSender", () => ({
  sendTicketEmailForOrder: vi.fn().mockResolvedValue(undefined),
}));

import { approveOrderInternal } from "@/lib/approveOrder";

const ORDER_ID = "11111111-1111-1111-1111-111111111111";

function fixtures() {
  // Admin SDK returns has-one relations as arrays → mirror that shape.
  mockQuery.mockImplementation((q: Record<string, unknown>) => {
    if ("orders" in q) {
      return {
        orders: [
          {
            id: ORDER_ID,
            status: "pending",
            orderNumber: "EV-ABCDE",
            platformFeeAmountSnapshot: 2,
            priceSnapshot: 10,
            ticketType: [
              {
                id: "tt-1",
                price: 10,
                phases: [],
                concert: [
                  {
                    id: "concert-1",
                    organizerEmail: "org@example.com",
                    isDemo: false,
                    platformFeeConfig: [
                      { feePercent: 0, feeFixed: 2, billingMode: "prepaid" },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };
    }
    if ("organizerBalances" in q) {
      return {
        organizerBalances: [{ id: "bal-1", balance: 100 }],
      };
    }
    return {};
  });
}

function feeTxnsFrom(calls: unknown[][]) {
  const ids: string[] = [];
  for (const [txns] of calls) {
    for (const node of txns as { entity: string; id: string }[]) {
      if (node.entity === "balanceTransactions") ids.push(node.id);
    }
  }
  return ids;
}

describe("approveOrder idempotency (no double-charge)", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockTransact.mockReset();
    mockTransact.mockResolvedValue(undefined);
  });

  it("uses a deterministic fee-transaction id derived from the order", async () => {
    fixtures();
    const res = await approveOrderInternal(ORDER_ID, { skipEmail: true });
    expect(res.success).toBe(true);
    expect(res.platformFee).toBe(2);

    const feeIds = feeTxnsFrom(mockTransact.mock.calls);
    expect(feeIds).toHaveLength(1);
    // The ledger row id must equal feeTxnId(order) so a repeat approval upserts
    // the SAME row instead of inserting a second fee.
    expect(feeIds[0]).toBe(feeTxnId("order", ORDER_ID));
  });

  it("a second (concurrent/duplicate) approval reuses the same ledger id", async () => {
    fixtures();
    await approveOrderInternal(ORDER_ID, { skipEmail: true });
    await approveOrderInternal(ORDER_ID, { skipEmail: true });

    const feeIds = feeTxnsFrom(mockTransact.mock.calls);
    // Two approvals → two transacts, but BOTH target the same balanceTransactions
    // id → collapses to one fee row (idempotent, no double-charge).
    expect(new Set(feeIds).size).toBe(1);
    expect(feeIds[0]).toBe(feeTxnId("order", ORDER_ID));
  });
});
