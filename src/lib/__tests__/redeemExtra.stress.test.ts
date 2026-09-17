import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { extraRedemptionId } from "@/lib/deterministicId";

// ── adminDb mock with a REAL id-uniqueness rule ─────────────────────────────
// `.create()` throwing on an existing id is the entire concurrency guarantee of
// the redeem endpoint, so the fake store enforces it just like InstantDB does,
// and transacts are all-or-nothing.
const store = new Map<string, Record<string, unknown>>();
const mockQuery = vi.fn();

const txProxy = () =>
  new Proxy(
    {},
    {
      get: (_t, entity: string) =>
        new Proxy(
          {},
          {
            get: (_t2, id: string) => {
              const chunk = {
                __entity: entity,
                __id: id,
                __op: "update" as "update" | "create",
                __data: {} as Record<string, unknown>,
                create(data: Record<string, unknown>) {
                  chunk.__op = "create";
                  chunk.__data = { ...chunk.__data, ...data };
                  return chunk;
                },
                update(data: Record<string, unknown>) {
                  chunk.__data = { ...chunk.__data, ...data };
                  return chunk;
                },
                link() {
                  return chunk;
                },
              };
              return chunk;
            },
          },
        ),
    },
  );

type Chunk = {
  __entity: string;
  __id: string;
  __op: "create" | "update";
  __data: Record<string, unknown>;
};

async function fakeTransact(ops: Chunk | Chunk[]) {
  const list = Array.isArray(ops) ? ops : [ops];
  // Validate everything first: an atomic transaction writes all or nothing.
  for (const op of list) {
    if (op.__op === "create" && store.has(op.__id)) {
      throw new Error(`Record already exists: ${op.__id}`);
    }
  }
  for (const op of list) {
    store.set(op.__id, { id: op.__id, ...op.__data });
  }
}

vi.mock("@/lib/adminDb", () => ({
  adminDb: {
    query: (...args: unknown[]) => mockQuery(...args),
    transact: (ops: Chunk | Chunk[]) => fakeTransact(ops),
    tx: txProxy(),
    auth: { verifyToken: vi.fn() },
  },
}));

const mockVerifyScannerToken = vi.fn();
vi.mock("@/lib/scannerToken", () => ({
  verifyScannerToken: (...args: unknown[]) => mockVerifyScannerToken(...args),
  createScannerToken: vi.fn(),
}));

const CONCERT_ID = "c0000000-0000-4000-8000-000000000001";
const QR1 = "a0000000-0000-4000-8000-000000000001";
const QR2 = "a0000000-0000-4000-8000-000000000002";
const GROUP_ID = "g0000000-0000-4000-8000-000000000001";
const FRANELA = "e0000000-0000-4000-8000-000000000001";
const TRAGO = "e0000000-0000-4000-8000-000000000002";

/** Wires the two queries the route makes: the order tree, then the pool rows. */
function wireQueries(opts: { franelaQty: number; includedTragos?: number }) {
  mockQuery.mockImplementation(async (q: Record<string, unknown>) => {
    if ("extraRedemptions" in q) {
      const where = (q.extraRedemptions as { $: { where: Record<string, unknown> } }).$
        .where;
      const rows = [...store.values()].filter((r) => {
        if (r.poolKey === undefined) return false;
        if (where.clientRequestId && r.clientRequestId !== where.clientRequestId)
          return false;
        const pk = where.poolKey;
        if (typeof pk === "string") return r.poolKey === pk;
        if (pk && typeof pk === "object" && "$in" in pk) {
          return (pk.$in as string[]).includes(r.poolKey as string);
        }
        return true;
      });
      return { extraRedemptions: rows };
    }
    const orderId = (q.orders as { $: { where: { id: string } } }).$.where.id;
    return {
      orders: [
        {
          id: orderId,
          status: "approved",
          ticketType: {
            concert: { id: CONCERT_ID, organizerEmail: "o@x.com", collaborators: [] },
            includedExtras: opts.includedTragos
              ? [{ includedQty: opts.includedTragos, extra: { id: TRAGO, name: "Trago" } }]
              : [],
          },
          extraPurchaseGroup: {
            id: GROUP_ID,
            items: [
              {
                quantity: opts.franelaQty,
                extra: { id: FRANELA, name: "Franela" },
              },
            ],
          },
        },
      ],
    };
  });
}

function redeemRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL("/api/scan/redeem-extra", "http://localhost:3000"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scannerToken: "tok", ...body }),
  });
}

let handler: typeof import("@/app/api/scan/redeem-extra/route").POST;

beforeEach(async () => {
  store.clear();
  vi.clearAllMocks();
  mockVerifyScannerToken.mockReturnValue({ concertId: CONCERT_ID });
  process.env.INSTANT_APP_ADMIN_TOKEN = "test-admin-token";
  handler = (await import("@/app/api/scan/redeem-extra/route")).POST;
});

const redeemedRows = () =>
  [...store.values()].filter((r) => r.poolKey !== undefined);

describe("POST /api/scan/redeem-extra — concurrency", () => {
  it("two devices redeeming 1 unit at the SAME instant: exactly one wins", async () => {
    wireQueries({ franelaQty: 1 });

    const [a, b] = await Promise.all([
      handler(redeemRequest({ orderId: QR1, extraId: FRANELA, source: "purchased" })),
      handler(redeemRequest({ orderId: QR2, extraId: FRANELA, source: "purchased" })),
    ]);
    const statuses = [a.status, b.status].sort();

    expect(statuses).toEqual([200, 409]);
    // The id space of a 1-unit pool has exactly one value, so only one row can exist.
    expect(redeemedRows()).toHaveLength(1);
  });

  it("two devices on a 2-unit pool: both succeed, taking units 0 and 1", async () => {
    wireQueries({ franelaQty: 2 });

    const results = await Promise.all([
      handler(redeemRequest({ orderId: QR1, extraId: FRANELA, source: "purchased" })),
      handler(redeemRequest({ orderId: QR2, extraId: FRANELA, source: "purchased" })),
    ]);

    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const rows = redeemedRows();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.unitIndex).sort()).toEqual([0, 1]);
  });

  it("never writes more rows than the pool holds, however many race", async () => {
    wireQueries({ franelaQty: 3 });

    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        handler(
          redeemRequest({
            orderId: i % 2 === 0 ? QR1 : QR2,
            extraId: FRANELA,
            source: "purchased",
          }),
        ),
      ),
    );

    expect(redeemedRows().length).toBeLessThanOrEqual(3);
  });

  it("uses the deterministic id, so the loser targets the row the winner wrote", async () => {
    wireQueries({ franelaQty: 1 });
    await handler(
      redeemRequest({ orderId: QR1, extraId: FRANELA, source: "purchased" }),
    );
    expect(store.has(extraRedemptionId(`grp:${GROUP_ID}:${FRANELA}`, 0))).toBe(true);
  });
});

