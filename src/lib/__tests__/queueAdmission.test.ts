import { describe, it, expect, vi, beforeEach } from "vitest";
import { MAX_CONCURRENT, ADMITTED_TTL } from "../queueConstants";

// vi.mock is hoisted — everything must be inlined (no external references)
vi.mock("@/lib/adminDb", () => ({
  adminDb: {
    query: vi.fn(),
    transact: vi.fn(),
    tx: {
      queueEntries: new Proxy(
        {},
        {
          get: (_target, id: string) => ({
            update: (data: Record<string, unknown>) => ({
              __type: "update",
              id,
              data,
            }),
          }),
        },
      ),
    },
  },
}));

// Import the mocked module to get references to the mock fns
import { adminDb } from "@/lib/adminDb";
import { processQueueAdmissions } from "../queueAdmission";

const mockQuery = adminDb.query as ReturnType<typeof vi.fn>;
const mockTransact = adminDb.transact as ReturnType<typeof vi.fn>;

// Helper to build queue entries
function makeEntry(overrides: Partial<{
  id: string;
  status: string;
  position: number;
  createdAt: number;
  expiresAt: number;
}>) {
  const now = Date.now();
  return {
    id: overrides.id ?? crypto.randomUUID(),
    status: overrides.status ?? "waiting",
    position: overrides.position ?? 1,
    createdAt: overrides.createdAt ?? now - 10_000,
    expiresAt: overrides.expiresAt ?? now + 600_000,
  };
}

function makeReservation(expiresAt: number) {
  return { id: crypto.randomUUID(), expiresAt };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTransact.mockResolvedValue(undefined);
});

