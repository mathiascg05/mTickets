import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { WAITING_TTL, ADMITTED_TTL } from "../queueConstants";

// ── Shared adminDb mock ──────────────────────────────────────────────────────
const mockQuery = vi.fn();
const mockTransact = vi.fn();

const makeUpdateProxy = () =>
  new Proxy(
    {},
    {
      get: (_target, id: string) => ({
        update: (data: Record<string, unknown>) => ({
          __type: "update",
          id,
          data,
          link: () => ({ __type: "link", id }),
        }),
      }),
    },
  );

vi.mock("@/lib/adminDb", () => ({
  adminDb: {
    query: (...args: unknown[]) => mockQuery(...args),
    transact: (...args: unknown[]) => mockTransact(...args),
    tx: {
      queueEntries: makeUpdateProxy(),
      ticketTypes: makeUpdateProxy(),
    },
  },
}));

const mockProcessQueueAdmissions = vi.fn().mockResolvedValue({ expired: 0, admitted: 0 });

vi.mock("@/lib/queueAdmission", () => ({
  processQueueAdmissions: (...args: unknown[]) => mockProcessQueueAdmissions(...args),
  MAX_CONCURRENT: 5,
  QUEUE_THRESHOLD: 3,
  WAITING_TTL: 600_000,
  ADMITTED_TTL: 300_000,
}));

let idCounter = 0;
vi.mock("@instantdb/admin", () => ({
  id: () => `generated-uuid-${++idCounter}`,
}));

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeRequest(url: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeGetRequest(
  url: string,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: "GET",
    headers,
  });
}

