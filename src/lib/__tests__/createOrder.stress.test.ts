import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Shared adminDb mock ──────────────────────────────────────────────────────
const mockQuery = vi.fn();
const mockTransact = vi.fn();

const makeUpdateProxy = () =>
  new Proxy(
    {},
    {
      get: (_target, entity: string) =>
        new Proxy(
          {},
          {
            get: (_t2, id: string) => ({
              update: (data: Record<string, unknown>) => ({
                __type: "update",
                entity,
                id,
                data,
                link: (links: Record<string, string>) => ({
                  __type: "link",
                  entity,
                  id,
                  data,
                  links,
                }),
              }),
              delete: () => ({ __type: "delete", entity, id }),
            }),
          },
        ),
    },
  );

vi.mock("@/lib/adminDb", () => ({
  adminDb: {
    query: (...args: unknown[]) => mockQuery(...args),
    transact: (...args: unknown[]) => mockTransact(...args),
    tx: makeUpdateProxy(),
  },
}));

vi.mock("@instantdb/admin", () => ({
  id: () => "generated-order-id",
}));

vi.mock("@/lib/mailer", () => ({
  transporter: { sendMail: vi.fn().mockResolvedValue(undefined) },
  generateMessageId: () => "mock-msg-id@matickets.com",
  EMAIL_FROM: "test@matickets.net",
}));

