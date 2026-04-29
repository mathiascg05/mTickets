import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { QUEUE_THRESHOLD } from "../queueConstants";

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
  id: () => "generated-reservation-id",
}));

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(
    new URL("/api/create-reservation", "http://localhost:3000"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

const VALID_UUID = "a0000000-0000-4000-8000-000000000001";

function validBody(override: Record<string, unknown> = {}) {
  return {
    ticketTypeId: VALID_UUID,
    qty: 1,
    ...override,
  };
}

function baseTicketType(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_UUID,
    name: "General",
    price: 50,
    quantity: 100,
    concert: { id: "concert-1", status: "active" },
    orders: [],
    phases: [],
    reservations: [],
    queueEntries: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
  mockTransact.mockReset();
  mockTransact.mockResolvedValue(undefined);
  mockQuery.mockResolvedValue({ ticketTypes: [] });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Availability race
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe("POST /api/create-reservation — availability", () => {
  let handler: typeof import("@/app/api/create-reservation/route").POST;

  beforeEach(async () => {
    const mod = await import("@/app/api/create-reservation/route");
    handler = mod.POST;
  });

  it("succeeds when tickets are available", async () => {
    mockQuery.mockResolvedValueOnce({
      ticketTypes: [baseTicketType()],
    });

    const res = await handler(makeRequest(validBody()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reservationId).toBeDefined();
    expect(body.expiresAt).toBeGreaterThan(Date.now());
  });

  it("rejects when not enough tickets", async () => {
    mockQuery.mockResolvedValueOnce({
      ticketTypes: [
        baseTicketType({
          quantity: 5,
          orders: Array.from({ length: 5 }, (_, i) => ({
            id: `o-${i}`,
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

  it("two concurrent reservations for last ticket → both succeed (post-write validation removed, create-order is the final guard)", async () => {
    mockQuery.mockResolvedValue({
      ticketTypes: [
        baseTicketType({
          quantity: 1,
          orders: [],
          reservations: [],
        }),
      ],
    });

    const [res1, res2] = await Promise.all([
      handler(makeRequest(validBody())),
      handler(makeRequest(validBody())),
    ]);

    // Both reservations succeed — create-order handles final overbooking check
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });

  it("counts active reservations against availability", async () => {
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
    mockQuery.mockResolvedValueOnce({
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
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Queue gating edge cases
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe("POST /api/create-reservation — queue gating", () => {
  let handler: typeof import("@/app/api/create-reservation/route").POST;

  beforeEach(async () => {
    const mod = await import("@/app/api/create-reservation/route");
    handler = mod.POST;
  });

  it("allows reservation without queue token when queue inactive (activeBuyers < QUEUE_THRESHOLD and no waiters)", async () => {
    mockQuery.mockResolvedValueOnce({
      ticketTypes: [
        baseTicketType({
          queueEntries: [
            // Only 1 admitted (below threshold of 3)
            {
              id: "qe1",
              status: "admitted",
              expiresAt: Date.now() + 300_000,
            },
          ],
          reservations: [
            // 1 active reservation (activeBuyers = 1 reservation + 1 admitted = 2 < 3)
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
    expect(res.status).toBe(200);
  });

  it("rejects without token when activeBuyers >= QUEUE_THRESHOLD", async () => {
    const admittedEntries = Array.from({ length: QUEUE_THRESHOLD }, (_, i) => ({
      id: `qe-${i}`,
      status: "admitted",
      expiresAt: Date.now() + 300_000,
    }));

    mockQuery.mockResolvedValueOnce({
      ticketTypes: [
        baseTicketType({
          queueEntries: admittedEntries,
          // activeBuyers = 0 reservations + QUEUE_THRESHOLD admitted = QUEUE_THRESHOLD
        }),
      ],
    });

    const res = await handler(makeRequest(validBody()));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/queue/i);
  });

  it("rejects without token when waiters exist (even if buyers < threshold)", async () => {
    mockQuery.mockResolvedValueOnce({
      ticketTypes: [
        baseTicketType({
          queueEntries: [
            // Only 1 admitted, but there's a waiter
            {
              id: "qe1",
              status: "admitted",
              expiresAt: Date.now() + 300_000,
            },
            {
              id: "qe2",
              status: "waiting",
              expiresAt: Date.now() + 300_000,
            },
          ],
        }),
      ],
    });

    const res = await handler(makeRequest(validBody()));
    expect(res.status).toBe(403);
  });

  it("accepts valid admitted queue token", async () => {
    const queueTokenId = "f0000000-0000-4000-8000-000000000001";
    mockQuery.mockResolvedValueOnce({
      ticketTypes: [
        baseTicketType({
          queueEntries: [
            {
              id: queueTokenId,
              status: "admitted",
              expiresAt: Date.now() + 300_000,
            },
            // Some waiters to make queue active
            {
              id: "qe-waiter",
              status: "waiting",
              expiresAt: Date.now() + 300_000,
            },
          ],
        }),
      ],
    });

    const res = await handler(
      makeRequest(validBody({ queueToken: queueTokenId })),
    );
    expect(res.status).toBe(200);
  });

  it("rejects expired queue token", async () => {
    const queueTokenId = "f0000000-0000-4000-8000-000000000002";
    mockQuery.mockResolvedValueOnce({
      ticketTypes: [
        baseTicketType({
          queueEntries: [
            {
              id: queueTokenId,
              status: "admitted",
              expiresAt: Date.now() - 1000, // expired
            },
            {
              id: "qe-waiter",
              status: "waiting",
              expiresAt: Date.now() + 300_000,
            },
          ],
        }),
      ],
    });

    const res = await handler(
      makeRequest(validBody({ queueToken: queueTokenId })),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/invalid or expired/i);
  });

  it("rejects token with wrong status (waiting instead of admitted)", async () => {
    const queueTokenId = "f0000000-0000-4000-8000-000000000003";
    mockQuery.mockResolvedValueOnce({
      ticketTypes: [
        baseTicketType({
          queueEntries: [
            {
              id: queueTokenId,
              status: "waiting", // not admitted
              expiresAt: Date.now() + 300_000,
            },
            {
              id: "qe-other-waiter",
              status: "waiting",
              expiresAt: Date.now() + 300_000,
            },
          ],
        }),
      ],
    });

    const res = await handler(
      makeRequest(validBody({ queueToken: queueTokenId })),
    );
    expect(res.status).toBe(403);
  });

  it("rejects unknown queue token ID", async () => {
    const unknownId = "f0000000-0000-4000-8000-000000000099";
    mockQuery.mockResolvedValueOnce({
      ticketTypes: [
        baseTicketType({
          queueEntries: [
            {
              id: "qe-real",
              status: "waiting",
              expiresAt: Date.now() + 300_000,
            },
          ],
        }),
      ],
    });

    const res = await handler(
      makeRequest(validBody({ queueToken: unknownId })),
    );
    expect(res.status).toBe(403);
  });

  it("exactly at QUEUE_THRESHOLD boundary: activeBuyers == QUEUE_THRESHOLD triggers queue", async () => {
    // activeBuyers = reservations + admitted = QUEUE_THRESHOLD exactly
    const reservations = Array.from(
      { length: QUEUE_THRESHOLD - 1 },
      (_, i) => ({
        id: `r-${i}`,
        quantity: 1,
        expiresAt: Date.now() + 600_000,
      }),
    );

    mockQuery.mockResolvedValueOnce({
      ticketTypes: [
        baseTicketType({
          reservations,
          queueEntries: [
            {
              id: "qe-admitted",
              status: "admitted",
              expiresAt: Date.now() + 300_000,
            },
          ],
          // activeBuyers = (QUEUE_THRESHOLD-1) reservations + 1 admitted = QUEUE_THRESHOLD
        }),
      ],
    });

    const res = await handler(makeRequest(validBody()));
    expect(res.status).toBe(403);
  });

  it("below QUEUE_THRESHOLD boundary: activeBuyers == QUEUE_THRESHOLD - 1 allows without token", async () => {
    const reservations = Array.from(
      { length: QUEUE_THRESHOLD - 2 },
      (_, i) => ({
        id: `r-${i}`,
        quantity: 1,
        expiresAt: Date.now() + 600_000,
      }),
    );

    mockQuery.mockResolvedValueOnce({
      ticketTypes: [
        baseTicketType({
          reservations,
          queueEntries: [
            {
              id: "qe-admitted",
              status: "admitted",
              expiresAt: Date.now() + 300_000,
            },
          ],
          // activeBuyers = (QUEUE_THRESHOLD-2) + 1 = QUEUE_THRESHOLD - 1 < QUEUE_THRESHOLD
        }),
      ],
    });

    const res = await handler(makeRequest(validBody()));
    expect(res.status).toBe(200);
  });

  it("expired waiters don't activate queue", async () => {
    mockQuery.mockResolvedValueOnce({
      ticketTypes: [
        baseTicketType({
          queueEntries: [
            {
              id: "qe-expired-waiter",
              status: "waiting",
              expiresAt: Date.now() - 1000, // expired
            },
          ],
        }),
      ],
    });

    // No active waiters, no active buyers → queue not active
    const res = await handler(makeRequest(validBody()));
    expect(res.status).toBe(200);
  });
});