const VALID_UUID = "a0000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.resetAllMocks();
  mockTransact.mockResolvedValue(undefined);
  mockProcessQueueAdmissions.mockResolvedValue({ expired: 0, admitted: 0 });
  idCounter = 0;
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// join-queue stress tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe("POST /api/join-queue — stress tests", () => {
  let handler: typeof import("@/app/api/join-queue/route").POST;

  beforeEach(async () => {
    const mod = await import("@/app/api/join-queue/route");
    handler = mod.POST;
  });

  it("two concurrent joins from different sessions → both succeed", async () => {
    // Use query-shape-based mock (safe for concurrent interleaving)
    mockQuery.mockImplementation((queryObj: Record<string, unknown>) => {
      if ("ticketTypes" in queryObj) {
        return Promise.resolve({
          ticketTypes: [{ id: VALID_UUID, lastQueuePosition: 0, concert: { id: "c-1", status: "active" } }],
        });
      }
      // queueEntries queries
      const qeQuery = queryObj.queueEntries as Record<string, unknown> | undefined;
      if (qeQuery && "ticketType" in qeQuery) {
        // Existing entry check (has ticketType relation)
        return Promise.resolve({ queueEntries: [] });
      }
      // Re-read by ID
      return Promise.resolve({
        queueEntries: [{ id: "generated-uuid", status: "waiting" }],
      });
    });

    const [res1, res2] = await Promise.all([
      handler(makeRequest("/api/join-queue", { ticketTypeId: VALID_UUID, qty: 1, sessionId: "sess-A" })),
      handler(makeRequest("/api/join-queue", { ticketTypeId: VALID_UUID, qty: 1, sessionId: "sess-B" })),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    // Both should have created entries
    expect(mockTransact).toHaveBeenCalledTimes(2);
  });

  it("KNOWN LIMITATION: concurrent joins may read same lastQueuePosition → duplicate positions", async () => {
    // Both sessions read lastQueuePosition=0 simultaneously
    mockQuery.mockImplementation((queryObj: Record<string, unknown>) => {
      if ("ticketTypes" in queryObj) {
        return Promise.resolve({
          ticketTypes: [{ id: VALID_UUID, lastQueuePosition: 0, concert: { id: "c-1", status: "active" } }],
        });
      }
      const qeQuery = queryObj.queueEntries as Record<string, unknown> | undefined;
      if (qeQuery && "ticketType" in qeQuery) {
        return Promise.resolve({ queueEntries: [] });
      }
      return Promise.resolve({
        queueEntries: [{ id: "generated-uuid", status: "waiting" }],
      });
    });

    const [res1, res2] = await Promise.all([
      handler(makeRequest("/api/join-queue", { ticketTypeId: VALID_UUID, qty: 1, sessionId: "sess-A" })),
      handler(makeRequest("/api/join-queue", { ticketTypeId: VALID_UUID, qty: 1, sessionId: "sess-B" })),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const body1 = await res1.json();
    const body2 = await res2.json();
    // Both read lastQueuePosition=0, both get position=1 — known limitation
    expect(body1.position).toBe(1);
    expect(body2.position).toBe(1);
  });

  it("idempotent join: same session joins twice concurrently → both return same existing entry", async () => {
    const existingEntry = {
      id: "existing-entry-id",
      status: "waiting",
      position: 5,
      sessionId: "sess-A",
      ticketType: { id: VALID_UUID },
      expiresAt: Date.now() + 600_000,
    };

    // Both concurrent calls find the same existing entry
    mockQuery.mockResolvedValue({ queueEntries: [existingEntry] });

    const [res1, res2] = await Promise.all([
      handler(makeRequest("/api/join-queue", { ticketTypeId: VALID_UUID, qty: 1, sessionId: "sess-A" })),
      handler(makeRequest("/api/join-queue", { ticketTypeId: VALID_UUID, qty: 1, sessionId: "sess-A" })),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const body1 = await res1.json();
    const body2 = await res2.json();
    expect(body1.queueEntryId).toBe("existing-entry-id");
    expect(body2.queueEntryId).toBe("existing-entry-id");

    // No new entries created
    expect(mockTransact).not.toHaveBeenCalled();
  });

  it("join returns immediately admitted status when processQueueAdmissions admits the entry", async () => {
    mockQuery
      .mockResolvedValueOnce({ queueEntries: [] }) // no existing
      .mockResolvedValueOnce({
        ticketTypes: [{ id: VALID_UUID, lastQueuePosition: 0, concert: { id: "c-1", status: "active" } }],
      })
      .mockResolvedValueOnce({
        queueEntries: [{ id: "generated-uuid-1", status: "admitted" }], // admitted by processQueueAdmissions
      });

    const res = await handler(
      makeRequest("/api/join-queue", { ticketTypeId: VALID_UUID, qty: 1, sessionId: "sess-A" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("admitted");
    expect(mockProcessQueueAdmissions).toHaveBeenCalledWith(VALID_UUID);
  });

  it("join with lastQueuePosition = 0 → position = 1", async () => {
    mockQuery
      .mockResolvedValueOnce({ queueEntries: [] })
      .mockResolvedValueOnce({
        ticketTypes: [{ id: VALID_UUID, lastQueuePosition: 0, concert: { id: "c-1", status: "active" } }],
      })
      .mockResolvedValueOnce({
        queueEntries: [{ id: "generated-uuid-1", status: "waiting" }],
      });

    const res = await handler(
      makeRequest("/api/join-queue", { ticketTypeId: VALID_UUID, qty: 1, sessionId: "sess-A" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.position).toBe(1);
  });

  it("join with lastQueuePosition = null/undefined → defaults to 0, position = 1", async () => {
    mockQuery
      .mockResolvedValueOnce({ queueEntries: [] })
      .mockResolvedValueOnce({
        ticketTypes: [{ id: VALID_UUID, lastQueuePosition: undefined, concert: { id: "c-1", status: "active" } }],
      })
      .mockResolvedValueOnce({
        queueEntries: [{ id: "generated-uuid-1", status: "waiting" }],
      });

    const res = await handler(
      makeRequest("/api/join-queue", { ticketTypeId: VALID_UUID, qty: 1, sessionId: "sess-A" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.position).toBe(1);
  });

  it("rapid sequential joins (3 sessions) → positions are 1, 2, 3", async () => {
    let seqPosition = 0;
    mockQuery.mockImplementation((queryObj: Record<string, unknown>) => {
      if ("ticketTypes" in queryObj) {
        return Promise.resolve({
          ticketTypes: [{ id: VALID_UUID, lastQueuePosition: seqPosition++, concert: { id: "c-1", status: "active" } }],
        });
      }
      const qeQuery = queryObj.queueEntries as Record<string, unknown> | undefined;
      if (qeQuery && "ticketType" in qeQuery) {
        return Promise.resolve({ queueEntries: [] });
      }
      return Promise.resolve({
        queueEntries: [{ id: "generated-uuid", status: "waiting" }],
      });
    });

    const res1 = await handler(
      makeRequest("/api/join-queue", { ticketTypeId: VALID_UUID, qty: 1, sessionId: "sess-1" }),
    );
    const res2 = await handler(
      makeRequest("/api/join-queue", { ticketTypeId: VALID_UUID, qty: 1, sessionId: "sess-2" }),
    );
    const res3 = await handler(
      makeRequest("/api/join-queue", { ticketTypeId: VALID_UUID, qty: 1, sessionId: "sess-3" }),
    );

    const body1 = await res1.json();
    const body2 = await res2.json();
    const body3 = await res3.json();

    expect(body1.position).toBe(1);
    expect(body2.position).toBe(2);
    expect(body3.position).toBe(3);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// queue-heartbeat stress tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe("POST /api/queue-heartbeat — stress tests", () => {
  let handler: typeof import("@/app/api/queue-heartbeat/route").POST;

  beforeEach(async () => {
    const mod = await import("@/app/api/queue-heartbeat/route");
    handler = mod.POST;
  });

  it("concurrent heartbeats for same waiting entry → both succeed, TTL extended", async () => {
    const now = Date.now();
    mockQuery.mockResolvedValue({
      queueEntries: [
        {
          id: VALID_UUID,
          status: "waiting",
          position: 1,
          expiresAt: now + 60_000,
          ticketType: {
            queueEntries: [
              { id: VALID_UUID, status: "waiting", position: 1, expiresAt: now + 60_000 },
            ],
          },
        },
      ],
    });

    const [res1, res2] = await Promise.all([
      handler(makeRequest("/api/queue-heartbeat", { queueEntryId: VALID_UUID })),
      handler(makeRequest("/api/queue-heartbeat", { queueEntryId: VALID_UUID })),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    // Both extended TTL
    expect(mockTransact).toHaveBeenCalledTimes(2);

    // Verify TTL values are WAITING_TTL-based
    for (const call of mockTransact.mock.calls) {
      const txn = call[0];
      expect(txn.data.expiresAt).toBeGreaterThan(Date.now() + WAITING_TTL - 5000);
    }
  });

  it("concurrent heartbeats for same admitted entry → both succeed with ADMITTED_TTL", async () => {
    mockQuery.mockResolvedValue({
      queueEntries: [
        {
          id: VALID_UUID,
          status: "admitted",
          position: 1,
          expiresAt: Date.now() + 60_000,
          ticketType: { queueEntries: [] },
        },
      ],
    });

    const [res1, res2] = await Promise.all([
      handler(makeRequest("/api/queue-heartbeat", { queueEntryId: VALID_UUID })),
      handler(makeRequest("/api/queue-heartbeat", { queueEntryId: VALID_UUID })),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    expect(mockTransact).toHaveBeenCalledTimes(2);

    for (const call of mockTransact.mock.calls) {
      const txn = call[0];
      expect(txn.data.expiresAt).toBeGreaterThan(Date.now() + ADMITTED_TTL - 5000);
    }
  });

  it("heartbeat returns position info and triggers admission processing", async () => {
    const now = Date.now();
    mockQuery.mockResolvedValueOnce({
      queueEntries: [
        {
          id: VALID_UUID,
          status: "waiting",
          position: 3,
          expiresAt: now + 60_000,
          ticketType: {
            id: "tt-1",
            queueEntries: [
              { id: "e-1", status: "waiting", position: 1, expiresAt: now + 60_000 },
              { id: "e-2", status: "waiting", position: 2, expiresAt: now + 60_000 },
              { id: VALID_UUID, status: "waiting", position: 3, expiresAt: now + 60_000 },
            ],
          },
        },
      ],
    });

    const res = await handler(
      makeRequest("/api/queue-heartbeat", { queueEntryId: VALID_UUID, full: true }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("waiting");
    expect(body.position).toBe(3); // 2 ahead + 1
    expect(body.totalWaiting).toBe(3);
    expect(body.estimatedWaitMin).toBe(1);
    expect(mockProcessQueueAdmissions).toHaveBeenCalledWith("tt-1");
  });

  it("cheap heartbeat (full=false) extends TTL but does NOT process admissions or compute position", async () => {
    const now = Date.now();
    mockQuery.mockResolvedValueOnce({
      queueEntries: [
        {
          id: VALID_UUID,
          status: "waiting",
          position: 3,
          expiresAt: now + 60_000,
          ticketType: { id: "tt-1" },
        },
      ],
    });

    const res = await handler(
      makeRequest("/api/queue-heartbeat", { queueEntryId: VALID_UUID }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("waiting");
    expect(body.position).toBeNull(); // cliente conserva la última conocida
    expect(mockTransact).toHaveBeenCalledTimes(1); // TTL extendido
    expect(mockProcessQueueAdmissions).not.toHaveBeenCalled(); // sin escaneo pesado
  });

  it("heartbeat right at expiry boundary (expiresAt = Date.now()) → still extends", async () => {
    const now = Date.now();
    mockQuery.mockResolvedValueOnce({
      queueEntries: [
        {
          id: VALID_UUID,
          status: "waiting",
          position: 1,
          expiresAt: now, // exactly at boundary
          ticketType: {
            queueEntries: [
              { id: VALID_UUID, status: "waiting", position: 1, expiresAt: now },
            ],
          },
        },
      ],
    });

    const res = await handler(
      makeRequest("/api/queue-heartbeat", { queueEntryId: VALID_UUID }),
    );

    expect(res.status).toBe(200);
    // TTL was extended (route checks status, not expiresAt)
    expect(mockTransact).toHaveBeenCalledTimes(1);
    const txn = mockTransact.mock.calls[0][0];
    expect(txn.data.expiresAt).toBeGreaterThan(now);
  });

  it("heartbeat triggers processQueueAdmissions to advance the queue", async () => {
    mockQuery.mockResolvedValueOnce({
      queueEntries: [
        {
          id: VALID_UUID,
          status: "waiting",
          position: 1,
          expiresAt: Date.now() + 60_000,
          ticketType: { id: "tt-1", queueEntries: [] },
        },
      ],
    });

    await handler(makeRequest("/api/queue-heartbeat", { queueEntryId: VALID_UUID, full: true }));

    expect(mockProcessQueueAdmissions).toHaveBeenCalledWith("tt-1");
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// process-queue cron stress tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe("GET /api/cron/process-queue — stress tests", () => {
  let handler: typeof import("@/app/api/cron/process-queue/route").GET;
  const originalEnv = process.env.CRON_SECRET;

  beforeEach(async () => {
    process.env.CRON_SECRET = "test-secret";
    const mod = await import("@/app/api/cron/process-queue/route");
    handler = mod.GET;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.CRON_SECRET = originalEnv;
    } else {
      delete process.env.CRON_SECRET;
    }
  });

  it("concurrent cron executions → both succeed, processQueueAdmissions called for each", async () => {
    mockQuery.mockResolvedValue({
      queueEntries: [
        { id: "e-1", status: "waiting", ticketType: { id: "tt-1" } },
      ],
    });
    mockProcessQueueAdmissions.mockResolvedValue({ expired: 0, admitted: 1 });

    const req1 = makeGetRequest("/api/cron/process-queue", {
      authorization: "Bearer test-secret",
    });
    const req2 = makeGetRequest("/api/cron/process-queue", {
      authorization: "Bearer test-secret",
    });

    const [res1, res2] = await Promise.all([handler(req1), handler(req2)]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    // Both invocations process the same ticketType
    expect(mockProcessQueueAdmissions).toHaveBeenCalledWith("tt-1");
    expect(mockProcessQueueAdmissions).toHaveBeenCalledTimes(2);
  });

  it("cron with entries spanning 3+ ticket types → all processed in parallel", async () => {
    mockQuery.mockResolvedValueOnce({
      queueEntries: [
        { id: "e-1", status: "waiting", ticketType: { id: "tt-1" } },
        { id: "e-2", status: "waiting", ticketType: { id: "tt-2" } },
        { id: "e-3", status: "admitted", ticketType: { id: "tt-3" } },
      ],
    });

    mockProcessQueueAdmissions
      .mockResolvedValueOnce({ expired: 1, admitted: 0 })
      .mockResolvedValueOnce({ expired: 0, admitted: 1 })
      .mockResolvedValueOnce({ expired: 0, admitted: 0 });

    const res = await handler(
      makeGetRequest("/api/cron/process-queue", {
        authorization: "Bearer test-secret",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed).toBe(3);

    // All 3 ticket types processed
    expect(mockProcessQueueAdmissions).toHaveBeenCalledTimes(3);
    expect(mockProcessQueueAdmissions).toHaveBeenCalledWith("tt-1");
    expect(mockProcessQueueAdmissions).toHaveBeenCalledWith("tt-2");
    expect(mockProcessQueueAdmissions).toHaveBeenCalledWith("tt-3");
  });

  it("cron when processQueueAdmissions throws for one ticketType → whole request fails", async () => {
    mockQuery.mockResolvedValueOnce({
      queueEntries: [
        { id: "e-1", status: "waiting", ticketType: { id: "tt-1" } },
        { id: "e-2", status: "waiting", ticketType: { id: "tt-2" } },
      ],
    });

    mockProcessQueueAdmissions
      .mockResolvedValueOnce({ expired: 0, admitted: 1 })
      .mockRejectedValueOnce(new Error("DB connection lost"));

    const res = await handler(
      makeGetRequest("/api/cron/process-queue", {
        authorization: "Bearer test-secret",
      }),
    );

    // Promise.all rejects if any promise rejects → caught by try/catch → 500
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/failed/i);
  });

  it("cron with duplicate ticketType entries → deduplication works, only called once per ID", async () => {
    mockQuery.mockResolvedValueOnce({
      queueEntries: [
        { id: "e-1", status: "waiting", ticketType: { id: "tt-1" } },
        { id: "e-2", status: "admitted", ticketType: { id: "tt-1" } },
        { id: "e-3", status: "waiting", ticketType: { id: "tt-1" } },
      ],
    });

    mockProcessQueueAdmissions.mockResolvedValueOnce({ expired: 0, admitted: 1 });

    const res = await handler(
      makeGetRequest("/api/cron/process-queue", {
        authorization: "Bearer test-secret",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed).toBe(1); // deduped to 1

    // processQueueAdmissions called only once despite 3 entries for same ticketType
    expect(mockProcessQueueAdmissions).toHaveBeenCalledTimes(1);
    expect(mockProcessQueueAdmissions).toHaveBeenCalledWith("tt-1");
  });
});