describe("processQueueAdmissions", () => {
  it("returns undefined when ticketType not found", async () => {
    mockQuery.mockResolvedValue({ ticketTypes: [] });
    const result = await processQueueAdmissions("nonexistent-id");
    expect(result).toBeUndefined();
    expect(mockTransact).not.toHaveBeenCalled();
  });

  it("expires stale waiting entries", async () => {
    const staleEntry = makeEntry({
      id: "stale-1",
      status: "waiting",
      expiresAt: Date.now() - 1000,
    });
    const freshEntry = makeEntry({
      id: "fresh-1",
      status: "waiting",
      position: 2,
    });

    mockQuery.mockResolvedValue({
      ticketTypes: [
        {
          id: "tt-1",
          queueEntries: [staleEntry, freshEntry],
          reservations: [],
        },
      ],
    });

    const result = await processQueueAdmissions("tt-1");

    expect(result).toEqual({ expired: 1, admitted: 1 });
    expect(mockTransact).toHaveBeenCalledTimes(1);

    const txns = mockTransact.mock.calls[0][0];
    // First txn: expire stale entry
    expect(txns[0]).toMatchObject({
      id: "stale-1",
      data: { status: "expired" },
    });
    // Second txn: admit fresh entry
    expect(txns[1]).toMatchObject({
      id: "fresh-1",
      data: expect.objectContaining({ status: "admitted" }),
    });
  });

  it("expires stale admitted entries", async () => {
    const staleAdmitted = makeEntry({
      id: "stale-admitted",
      status: "admitted",
      expiresAt: Date.now() - 1000,
    });

    mockQuery.mockResolvedValue({
      ticketTypes: [
        {
          id: "tt-1",
          queueEntries: [staleAdmitted],
          reservations: [],
        },
      ],
    });

    const result = await processQueueAdmissions("tt-1");
    expect(result).toEqual({ expired: 1, admitted: 0 });
  });

  it("admits waiting entries in FIFO order by position (not createdAt)", async () => {
    // Entry with lower position but LATER createdAt should be admitted first
    const entryA = makeEntry({
      id: "entry-a",
      status: "waiting",
      position: 5,
      createdAt: Date.now() - 1000, // created later
    });
    const entryB = makeEntry({
      id: "entry-b",
      status: "waiting",
      position: 3,
      createdAt: Date.now() - 5000, // created earlier
    });
    const entryC = makeEntry({
      id: "entry-c",
      status: "waiting",
      position: 7,
      createdAt: Date.now() - 3000,
    });

    mockQuery.mockResolvedValue({
      ticketTypes: [
        {
          id: "tt-1",
          queueEntries: [entryA, entryB, entryC],
          reservations: [],
        },
      ],
    });

    const result = await processQueueAdmissions("tt-1");
    expect(result).toEqual({ expired: 0, admitted: 3 });

    const txns = mockTransact.mock.calls[0][0];
    // Should be admitted in position order: B(3), A(5), C(7)
    expect(txns[0].id).toBe("entry-b");
    expect(txns[1].id).toBe("entry-a");
    expect(txns[2].id).toBe("entry-c");
  });

  it("respects MAX_CONCURRENT slot limit with active reservations", async () => {
    const now = Date.now();
    const waitingEntries = Array.from({ length: 5 }, (_, i) =>
      makeEntry({
        id: `wait-${i}`,
        status: "waiting",
        position: i + 1,
      }),
    );

    // 3 active reservations → only MAX_CONCURRENT - 3 slots available
    const reservations = Array.from({ length: 3 }, () =>
      makeReservation(now + 600_000),
    );

    mockQuery.mockResolvedValue({
      ticketTypes: [
        {
          id: "tt-1",
          queueEntries: waitingEntries,
          reservations,
        },
      ],
    });

    const result = await processQueueAdmissions("tt-1");
    expect(result!.admitted).toBe(MAX_CONCURRENT - 3);
  });

  it("respects MAX_CONCURRENT with admitted entries counting as buyers", async () => {
    const now = Date.now();
    // 2 already admitted (non-expired)
    const admittedEntries = Array.from({ length: 2 }, (_, i) =>
      makeEntry({
        id: `admitted-${i}`,
        status: "admitted",
        position: i + 1,
        expiresAt: now + 300_000,
      }),
    );
    // 3 waiting
    const waitingEntries = Array.from({ length: 3 }, (_, i) =>
      makeEntry({
        id: `wait-${i}`,
        status: "waiting",
        position: i + 10,
      }),
    );

    // 1 active reservation
    const reservations = [makeReservation(now + 600_000)];

    mockQuery.mockResolvedValue({
      ticketTypes: [
        {
          id: "tt-1",
          queueEntries: [...admittedEntries, ...waitingEntries],
          reservations,
        },
      ],
    });

    const result = await processQueueAdmissions("tt-1");
    // activeBuyers = 1 reservation + 2 admitted = 3
    // availableSlots = MAX_CONCURRENT(5) - 3 = 2
    expect(result!.admitted).toBe(2);
  });

  it("admits zero when no slots available", async () => {
    const now = Date.now();
    // Fill all slots with reservations
    const reservations = Array.from({ length: MAX_CONCURRENT }, () =>
      makeReservation(now + 600_000),
    );
    const waitingEntry = makeEntry({
      id: "wait-1",
      status: "waiting",
      position: 1,
    });

    mockQuery.mockResolvedValue({
      ticketTypes: [
        {
          id: "tt-1",
          queueEntries: [waitingEntry],
          reservations,
        },
      ],
    });

    const result = await processQueueAdmissions("tt-1");
    expect(result!.admitted).toBe(0);
    // No transactions since nothing to expire and nothing to admit
    expect(mockTransact).not.toHaveBeenCalled();
  });

  it("does not transact when there are no changes", async () => {
    mockQuery.mockResolvedValue({
      ticketTypes: [
        {
          id: "tt-1",
          queueEntries: [],
          reservations: [],
        },
      ],
    });

    const result = await processQueueAdmissions("tt-1");
    expect(result).toEqual({ expired: 0, admitted: 0 });
    expect(mockTransact).not.toHaveBeenCalled();
  });

  it("sets admitted entries with correct expiresAt using ADMITTED_TTL", async () => {
    const entry = makeEntry({
      id: "entry-1",
      status: "waiting",
      position: 1,
    });

    mockQuery.mockResolvedValue({
      ticketTypes: [
        {
          id: "tt-1",
          queueEntries: [entry],
          reservations: [],
        },
      ],
    });

    const before = Date.now();
    await processQueueAdmissions("tt-1");
    const after = Date.now();

    const txns = mockTransact.mock.calls[0][0];
    const admitTxn = txns[0];
    expect(admitTxn.data.status).toBe("admitted");
    expect(admitTxn.data.admittedAt).toBeGreaterThanOrEqual(before);
    expect(admitTxn.data.admittedAt).toBeLessThanOrEqual(after);
    expect(admitTxn.data.expiresAt).toBeGreaterThanOrEqual(
      before + ADMITTED_TTL,
    );
    expect(admitTxn.data.expiresAt).toBeLessThanOrEqual(after + ADMITTED_TTL);
  });

  it("ignores expired reservations when counting active buyers", async () => {
    const now = Date.now();
    const expiredReservations = Array.from({ length: MAX_CONCURRENT }, () =>
      makeReservation(now - 1000),
    );
    const waitingEntries = Array.from({ length: 3 }, (_, i) =>
      makeEntry({
        id: `wait-${i}`,
        status: "waiting",
        position: i + 1,
      }),
    );

    mockQuery.mockResolvedValue({
      ticketTypes: [
        {
          id: "tt-1",
          queueEntries: waitingEntries,
          reservations: expiredReservations,
        },
      ],
    });

    const result = await processQueueAdmissions("tt-1");
    // All reservations expired → 0 active buyers → all 3 admitted
    expect(result!.admitted).toBe(3);
  });

  it("does not re-admit already admitted entries", async () => {
    const now = Date.now();
    const admittedEntry = makeEntry({
      id: "admitted-1",
      status: "admitted",
      position: 1,
      expiresAt: now + 300_000,
    });

    mockQuery.mockResolvedValue({
      ticketTypes: [
        {
          id: "tt-1",
          queueEntries: [admittedEntry],
          reservations: [],
        },
      ],
    });

    const result = await processQueueAdmissions("tt-1");
    expect(result).toEqual({ expired: 0, admitted: 0 });
    expect(mockTransact).not.toHaveBeenCalled();
  });

  it("handles completed/expired entries without touching them", async () => {
    const completedEntry = makeEntry({
      id: "completed-1",
      status: "completed",
      position: 1,
    });
    const expiredEntry = makeEntry({
      id: "expired-1",
      status: "expired",
      position: 2,
    });

    mockQuery.mockResolvedValue({
      ticketTypes: [
        {
          id: "tt-1",
          queueEntries: [completedEntry, expiredEntry],
          reservations: [],
        },
      ],
    });

    const result = await processQueueAdmissions("tt-1");
    expect(result).toEqual({ expired: 0, admitted: 0 });
    expect(mockTransact).not.toHaveBeenCalled();
  });
});
