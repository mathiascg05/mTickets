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

const mockVerifyToken = vi.fn();

vi.mock("@/lib/adminDb", () => ({
  adminDb: {
    query: (...args: unknown[]) => mockQuery(...args),
    transact: (...args: unknown[]) => mockTransact(...args),
    tx: makeUpdateProxy(),
    auth: { verifyToken: (...args: unknown[]) => mockVerifyToken(...args) },
  },
}));

vi.mock("@instantdb/admin", () => ({
  id: () => "generated-id",
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
    after: vi.fn(), // no-op — input validation tests don't need email sending
  };
});

vi.mock("@/lib/queueAdmission", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queueAdmission")>();
  return {
    ...actual,
    processQueueAdmissions: vi.fn().mockResolvedValue({ expired: 0, admitted: 0 }),
  };
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeRequest(url: string, body: Record<string, unknown>, extraHeaders?: Record<string, string>): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });
}

const VALID_UUID = "a0000000-0000-4000-8000-000000000001";
const CONCERT_ID = "c0000000-0000-4000-8000-000000000001";

function validAttendee(override: Partial<Record<string, string>> = {}) {
  return {
    firstName: "John",
    lastName: "Doe",
    email: "john@example.com",
    cedula: "12345678",
    ...override,
  };
}

function baseTicketType() {
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
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
  mockTransact.mockReset();
  mockTransact.mockResolvedValue(undefined);
  // Default catch-all: post-write validation queries get empty results → validation skipped
  mockQuery.mockResolvedValue({ ticketTypes: [], concerts: [], orders: [], emailSuppressions: [] });
  process.env.GMAIL_USER = "test@gmail.com";
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// create-order validation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe("POST /api/create-order — input validation", () => {
  let handler: typeof import("@/app/api/create-order/route").POST;

  beforeEach(async () => {
    const mod = await import("@/app/api/create-order/route");
    handler = mod.POST;
  });

  describe("ticketTypeId validation", () => {
    it("rejects empty ticketTypeId", async () => {
      const res = await handler(
        makeRequest("/api/create-order", {
          ticketTypeId: "",
          qty: 1,
          attendees: [validAttendee()],
          paymentMethodName: "Zelle",
        }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe("INVALID_TICKET_TYPE");
    });

    it("rejects integer ticketTypeId", async () => {
      const res = await handler(
        makeRequest("/api/create-order", {
          ticketTypeId: 12345,
          qty: 1,
          attendees: [validAttendee()],
          paymentMethodName: "Zelle",
        }),
      );
      expect(res.status).toBe(400);
    });

    it("rejects SQL injection string as ticketTypeId", async () => {
      const res = await handler(
        makeRequest("/api/create-order", {
          ticketTypeId: "'; DROP TABLE orders; --",
          qty: 1,
          attendees: [validAttendee()],
          paymentMethodName: "Zelle",
        }),
      );
      expect(res.status).toBe(400);
    });
  });

  describe("qty validation", () => {
    it("rejects qty = 0", async () => {
      const res = await handler(
        makeRequest("/api/create-order", {
          ticketTypeId: VALID_UUID,
          qty: 0,
          attendees: [],
          paymentMethodName: "Zelle",
        }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe("QTY_OUT_OF_RANGE");
    });

    it("rejects qty = -1", async () => {
      const res = await handler(
        makeRequest("/api/create-order", {
          ticketTypeId: VALID_UUID,
          qty: -1,
          attendees: [],
          paymentMethodName: "Zelle",
        }),
      );
      expect(res.status).toBe(400);
    });

    it("rejects qty = 11 (exceeds max)", async () => {
      const res = await handler(
        makeRequest("/api/create-order", {
          ticketTypeId: VALID_UUID,
          qty: 11,
          attendees: Array.from({ length: 11 }, () => validAttendee()),
          paymentMethodName: "Zelle",
        }),
      );
      expect(res.status).toBe(400);
    });

    it("rejects qty = 1.5 (non-integer)", async () => {
      const res = await handler(
        makeRequest("/api/create-order", {
          ticketTypeId: VALID_UUID,
          qty: 1.5,
          attendees: [validAttendee()],
          paymentMethodName: "Zelle",
        }),
      );
      expect(res.status).toBe(400);
    });

    it("rejects qty = NaN", async () => {
      const res = await handler(
        makeRequest("/api/create-order", {
          ticketTypeId: VALID_UUID,
          qty: NaN,
          attendees: [],
          paymentMethodName: "Zelle",
        }),
      );
      expect(res.status).toBe(400);
    });

    it("rejects qty as string", async () => {
      const res = await handler(
        makeRequest("/api/create-order", {
          ticketTypeId: VALID_UUID,
          qty: "1",
          attendees: [validAttendee()],
          paymentMethodName: "Zelle",
        }),
      );
      expect(res.status).toBe(400);
    });

    it("rejects qty = null", async () => {
      const res = await handler(
        makeRequest("/api/create-order", {
          ticketTypeId: VALID_UUID,
          qty: null,
          attendees: [],
          paymentMethodName: "Zelle",
        }),
      );
      expect(res.status).toBe(400);
    });
  });

  describe("attendees validation", () => {
    it("rejects attendees length mismatch", async () => {
      const res = await handler(
        makeRequest("/api/create-order", {
          ticketTypeId: VALID_UUID,
          qty: 2,
          attendees: [validAttendee()], // only 1 but qty is 2
          paymentMethodName: "Zelle",
        }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/attendees.*match/i);
    });

    it("rejects empty firstName", async () => {
      const res = await handler(
        makeRequest("/api/create-order", {
          ticketTypeId: VALID_UUID,
          qty: 1,
          attendees: [validAttendee({ firstName: "" })],
          paymentMethodName: "Zelle",
        }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.details).toBeDefined();
    });

    it("rejects firstName with 101 chars", async () => {
      const res = await handler(
        makeRequest("/api/create-order", {
          ticketTypeId: VALID_UUID,
          qty: 1,
          attendees: [validAttendee({ firstName: "a".repeat(101) })],
          paymentMethodName: "Zelle",
        }),
      );
      expect(res.status).toBe(400);
    });

    it("rejects firstName containing newline", async () => {
      const res = await handler(
        makeRequest("/api/create-order", {
          ticketTypeId: VALID_UUID,
          qty: 1,
          attendees: [validAttendee({ firstName: "John\nDoe" })],
          paymentMethodName: "Zelle",
        }),
      );
      expect(res.status).toBe(400);
    });

    it("rejects invalid email (no @)", async () => {
      const res = await handler(
        makeRequest("/api/create-order", {
          ticketTypeId: VALID_UUID,
          qty: 1,
          attendees: [validAttendee({ email: "notanemail" })],
          paymentMethodName: "Zelle",
        }),
      );
      expect(res.status).toBe(400);
    });

    it("rejects email with 255+ chars", async () => {
      const longEmail = "a".repeat(250) + "@b.com";
      const res = await handler(
        makeRequest("/api/create-order", {
          ticketTypeId: VALID_UUID,
          qty: 1,
          attendees: [validAttendee({ email: longEmail })],
          paymentMethodName: "Zelle",
        }),
      );
      expect(res.status).toBe(400);
    });

    it("rejects cedula with letters", async () => {
      const res = await handler(
        makeRequest("/api/create-order", {
          ticketTypeId: VALID_UUID,
          qty: 1,
          attendees: [validAttendee({ cedula: "ABC123" })],
          paymentMethodName: "Zelle",
        }),
      );
      expect(res.status).toBe(400);
    });

    it("rejects cedula with 21+ digits", async () => {
      const res = await handler(
        makeRequest("/api/create-order", {
          ticketTypeId: VALID_UUID,
          qty: 1,
          attendees: [validAttendee({ cedula: "1".repeat(21) })],
          paymentMethodName: "Zelle",
        }),
      );
      expect(res.status).toBe(400);
    });
  });

  describe("optional UUID fields", () => {
    it("rejects invalid reservationId (not UUID)", async () => {
      const res = await handler(
        makeRequest("/api/create-order", {
          ticketTypeId: VALID_UUID,
          qty: 1,
          attendees: [validAttendee()],
          paymentMethodName: "Zelle",
          reservationId: "not-a-uuid",
        }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe("INVALID_INPUT");
    });

    it("rejects invalid purchaseGroupId (not UUID)", async () => {
      const res = await handler(
        makeRequest("/api/create-order", {
          ticketTypeId: VALID_UUID,
          qty: 1,
          attendees: [validAttendee()],
          paymentMethodName: "Zelle",
          purchaseGroupId: "not-a-uuid",
        }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe("INVALID_INPUT");
    });
  });

  describe("valid payloads pass", () => {
    it("valid minimum payload succeeds", async () => {
      mockQuery.mockResolvedValueOnce({
        ticketTypes: [baseTicketType()],
      });

      const res = await handler(
        makeRequest("/api/create-order", {
          ticketTypeId: VALID_UUID,
          qty: 1,
          attendees: [validAttendee()],
          paymentMethodName: "Zelle",
        }),
      );
      expect(res.status).toBe(200);
    });

    it("valid maximum payload succeeds", async () => {
      mockQuery
        .mockResolvedValueOnce({ orders: [] }) // reference number duplicate check
        .mockResolvedValueOnce({ ticketTypes: [baseTicketType()] });

      const reservationId = "b0000000-0000-4000-8000-000000000001";
      const purchaseGroupId = "b0000000-0000-4000-8000-000000000002";
      const res = await handler(
        makeRequest("/api/create-order", {
          ticketTypeId: VALID_UUID,
          qty: 5,
          attendees: Array.from({ length: 5 }, (_, i) =>
            validAttendee({ email: `user${i}@example.com` }),
          ),
          paymentMethodName: "Zelle",
          promoter: "Partner Inc",
          reservationId,
          purchaseGroupId,
          referenceNumber: "REF-123",
          paymentProofPath: "payment-proofs/1234-proof.jpg",
          queueToken: "f0000000-0000-4000-8000-000000000001",
        }),
      );
      expect(res.status).toBe(200);
    });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// join-queue validation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe("POST /api/join-queue — input validation", () => {
  let handler: typeof import("@/app/api/join-queue/route").POST;

  beforeEach(async () => {
    const mod = await import("@/app/api/join-queue/route");
    handler = mod.POST;
  });

  it("rejects empty sessionId → 400", async () => {
    const res = await handler(
      makeRequest("/api/join-queue", {
        ticketTypeId: VALID_UUID,
        qty: 1,
        sessionId: "",
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/sessionId/i);
  });

  it("rejects 101-char sessionId → 400", async () => {
    const res = await handler(
      makeRequest("/api/join-queue", {
        ticketTypeId: VALID_UUID,
        qty: 1,
        sessionId: "x".repeat(101),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("accepts 1-char sessionId", async () => {
    mockQuery
      .mockResolvedValueOnce({ queueEntries: [] })
      .mockResolvedValueOnce({
        ticketTypes: [{ id: VALID_UUID, lastQueuePosition: 0, concert: { id: "c-1", status: "active" } }],
      })
      .mockResolvedValueOnce({
        queueEntries: [{ id: "generated-id", status: "waiting" }],
      });

    const res = await handler(
      makeRequest("/api/join-queue", {
        ticketTypeId: VALID_UUID,
        qty: 1,
        sessionId: "x",
      }),
    );
    expect(res.status).toBe(200);
  });

  it("accepts 100-char sessionId", async () => {
    mockQuery
      .mockResolvedValueOnce({ queueEntries: [] })
      .mockResolvedValueOnce({
        ticketTypes: [{ id: VALID_UUID, lastQueuePosition: 0, concert: { id: "c-1", status: "active" } }],
      })
      .mockResolvedValueOnce({
        queueEntries: [{ id: "generated-id", status: "waiting" }],
      });

    const res = await handler(
      makeRequest("/api/join-queue", {
        ticketTypeId: VALID_UUID,
        qty: 1,
        sessionId: "y".repeat(100),
      }),
    );
    expect(res.status).toBe(200);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// assign-order-number race condition
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe("POST /api/assign-order-number — concurrent race", () => {
  let handler: typeof import("@/app/api/assign-order-number/route").POST;

  beforeEach(async () => {
    const mod = await import("@/app/api/assign-order-number/route");
    handler = mod.POST;
  });

  it("FIXED: concurrent calls retry on transact failure → eventual success", async () => {
    mockVerifyToken.mockResolvedValue({ email: "admin@example.com" });
    // Both requests will query the same order and concert data
    const orderData = {
      orders: [
        {
          id: "order-1",
          ticketType: {
            id: VALID_UUID,
            concert: {
              id: CONCERT_ID,
              name: "Rock Show",
              lastOrderSeq: 5,
              organizerEmail: "admin@example.com",
            },
          },
        },
      ],
    };

    // assignOrderNumber now has retry logic:
    // First query: check existing orderNumber (none), second: read concert
    // On retry: re-read concert with updated seq
    let queryCallCount = 0;
    mockQuery.mockImplementation(() => {
      queryCallCount++;
      // Queries for order check return no orderNumber
      // Queries for concert return seq=5, then seq=6 on retry
      if (queryCallCount <= 4) {
        return Promise.resolve({
          ...orderData,
          concerts: [{ id: CONCERT_ID, name: "Rock Show", lastOrderSeq: 5 }],
        });
      }
      return Promise.resolve({
        ...orderData,
        concerts: [{ id: CONCERT_ID, name: "Rock Show", lastOrderSeq: 6 }],
      });
    });

    // First transact of each call fails, second succeeds (retry logic kicks in)
    mockTransact
      .mockRejectedValueOnce(new Error("Conflict"))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Conflict"))
      .mockResolvedValueOnce(undefined);

    const authHeaders = { Authorization: "Bearer test-token" };
    const [res1, res2] = await Promise.all([
      handler(
        makeRequest("/api/assign-order-number", { orderId: "order-1" }, authHeaders),
      ),
      handler(
        makeRequest("/api/assign-order-number", { orderId: "order-1" }, authHeaders),
      ),
    ]);

    // Both succeed thanks to retry logic
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });
});
