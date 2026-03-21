import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
              }),
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

// Mock scannerToken functions — we'll override per-test when needed
const mockVerifyScannerToken = vi.fn();
const mockCreateScannerToken = vi.fn();

vi.mock("@/lib/scannerToken", () => ({
  verifyScannerToken: (...args: unknown[]) => mockVerifyScannerToken(...args),
  createScannerToken: (...args: unknown[]) => mockCreateScannerToken(...args),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeRequest(url: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_ORDER_ID = "a0000000-0000-4000-8000-000000000001";
const CONCERT_ID = "c0000000-0000-4000-8000-000000000001";
const OTHER_CONCERT_ID = "c0000000-0000-4000-8000-000000000099";

beforeEach(() => {
  vi.clearAllMocks();
  mockTransact.mockResolvedValue(undefined);
  process.env.NEXT_PUBLIC_ADMIN_EMAIL = "admin@example.com";
  process.env.INSTANT_APP_ADMIN_TOKEN = "test-admin-token";
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// mark-visited
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe("POST /api/mark-visited", () => {
  let handler: typeof import("@/app/api/mark-visited/route").POST;

  beforeEach(async () => {
    const mod = await import("@/app/api/mark-visited/route");
    handler = mod.POST;
  });

  it("marks visited with valid admin email", async () => {
    mockQuery.mockResolvedValueOnce({
      orders: [
        {
          id: VALID_ORDER_ID,
          status: "approved",
          visited: false,
          ticketType: { concert: { id: CONCERT_ID, organizerEmail: "admin@example.com" } },
        },
      ],
    });

    const res = await handler(
      makeRequest("/api/mark-visited", {
        orderId: VALID_ORDER_ID,
        userEmail: "admin@example.com",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockTransact).toHaveBeenCalledTimes(1);
  });

  it("marks visited with valid scanner token", async () => {
    mockVerifyScannerToken.mockReturnValue({ concertId: CONCERT_ID });
    mockQuery.mockResolvedValueOnce({
      orders: [
        {
          id: VALID_ORDER_ID,
          status: "approved",
          visited: false,
          ticketType: { concert: { id: CONCERT_ID, organizerEmail: "admin@example.com" } },
        },
      ],
    });

    const res = await handler(
      makeRequest("/api/mark-visited", {
        orderId: VALID_ORDER_ID,
        scannerToken: "valid-token",
      }),
    );
    expect(res.status).toBe(200);
    expect(mockTransact).toHaveBeenCalledTimes(1);
  });

  it("rejects with neither auth method → 401", async () => {
    const res = await handler(
      makeRequest("/api/mark-visited", {
        orderId: VALID_ORDER_ID,
      }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/unauthorized/i);
  });

  it("rejects invalid scanner token → 401", async () => {
    mockVerifyScannerToken.mockReturnValue(null);

    const res = await handler(
      makeRequest("/api/mark-visited", {
        orderId: VALID_ORDER_ID,
        scannerToken: "bad-token",
      }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/invalid or expired/i);
  });

  it("rejects scanner token for wrong concert → 403", async () => {
    mockVerifyScannerToken.mockReturnValue({ concertId: CONCERT_ID });
    mockQuery.mockResolvedValueOnce({
      orders: [
        {
          id: VALID_ORDER_ID,
          ticketType: { concert: { id: OTHER_CONCERT_ID, organizerEmail: "other@example.com" } },
        },
      ],
    });

    const res = await handler(
      makeRequest("/api/mark-visited", {
        orderId: VALID_ORDER_ID,
        scannerToken: "valid-token-wrong-concert",
      }),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/wrong event/i);
  });

  it("super admin email bypasses concert scope restriction", async () => {
    mockQuery.mockResolvedValueOnce({
      orders: [
        {
          id: VALID_ORDER_ID,
          status: "approved",
          visited: false,
          ticketType: { concert: { id: OTHER_CONCERT_ID, organizerEmail: "other@example.com" } },
        },
      ],
    });

    const res = await handler(
      makeRequest("/api/mark-visited", {
        orderId: VALID_ORDER_ID,
        userEmail: "matickets.ve@gmail.com",
      }),
    );
    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("rejects non-organizer email → 401", async () => {
    mockQuery.mockResolvedValueOnce({
      orders: [
        {
          id: VALID_ORDER_ID,
          status: "approved",
          visited: false,
          ticketType: { concert: { id: CONCERT_ID, organizerEmail: "admin@example.com" } },
        },
      ],
    });

    const res = await handler(
      makeRequest("/api/mark-visited", {
        orderId: VALID_ORDER_ID,
        userEmail: "random@example.com",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("double mark-visited rejects second scan (409)", async () => {
    // First scan: order not yet visited
    mockQuery.mockResolvedValueOnce({
      orders: [
        {
          id: VALID_ORDER_ID,
          status: "approved",
          visited: false,
          ticketType: { concert: { id: CONCERT_ID, organizerEmail: "admin@example.com" } },
        },
      ],
    });
    // Second scan: order already visited
    mockQuery.mockResolvedValueOnce({
      orders: [
        {
          id: VALID_ORDER_ID,
          status: "approved",
          visited: true,
          ticketType: { concert: { id: CONCERT_ID, organizerEmail: "admin@example.com" } },
        },
      ],
    });

    const req1 = makeRequest("/api/mark-visited", {
      orderId: VALID_ORDER_ID,
      userEmail: "admin@example.com",
    });
    const req2 = makeRequest("/api/mark-visited", {
      orderId: VALID_ORDER_ID,
      userEmail: "admin@example.com",
    });

    const res1 = await handler(req1);
    const res2 = await handler(req2);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(409);
    expect(mockTransact).toHaveBeenCalledTimes(1);
  });

  it("returns 404 for non-existent order (scanner path)", async () => {
    mockVerifyScannerToken.mockReturnValue({ concertId: CONCERT_ID });
    mockQuery.mockResolvedValueOnce({ orders: [] });

    const res = await handler(
      makeRequest("/api/mark-visited", {
        orderId: VALID_ORDER_ID,
        scannerToken: "valid-token",
      }),
    );
    expect(res.status).toBe(404);
  });

  it("rejects missing orderId → 400", async () => {
    const res = await handler(
      makeRequest("/api/mark-visited", {
        userEmail: "admin@example.com",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects non-string orderId → 400", async () => {
    const res = await handler(
      makeRequest("/api/mark-visited", {
        orderId: 12345,
        userEmail: "admin@example.com",
      }),
    );
    expect(res.status).toBe(400);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// verify-scanner-pin
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe("POST /api/verify-scanner-pin", () => {
  let handler: typeof import("@/app/api/verify-scanner-pin/route").POST;

  beforeEach(async () => {
    const mod = await import("@/app/api/verify-scanner-pin/route");
    handler = mod.POST;
  });

  it("returns token for correct PIN", async () => {
    mockQuery.mockResolvedValueOnce({
      concerts: [
        {
          id: CONCERT_ID,
          name: "Rock Show",
          date: "2026-06-15",
          venue: "Arena",
          scannerPin: "1234",
        },
      ],
    });
    mockCreateScannerToken.mockReturnValue("mock-scanner-token");

    const res = await handler(
      makeRequest("/api/verify-scanner-pin", {
        concertId: CONCERT_ID,
        pin: "1234",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe("mock-scanner-token");
    expect(body.concert.id).toBe(CONCERT_ID);
    expect(body.concert.name).toBe("Rock Show");
  });

  it("rejects wrong PIN → 401", async () => {
    mockQuery.mockResolvedValueOnce({
      concerts: [
        {
          id: CONCERT_ID,
          name: "Rock Show",
          date: "2026-06-15",
          venue: "Arena",
          scannerPin: "1234",
        },
      ],
    });

    const res = await handler(
      makeRequest("/api/verify-scanner-pin", {
        concertId: CONCERT_ID,
        pin: "9999",
      }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/invalid pin/i);
  });

  it("rejects missing PIN → 400", async () => {
    const res = await handler(
      makeRequest("/api/verify-scanner-pin", {
        concertId: CONCERT_ID,
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/4-6 digits/i);
  });

  it("rejects non-digit PIN → 400", async () => {
    const res = await handler(
      makeRequest("/api/verify-scanner-pin", {
        concertId: CONCERT_ID,
        pin: "abcd",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects non-existent concert → 401", async () => {
    mockQuery.mockResolvedValueOnce({ concerts: [] });

    const res = await handler(
      makeRequest("/api/verify-scanner-pin", {
        concertId: CONCERT_ID,
        pin: "1234",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects concert with no PIN set → 401", async () => {
    mockQuery.mockResolvedValueOnce({
      concerts: [
        {
          id: CONCERT_ID,
          name: "Rock Show",
          date: "2026-06-15",
          venue: "Arena",
          // no scannerPin
        },
      ],
    });

    const res = await handler(
      makeRequest("/api/verify-scanner-pin", {
        concertId: CONCERT_ID,
        pin: "1234",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("handles PIN length mismatch correctly (constant-time comparison still works)", async () => {
    mockQuery.mockResolvedValueOnce({
      concerts: [
        {
          id: CONCERT_ID,
          name: "Rock Show",
          date: "2026-06-15",
          venue: "Arena",
          scannerPin: "123456", // 6-digit
        },
      ],
    });

    const res = await handler(
      makeRequest("/api/verify-scanner-pin", {
        concertId: CONCERT_ID,
        pin: "1234", // 4-digit (length mismatch)
      }),
    );
    expect(res.status).toBe(401);
  });

  it("FIXED: wrong PIN responses are delayed (brute-force deterrent)", async () => {
    mockQuery.mockResolvedValue({
      concerts: [
        {
          id: CONCERT_ID,
          name: "Rock Show",
          date: "2026-06-15",
          venue: "Arena",
          scannerPin: "1234",
        },
      ],
    });

    const start = Date.now();
    const res = await handler(
      makeRequest("/api/verify-scanner-pin", {
        concertId: CONCERT_ID,
        pin: "0000",
      }),
    );
    const elapsed = Date.now() - start;

    expect(res.status).toBe(401);
    // The 1s delay should be present (allow some margin for test execution)
    expect(elapsed).toBeGreaterThanOrEqual(900);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// verify-ticket-email
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe("POST /api/verify-ticket-email", () => {
  let handler: typeof import("@/app/api/verify-ticket-email/route").POST;

  beforeEach(async () => {
    const mod = await import("@/app/api/verify-ticket-email/route");
    handler = mod.POST;
  });

  it("returns verified: true for matching email", async () => {
    mockQuery.mockResolvedValueOnce({
      orders: [{ id: VALID_ORDER_ID, email: "john@example.com" }],
    });

    const res = await handler(
      makeRequest("/api/verify-ticket-email", {
        orderId: VALID_ORDER_ID,
        email: "john@example.com",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verified).toBe(true);
  });

  it("returns verified: false for wrong email", async () => {
    mockQuery.mockResolvedValueOnce({
      orders: [{ id: VALID_ORDER_ID, email: "john@example.com" }],
    });

    const res = await handler(
      makeRequest("/api/verify-ticket-email", {
        orderId: VALID_ORDER_ID,
        email: "wrong@example.com",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verified).toBe(false);
  });

  it("same response for non-existent order (prevents enumeration)", async () => {
    mockQuery.mockResolvedValueOnce({ orders: [] });

    const res = await handler(
      makeRequest("/api/verify-ticket-email", {
        orderId: "nonexistent-id",
        email: "john@example.com",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verified).toBe(false);
    // Same shape as a wrong-email response — no way to distinguish
  });

  it("case-insensitive + trimmed email comparison", async () => {
    mockQuery.mockResolvedValueOnce({
      orders: [{ id: VALID_ORDER_ID, email: "John@Example.COM" }],
    });

    const res = await handler(
      makeRequest("/api/verify-ticket-email", {
        orderId: VALID_ORDER_ID,
        email: "  john@example.com  ",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verified).toBe(true);
  });

  it("rejects missing orderId → 400", async () => {
    const res = await handler(
      makeRequest("/api/verify-ticket-email", {
        email: "john@example.com",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects missing email → 400", async () => {
    const res = await handler(
      makeRequest("/api/verify-ticket-email", {
        orderId: VALID_ORDER_ID,
      }),
    );
    expect(res.status).toBe(400);
  });
});
