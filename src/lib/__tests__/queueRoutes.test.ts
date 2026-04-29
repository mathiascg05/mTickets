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

vi.mock("@/lib/queueAdmission", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queueAdmission")>();
  return {
    ...actual,
    processQueueAdmissions: vi.fn().mockResolvedValue({ expired: 0, admitted: 0 }),
  };
});

vi.mock("@instantdb/admin", () => ({
  id: () => "generated-uuid",
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
  vi.clearAllMocks();
  mockTransact.mockResolvedValue(undefined);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Heartbeat route
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe("POST /api/queue-heartbeat", () => {
  let handler: typeof import("@/app/api/queue-heartbeat/route").POST;

  beforeEach(async () => {
    const mod = await import("@/app/api/queue-heartbeat/route");
    handler = mod.POST;
  });

  it("returns 400 for invalid queueEntryId", async () => {
    const req = makeRequest("/api/queue-heartbeat", {
      queueEntryId: "not-a-uuid",
    });
    const res = await handler(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid/i);
  });

  it("returns 404 when entry does not exist", async () => {
    mockQuery.mockResolvedValueOnce({ queueEntries: [] });

    const req = makeRequest("/api/queue-heartbeat", {
      queueEntryId: VALID_UUID,
    });
    const res = await handler(req);
    expect(res.status).toBe(404);
  });

  it("returns current status for expired/completed entries without extending TTL", async () => {
    mockQuery.mockResolvedValueOnce({
      queueEntries: [
        {
          id: VALID_UUID,
          status: "completed",
          ticketType: { queueEntries: [] },
          expiresAt: Date.now() - 1000,
        },
      ],
    });

    const req = makeRequest("/api/queue-heartbeat", {
      queueEntryId: VALID_UUID,
    });
    const res = await handler(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("completed");
    expect(body.position).toBe(0);
    expect(body.totalWaiting).toBe(0);
    expect(mockTransact).not.toHaveBeenCalled();
  });

  it("extends TTL with WAITING_TTL for waiting entries and returns position", async () => {
    const now = Date.now();
    mockQuery.mockResolvedValueOnce({
      queueEntries: [
        {
          id: VALID_UUID,
          status: "waiting",
          position: 5,
          expiresAt: now + 60_000,
          ticketType: {
            queueEntries: [
              { id: "e-1", status: "waiting", position: 3, expiresAt: now + 60_000 },
              { id: "e-2", status: "waiting", position: 4, expiresAt: now + 60_000 },
              { id: VALID_UUID, status: "waiting", position: 5, expiresAt: now + 60_000 },
              { id: "e-3", status: "admitted", position: 1, expiresAt: now + 60_000 },
            ],
          },
        },
      ],
    });

    const before = Date.now();
    const req = makeRequest("/api/queue-heartbeat", {
      queueEntryId: VALID_UUID,
    });
    const res = await handler(req);
    const after = Date.now();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("waiting");
    expect(body.position).toBe(3); // 2 waiting ahead + 1
    expect(body.totalWaiting).toBe(3); // 3 waiting entries
    expect(body.estimatedWaitMin).toBe(1);
    expect(mockTransact).toHaveBeenCalledTimes(1);

    const txn = mockTransact.mock.calls[0][0];
    expect(txn.id).toBe(VALID_UUID);
    expect(txn.data.expiresAt).toBeGreaterThanOrEqual(before + WAITING_TTL);
    expect(txn.data.expiresAt).toBeLessThanOrEqual(after + WAITING_TTL);
  });

  it("extends TTL with ADMITTED_TTL for admitted entries", async () => {
    mockQuery.mockResolvedValueOnce({
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

    const before = Date.now();
    const req = makeRequest("/api/queue-heartbeat", {
      queueEntryId: VALID_UUID,
    });
    const res = await handler(req);
    const after = Date.now();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("admitted");
    expect(body.position).toBe(1); // admitted = position 1, 0 waiting ahead
    expect(mockTransact).toHaveBeenCalledTimes(1);

    const txn = mockTransact.mock.calls[0][0];
    expect(txn.id).toBe(VALID_UUID);
    expect(txn.data.expiresAt).toBeGreaterThanOrEqual(before + ADMITTED_TTL);
    expect(txn.data.expiresAt).toBeLessThanOrEqual(after + ADMITTED_TTL);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Join queue route
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe("POST /api/join-queue", () => {
  let handler: typeof import("@/app/api/join-queue/route").POST;

  beforeEach(async () => {
    const mod = await import("@/app/api/join-queue/route");
    handler = mod.POST;
  });

  it("returns 400 for invalid ticketTypeId", async () => {
    const req = makeRequest("/api/join-queue", {
      ticketTypeId: "bad",
      qty: 1,
      sessionId: "sess-1",
    });
    const res = await handler(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/ticketTypeId/i);
  });

  it("returns 400 for invalid qty", async () => {
    const req = makeRequest("/api/join-queue", {
      ticketTypeId: VALID_UUID,
      qty: 0,
      sessionId: "sess-1",
    });
    const res = await handler(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/qty/i);
  });

  it("returns 400 for invalid sessionId", async () => {
    const req = makeRequest("/api/join-queue", {
      ticketTypeId: VALID_UUID,
      qty: 1,
      sessionId: "",
    });
    const res = await handler(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/sessionId/i);
  });

  it("returns existing entry for same session (idempotent)", async () => {
    const existingEntry = {
      id: "existing-id",
      status: "waiting",
      position: 42,
      sessionId: "sess-1",
      ticketType: { id: VALID_UUID },
      expiresAt: Date.now() + 600_000,
    };

    mockQuery.mockResolvedValueOnce({ queueEntries: [existingEntry] });

    const req = makeRequest("/api/join-queue", {
      ticketTypeId: VALID_UUID,
      qty: 2,
      sessionId: "sess-1",
    });
    const res = await handler(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.queueEntryId).toBe("existing-id");
    expect(body.position).toBe(42);
    expect(body.status).toBe("waiting");
    // Should NOT have created a new entry
    expect(mockTransact).not.toHaveBeenCalled();
  });

  it("returns 404 when ticketType does not exist", async () => {
    mockQuery
      .mockResolvedValueOnce({ queueEntries: [] }) // no existing entry
      .mockResolvedValueOnce({ ticketTypes: [] }); // ticketType not found

    const req = makeRequest("/api/join-queue", {
      ticketTypeId: VALID_UUID,
      qty: 1,
      sessionId: "sess-1",
    });
    const res = await handler(req);
    expect(res.status).toBe(404);
  });

  it("creates new entry and returns position", async () => {
    mockQuery
      .mockResolvedValueOnce({ queueEntries: [] }) // no existing
      .mockResolvedValueOnce({
        ticketTypes: [
          {
            id: VALID_UUID,
            lastQueuePosition: 10,
            concert: { id: "c-1", status: "active" },
          },
        ],
      }) // ticketType found
      .mockResolvedValueOnce({
        queueEntries: [{ id: "generated-uuid", status: "waiting" }],
      }); // re-query after admission

    const req = makeRequest("/api/join-queue", {
      ticketTypeId: VALID_UUID,
      qty: 2,
      sessionId: "sess-1",
    });
    const res = await handler(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.queueEntryId).toBe("generated-uuid");
    expect(body.position).toBe(11); // lastQueuePosition + 1
    expect(body.status).toBe("waiting");
    expect(mockTransact).toHaveBeenCalledTimes(1);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Process queue cron route
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe("GET /api/cron/process-queue", () => {
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

  it("returns 401 without authorization header", async () => {
    const req = makeGetRequest("/api/cron/process-queue");
    const res = await handler(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong Bearer token", async () => {
    const req = makeGetRequest("/api/cron/process-queue", {
      authorization: "Bearer wrong-secret",
    });
    const res = await handler(req);
    expect(res.status).toBe(401);
  });

  it("returns 200 and processes ticket types with valid auth", async () => {
    mockQuery.mockResolvedValueOnce({
      queueEntries: [
        { id: "e-1", status: "waiting", ticketType: { id: "tt-1" } },
        { id: "e-2", status: "admitted", ticketType: { id: "tt-1" } },
        { id: "e-3", status: "waiting", ticketType: { id: "tt-2" } },
      ],
    });

    const { processQueueAdmissions } = await import("@/lib/queueAdmission");
    const mockProcess = vi.mocked(processQueueAdmissions);
    mockProcess
      .mockResolvedValueOnce({ expired: 1, admitted: 2 })
      .mockResolvedValueOnce({ expired: 0, admitted: 1 });

    const req = makeGetRequest("/api/cron/process-queue", {
      authorization: "Bearer test-secret",
    });
    const res = await handler(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.processed).toBe(2); // 2 unique ticketType IDs
    expect(body.results["tt-1"]).toEqual({ expired: 1, admitted: 2 });
    expect(body.results["tt-2"]).toEqual({ expired: 0, admitted: 1 });

    // Both ticket types processed (in parallel via Promise.all)
    expect(mockProcess).toHaveBeenCalledWith("tt-1");
    expect(mockProcess).toHaveBeenCalledWith("tt-2");
  });

  it("handles empty queue gracefully", async () => {
    mockQuery.mockResolvedValueOnce({ queueEntries: [] });

    const req = makeGetRequest("/api/cron/process-queue", {
      authorization: "Bearer test-secret",
    });
    const res = await handler(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed).toBe(0);
  });
});