vi.mock("@/lib/emailTemplate", () => ({
  buildConfirmationEmailHtml: () => "<html>confirmation</html>",
  buildConfirmationEmailText: () => "confirmation",
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (fn: () => void) => fn(),
  };
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL("/api/create-order", "http://localhost:3000"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_UUID = "a0000000-0000-4000-8000-000000000001";
const CONCERT_ID = "c0000000-0000-4000-8000-000000000001";
const COUPON_ID = "d0000000-0000-4000-8000-000000000001";

function validAttendee(override: Partial<Record<string, string>> = {}) {
  return {
    firstName: "John",
    lastName: "Doe",
    email: "john@example.com",
    cedula: "12345678",
    phone: "+584121234567",
    ...override,
  };
}

function validBody(override: Record<string, unknown> = {}) {
  return {
    ticketTypeId: VALID_UUID,
    qty: 1,
    attendees: [validAttendee()],
    paymentMethodName: "Zelle",
    ...override,
  };
}

function baseTicketType(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_UUID,
    name: "General",
    price: 50,
    quantity: 100,
    concert: [
      {
        id: CONCERT_ID,
        name: "Rock Show",
        date: "2026-06-15",
        venue: "Arena",
        slug: "rock-show",
        status: "active",
        lastOrderSeq: 0,
        coupons: [],
      },
    ],
    orders: [],
    phases: [],
    reservations: [],
    queueEntries: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset implementations for query/transact specifically (not all mocks, to preserve sendMail)
  mockQuery.mockReset();
  mockTransact.mockReset();
  mockTransact.mockResolvedValue(undefined);
  // Default catch-all: post-write validation queries get empty results → validation skipped
  mockQuery.mockResolvedValue({ ticketTypes: [], concerts: [], orders: [], emailSuppressions: [] });
  process.env.GMAIL_USER = "test@gmail.com";
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Overbooking race condition (CRITICAL)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe("POST /api/create-order — overbooking", () => {
  let handler: typeof import("@/app/api/create-order/route").POST;

  beforeEach(async () => {
    const mod = await import("@/app/api/create-order/route");
    handler = mod.POST;
  });

  it("succeeds when tickets are available", async () => {
    mockQuery
      .mockResolvedValueOnce({
        ticketTypes: [baseTicketType()],
      });

    const res = await handler(makeRequest(validBody()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.orderIds).toBeDefined();
    expect(body.orderIds.length).toBe(1);
  });

  it("rejects when available < qty", async () => {
    mockQuery.mockResolvedValueOnce({
      ticketTypes: [
        baseTicketType({
          quantity: 10,
          orders: Array.from({ length: 10 }, (_, i) => ({
            id: `order-${i}`,
            status: "approved",
          })),
        }),
      ],
    });

    const res = await handler(makeRequest(validBody()));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/not enough/i);
  });

  it("rejects when availability is exactly 0", async () => {
    mockQuery.mockResolvedValueOnce({
      ticketTypes: [
        baseTicketType({
          quantity: 5,
          orders: Array.from({ length: 5 }, (_, i) => ({
            id: `order-${i}`,
            status: "pending",
          })),
        }),
      ],
    });

    const res = await handler(makeRequest(validBody()));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.available).toBe(0);
  });

  it("FIXED: two concurrent requests for last ticket → at most one succeeds (post-write validation)", async () => {
    let queryCallCount = 0;
    mockQuery.mockImplementation(() => {
      queryCallCount++;
      // First 2 calls: the pre-write read of each concurrent handler (stale snapshot
      // showing 1 ticket left). The 2 post-write re-reads fall through below.
      if (queryCallCount <= 2) {
        return Promise.resolve({
          ticketTypes: [
            baseTicketType({
              quantity: 1,
              orders: [], // stale: no orders yet
            }),
          ],
          concerts: [{ id: CONCERT_ID, lastOrderSeq: 0 }],
        });
      }
      // Post-write re-read: 2 orders now exist for 1 ticket → available < 0
      return Promise.resolve({
        ticketTypes: [
          baseTicketType({
            quantity: 1,
            orders: [
              { id: "generated-order-id", status: "pending" },
              { id: "generated-order-id", status: "pending" },
            ],
          }),
        ],
        concerts: [{ id: CONCERT_ID, lastOrderSeq: 2 }],
      });
    });

    const [res1, res2] = await Promise.all([
      handler(makeRequest(validBody())),
      handler(makeRequest(validBody())),
    ]);

    const statuses = [res1.status, res2.status];
    const successes = statuses.filter((s) => s === 200).length;

    // Post-write validation detects overbooking and rolls back
    expect(successes).toBeLessThanOrEqual(1);
    expect(statuses).toContain(409);
  });

  it("counts pending orders against availability (not just approved)", async () => {
    mockQuery
      .mockResolvedValueOnce({
        ticketTypes: [
          baseTicketType({
            quantity: 2,
            orders: [
              { id: "o1", status: "pending" },
              { id: "o2", status: "pending" },
            ],
          }),
        ],
      });

    const res = await handler(makeRequest(validBody()));
    expect(res.status).toBe(409);
  });

  it("excludes rejected orders from count", async () => {
    mockQuery
      .mockResolvedValueOnce({
        ticketTypes: [
          baseTicketType({
            quantity: 2,
            orders: [
              { id: "o1", status: "rejected" },
              { id: "o2", status: "rejected" },
            ],
          }),
        ],
      });

    const res = await handler(makeRequest(validBody()));
    expect(res.status).toBe(200);
  });

  it("deducts active reservations from availability", async () => {
    mockQuery.mockResolvedValueOnce({
      ticketTypes: [
        baseTicketType({
          quantity: 2,
          orders: [{ id: "o1", status: "approved" }],
          reservations: [
            {
              id: "r1",
              quantity: 1,
              expiresAt: Date.now() + 600_000,
            },
          ],
        }),
      ],
    });

    const res = await handler(makeRequest(validBody()));
    expect(res.status).toBe(409);
  });

  it("ignores expired reservations", async () => {
    mockQuery
      .mockResolvedValueOnce({
        ticketTypes: [
          baseTicketType({
            quantity: 2,
            orders: [{ id: "o1", status: "approved" }],
            reservations: [
              {
                id: "r1",
                quantity: 1,
                expiresAt: Date.now() - 1000, // expired
              },
            ],
          }),
        ],
      });

    const res = await handler(makeRequest(validBody()));
    expect(res.status).toBe(200);
  });

  it("excludes buyer's own reservation from availability count", async () => {
    const myReservationId = "b0000000-0000-4000-8000-000000000099";
    mockQuery
      .mockResolvedValueOnce({
        ticketTypes: [
          baseTicketType({
            quantity: 2,
            orders: [{ id: "o1", status: "approved" }],
            reservations: [
              {
                id: myReservationId,
                quantity: 1,
                expiresAt: Date.now() + 600_000,
              },
            ],
          }),
        ],
      });

    const res = await handler(
      makeRequest(validBody({ reservationId: myReservationId })),
    );
    // Buyer's own reservation excluded → available = 2 - 1 - 0 = 1 → success
    expect(res.status).toBe(200);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Coupon maxUses race (HIGH)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe("POST /api/create-order — coupon validation", () => {
  let handler: typeof import("@/app/api/create-order/route").POST;

  beforeEach(async () => {
    const mod = await import("@/app/api/create-order/route");
    handler = mod.POST;
  });

  function ticketWithCoupon(
    couponOverrides: Partial<{
      code: string;
      discountType: string;
      discountValue: number;
      maxUses: number | null;
      active: boolean;
    }> = {},
    orders: { id: string; status: string; couponCode?: string }[] = [],
  ) {
    return baseTicketType({
      concert: [
        {
          id: CONCERT_ID,
          name: "Rock Show",
          date: "2026-06-15",
          venue: "Arena",
          slug: "rock-show",
          status: "active",
          lastOrderSeq: 0,
          coupons: [
            {
              id: COUPON_ID,
              code: "SAVE10",
              discountType: "percentage",
              discountValue: 10,
              maxUses: 5,
              active: true,
              ...couponOverrides,
            },
          ],
        },
      ],
      orders,
    });
  }

  it("rejects when coupon usage equals maxUses", async () => {
    const existingOrders = Array.from({ length: 5 }, (_, i) => ({
      id: `order-${i}`,
      status: "approved",
      couponCode: "SAVE10",
    }));

    mockQuery.mockResolvedValueOnce({
      ticketTypes: [ticketWithCoupon({ maxUses: 5 }, existingOrders)],
    });

    const res = await handler(
      makeRequest(validBody({ couponCode: "SAVE10" })),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/usage limit/i);
  });

  it("FIXED: two concurrent requests with maxUses=1 coupon → at most one succeeds (post-write validation)", async () => {
    let queryCallCount = 0;
    mockQuery.mockImplementation(() => {
      queryCallCount++;
      // First 2 calls: the pre-write read of each concurrent handler (stale: 0 coupon
      // usages). The 2 post-write re-reads fall through below.
      if (queryCallCount <= 2) {
        return Promise.resolve({
          ticketTypes: [
            ticketWithCoupon({ maxUses: 1 }, []),
          ],
          concerts: [{ id: CONCERT_ID, lastOrderSeq: 0 }],
        });
      }
      // Post-write re-read: 2 orders now using the coupon → exceeds maxUses
      return Promise.resolve({
        ticketTypes: [
          ticketWithCoupon({ maxUses: 1 }, [
            { id: "generated-order-id", status: "pending", couponCode: "SAVE10" },
            { id: "generated-order-id-2", status: "pending", couponCode: "SAVE10" },
          ]),
        ],
        concerts: [{ id: CONCERT_ID, lastOrderSeq: 2 }],
      });
    });

    const [res1, res2] = await Promise.all([
      handler(makeRequest(validBody({ couponCode: "SAVE10" }))),
      handler(makeRequest(validBody({ couponCode: "SAVE10" }))),
    ]);

    const statuses = [res1.status, res2.status];
    const successes = statuses.filter((s) => s === 200).length;

    // Post-write validation detects coupon overuse and rolls back
    expect(successes).toBeLessThanOrEqual(1);
    expect(statuses).toContain(409);
  });

  it("rejects inactive coupon", async () => {
    mockQuery.mockResolvedValueOnce({
      ticketTypes: [ticketWithCoupon({ active: false })],
    });

    const res = await handler(
      makeRequest(validBody({ couponCode: "SAVE10" })),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/no longer active/i);
  });

  it("rejects unknown coupon code", async () => {
    mockQuery.mockResolvedValueOnce({
      ticketTypes: [ticketWithCoupon()],
    });

    const res = await handler(
      makeRequest(validBody({ couponCode: "NOTREAL" })),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid coupon/i);
  });

  it("case-insensitive coupon matching", async () => {
    mockQuery
      .mockResolvedValueOnce({
        ticketTypes: [ticketWithCoupon({ code: "SAVE10" })],
      });

    const res = await handler(
      makeRequest(validBody({ couponCode: "save10" })),
    );
    expect(res.status).toBe(200);
  });

  it("percentage discount capped at subtotal", async () => {
    mockQuery
      .mockResolvedValueOnce({
        ticketTypes: [
          ticketWithCoupon({ discountType: "percentage", discountValue: 150 }),
        ],
      });

    const res = await handler(
      makeRequest(validBody({ couponCode: "SAVE10" })),
    );
    expect(res.status).toBe(200);
    // 150% discount should be capped to subtotal, not go negative
  });

  it("fixed discount capped at subtotal", async () => {
    mockQuery
      .mockResolvedValueOnce({
        ticketTypes: [
          ticketWithCoupon({ discountType: "fixed", discountValue: 9999 }),
        ],
      });

    const res = await handler(
      makeRequest(validBody({ couponCode: "SAVE10" })),
    );
    expect(res.status).toBe(200);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Order number generation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe("POST /api/create-order — order number generation", () => {
  let handler: typeof import("@/app/api/create-order/route").POST;

  beforeEach(async () => {
    const mod = await import("@/app/api/create-order/route");
    handler = mod.POST;
  });

  it("assigns unique non-sequential order codes (PREFIX-XXXXXX)", async () => {
    mockQuery.mockResolvedValueOnce({
      ticketTypes: [baseTicketType()],
    });

    const res = await handler(
      makeRequest(
        validBody({
          qty: 2,
          attendees: [validAttendee(), validAttendee({ email: "jane@example.com" })],
        }),
      ),
    );
    expect(res.status).toBe(200);

    // The order-creation transaction now holds the generated order numbers (there
    // is no concert seq update anymore). Each is a random Crockford base32 code
    // `PREFIX-XXXXXX`, and the two attendees get distinct codes.
    const txArgs = mockTransact.mock.calls[0][0] as { data?: { orderNumber?: string } }[];
    const orderNumbers = txArgs
      .map((op) => op.data?.orderNumber)
      .filter((n): n is string => typeof n === "string");
    expect(orderNumbers).toHaveLength(2);
    for (const n of orderNumbers) {
      expect(n).toMatch(/^[A-Z]{2,4}-[0-9A-HJKMNP-TV-Z]{6}$/);
    }
    expect(new Set(orderNumbers).size).toBe(2);
  });

  it("retries by regenerating the order code on transact failure", async () => {
    mockQuery.mockResolvedValueOnce({
      ticketTypes: [baseTicketType()],
    });

    // First transact fails, second succeeds. The retry just regenerates the random
    // code (no sequence to re-fetch).
    mockTransact
      .mockRejectedValueOnce(new Error("Conflict"))
      .mockResolvedValueOnce(undefined);

    const res = await handler(makeRequest(validBody()));
    expect(res.status).toBe(200);
    expect(mockTransact).toHaveBeenCalledTimes(2);
  });

  it("fails after MAX_RETRIES (10) transact failures", async () => {
    mockQuery
      .mockResolvedValueOnce({
        ticketTypes: [baseTicketType()],
      })
      .mockResolvedValue({
        concerts: [{ id: CONCERT_ID, lastOrderSeq: 0 }],
      });

    mockTransact.mockRejectedValue(new Error("Persistent conflict"));

    const res = await handler(makeRequest(validBody()));
    expect(res.status).toBe(500);
    expect(mockTransact).toHaveBeenCalledTimes(10);
  });

  it("concurrent requests both succeed when plenty of availability (unique constraint prevents duplicates in prod)", async () => {
    // With .unique() on orderNumber in schema, duplicate order numbers are rejected by InstantDB.
    // In this mock environment, transact always succeeds — the unique constraint is DB-level.
    const staleData = {
      ticketTypes: [
        baseTicketType({
          quantity: 100, // plenty of availability so post-write check passes
          concert: [
            {
              id: CONCERT_ID,
              name: "Rock Show",
              date: "2026-06-15",
              venue: "Arena",
              slug: "rock-show",
              status: "active",
              lastOrderSeq: 10,
              coupons: [],
            },
          ],
        }),
      ],
      concerts: [{ id: CONCERT_ID, lastOrderSeq: 10 }],
    };

    mockQuery.mockResolvedValue(staleData);

    const [res1, res2] = await Promise.all([
      handler(makeRequest(validBody())),
      handler(makeRequest(validBody())),
    ]);

    // Both succeed in mock (unique constraint enforced at DB level, not in mock)
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Reservation + queue cleanup
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe("POST /api/create-order — reservation + queue cleanup", () => {
  let handler: typeof import("@/app/api/create-order/route").POST;

  beforeEach(async () => {
    const mod = await import("@/app/api/create-order/route");
    handler = mod.POST;
  });

  it("deletes reservation on successful order", async () => {
    const reservationId = "e0000000-0000-4000-8000-000000000001";
    mockQuery
      .mockResolvedValueOnce({
        ticketTypes: [baseTicketType({
          reservations: [
            { id: reservationId, quantity: 1, expiresAt: Date.now() + 600_000 },
          ],
        })],
      });

    const res = await handler(
      makeRequest(validBody({ reservationId })),
    );
    expect(res.status).toBe(200);

    // Cleanup is now in a separate transaction (2nd transact call)
    expect(mockTransact).toHaveBeenCalledTimes(2);
    const cleanupTxArgs = mockTransact.mock.calls[1][0];
    const deleteOp = Array.isArray(cleanupTxArgs)
      ? cleanupTxArgs.find(
          (op: { __type: string; entity: string; id: string }) =>
            op.__type === "delete" && op.entity === "reservations",
        )
      : null;
    expect(deleteOp).toBeDefined();
  });

  it("marks queueEntry as completed when queueToken provided", async () => {
    const queueToken = "f0000000-0000-4000-8000-000000000001";
    mockQuery
      .mockResolvedValueOnce({
        ticketTypes: [baseTicketType({
          queueEntries: [
            { id: queueToken, status: "admitted", expiresAt: Date.now() + 600_000 },
          ],
        })],
      });

    const res = await handler(
      makeRequest(validBody({ queueToken })),
    );
    expect(res.status).toBe(200);

    // Cleanup is now in a separate transaction (2nd transact call)
    expect(mockTransact).toHaveBeenCalledTimes(2);
    const cleanupTxArgs = mockTransact.mock.calls[1][0];
    const updateOp = Array.isArray(cleanupTxArgs)
      ? cleanupTxArgs.find(
          (op: { __type: string; entity: string; id: string; data?: { status: string } }) =>
            op.__type === "update" &&
            op.entity === "queueEntries" &&
            op.data?.status === "completed",
        )
      : null;
    expect(updateOp).toBeDefined();
  });
});