describe("POST /api/scan/redeem-extra — balance and pools", () => {
  it("a QR of the group consumes the SHARED pool", async () => {
    wireQueries({ franelaQty: 2 });

    const first = await handler(
      redeemRequest({ orderId: QR1, extraId: FRANELA, source: "purchased" }),
    );
    expect(first.status).toBe(200);

    // A different QR of the same checkout now sees 1 of 2.
    const second = await handler(
      redeemRequest({ orderId: QR2, extraId: FRANELA, source: "purchased" }),
    );
    const body = await second.json();
    expect(second.status).toBe(200);
    expect(body.entitlements[0]).toMatchObject({ redeemed: 2, remaining: 0 });

    const third = await handler(
      redeemRequest({ orderId: QR1, extraId: FRANELA, source: "purchased" }),
    );
    expect(third.status).toBe(409);
  });

  it("included extras are per QR: QR2 still has its own", async () => {
    wireQueries({ franelaQty: 1, includedTragos: 1 });

    await handler(redeemRequest({ orderId: QR1, extraId: TRAGO, source: "included" }));
    const other = await handler(
      redeemRequest({ orderId: QR2, extraId: TRAGO, source: "included" }),
    );

    expect(other.status).toBe(200);
    expect(redeemedRows()).toHaveLength(2);
  });

  it("refuses to redeem more units than remain", async () => {
    wireQueries({ franelaQty: 2 });
    const res = await handler(
      redeemRequest({ orderId: QR1, extraId: FRANELA, source: "purchased", units: 3 }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("EXTRA_NO_BALANCE");
    expect(redeemedRows()).toHaveLength(0);
  });

  it("a retried request with the same clientRequestId does not burn a second unit", async () => {
    wireQueries({ franelaQty: 2 });
    const body = {
      orderId: QR1,
      extraId: FRANELA,
      source: "purchased",
      clientRequestId: "press-1",
    };
    await handler(redeemRequest(body));
    const retry = await handler(redeemRequest(body));

    expect(retry.status).toBe(200);
    expect((await retry.json()).alreadyApplied).toBe(true);
    expect(redeemedRows()).toHaveLength(1);
  });

  it("rejects an unknown extra for this order", async () => {
    wireQueries({ franelaQty: 1 });
    const res = await handler(
      redeemRequest({ orderId: QR1, extraId: "ghost", source: "purchased" }),
    );
    expect(res.status).toBe(404);
  });

  it("rejects a bad source or unit count before touching the DB", async () => {
    wireQueries({ franelaQty: 1 });
    const bad = await handler(
      redeemRequest({ orderId: QR1, extraId: FRANELA, source: "whatever" }),
    );
    const zero = await handler(
      redeemRequest({ orderId: QR1, extraId: FRANELA, source: "purchased", units: 0 }),
    );
    expect(bad.status).toBe(400);
    expect(zero.status).toBe(400);
    expect(redeemedRows()).toHaveLength(0);
  });
});

describe("POST /api/scan/redeem-extra — guards", () => {
  it("requires auth", async () => {
    wireQueries({ franelaQty: 1 });
    const res = await handler(
      new NextRequest(new URL("/api/scan/redeem-extra", "http://localhost:3000"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: QR1, extraId: FRANELA, source: "purchased" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects a scanner token scoped to another event", async () => {
    wireQueries({ franelaQty: 1 });
    mockVerifyScannerToken.mockReturnValue({ concertId: "other-concert" });
    const res = await handler(
      redeemRequest({ orderId: QR1, extraId: FRANELA, source: "purchased" }),
    );
    expect(res.status).toBe(403);
    expect(redeemedRows()).toHaveLength(0);
  });

  it("refuses a non-approved order", async () => {
    wireQueries({ franelaQty: 1 });
    const inner = mockQuery.getMockImplementation()!;
    mockQuery.mockImplementation(async (q: Record<string, unknown>) => {
      const res = await inner(q);
      if (res.orders) res.orders[0].status = "pending";
      return res;
    });

    const res = await handler(
      redeemRequest({ orderId: QR1, extraId: FRANELA, source: "purchased" }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("TICKET_NOT_APPROVED");
  });

  it("does NOT care whether the ticket was marked as visited (valet case)", async () => {
    wireQueries({ franelaQty: 1 });
    const inner = mockQuery.getMockImplementation()!;
    mockQuery.mockImplementation(async (q: Record<string, unknown>) => {
      const res = await inner(q);
      if (res.orders) res.orders[0].visited = false;
      return res;
    });

    const res = await handler(
      redeemRequest({ orderId: QR1, extraId: FRANELA, source: "purchased" }),
    );
    expect(res.status).toBe(200);
  });

  it("never writes to the orders entity — visited is mark-visited's alone", async () => {
    wireQueries({ franelaQty: 1 });
    await handler(
      redeemRequest({ orderId: QR1, extraId: FRANELA, source: "purchased" }),
    );
    for (const row of store.values()) {
      expect(row).not.toHaveProperty("visited");
      expect(row).not.toHaveProperty("visitedAt");
    }
  });
});
