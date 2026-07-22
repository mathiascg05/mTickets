import { describe, it, expect } from "vitest";
import {
  getAvailability,
  getActivePhase,
  committedAllotmentQty,
} from "../phases";

describe("getAvailability", () => {
  it("returns correct availability without phases", () => {
    const ticketType = { price: 25, quantity: 100 };
    const orders = [
      ...Array.from({ length: 30 }, (_, i) => ({
        id: `approved-${i}`,
        status: "approved",
      })),
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `pending-${i}`,
        status: "pending",
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `rejected-${i}`,
        status: "rejected",
      })),
    ];

    const result = getAvailability(ticketType, [], orders, "2026-03-05");
    expect(result.available).toBe(60); // 100 - 30 - 10 = 60 (rejected not counted)
    expect(result.price).toBe(25);
    expect(result.soldOut).toBe(false);
    expect(result.activePhase).toBeNull();
  });

  it("reduces availability by active reservations", () => {
    const ticketType = { price: 25, quantity: 100 };
    const orders = Array.from({ length: 90 }, (_, i) => ({
      id: `order-${i}`,
      status: "approved",
    }));
    const reservations = [
      { quantity: 3, expiresAt: Date.now() + 60000 },
      { quantity: 2, expiresAt: Date.now() + 60000 },
    ];

    const result = getAvailability(ticketType, [], orders, "2026-03-05", reservations);
    expect(result.available).toBe(5); // 100 - 90 - 5 = 5
  });

  it("ignores expired reservations", () => {
    const ticketType = { price: 25, quantity: 100 };
    const orders = Array.from({ length: 95 }, (_, i) => ({
      id: `order-${i}`,
      status: "approved",
    }));
    const reservations = [
      { quantity: 3, expiresAt: Date.now() - 1000 }, // expired
      { quantity: 2, expiresAt: Date.now() + 60000 }, // active
    ];

    const result = getAvailability(ticketType, [], orders, "2026-03-05", reservations);
    expect(result.available).toBe(3); // 100 - 95 - 2 = 3 (expired reservation ignored)
  });

  it("returns soldOut when capacity reached", () => {
    const ticketType = { price: 25, quantity: 100 };
    const orders = Array.from({ length: 100 }, (_, i) => ({
      id: `order-${i}`,
      status: "approved",
    }));

    const result = getAvailability(ticketType, [], orders, "2026-03-05");
    expect(result.available).toBe(0);
    expect(result.soldOut).toBe(true);
  });
});

describe("getActivePhase", () => {
  const phases = [
    { id: "p1", name: "Early Bird", price: 20, quantity: 50, sortOrder: 1, endDate: "2026-03-10" },
    { id: "p2", name: "Regular", price: 30, quantity: 100, sortOrder: 2, endDate: "2026-04-01" },
    { id: "p3", name: "Door", price: 50, quantity: 50, sortOrder: 3 },
  ];

  it("returns first phase with availability", () => {
    const orders = Array.from({ length: 10 }, (_, i) => ({
      id: `order-${i}`,
      status: "approved",
      phaseId: "p1",
    }));

    const result = getActivePhase(phases, orders, "2026-03-05");
    expect(result?.id).toBe("p1");
  });

  it("moves to next phase when current is full", () => {
    const orders = Array.from({ length: 50 }, (_, i) => ({
      id: `order-${i}`,
      status: "approved",
      phaseId: "p1",
    }));

    const result = getActivePhase(phases, orders, "2026-03-05");
    expect(result?.id).toBe("p2");
  });

  it("skips past-endDate phases", () => {
    const orders: { id: string; status: string; phaseId: string }[] = [];

    const result = getActivePhase(phases, orders, "2026-03-15");
    // p1 endDate is 2026-03-10, today is 2026-03-15, so skip p1
    expect(result?.id).toBe("p2");
  });

  it("returns null when all phases sold out", () => {
    const orders = [
      ...Array.from({ length: 50 }, (_, i) => ({
        id: `p1-${i}`,
        status: "approved",
        phaseId: "p1",
      })),
      ...Array.from({ length: 100 }, (_, i) => ({
        id: `p2-${i}`,
        status: "approved",
        phaseId: "p2",
      })),
      ...Array.from({ length: 50 }, (_, i) => ({
        id: `p3-${i}`,
        status: "approved",
        phaseId: "p3",
      })),
    ];

    const result = getActivePhase(phases, orders, "2026-03-05");
    expect(result).toBeNull();
  });

  it("getAvailability returns soldOut when all phases exhausted", () => {
    const ticketType = { price: 25, quantity: 200 };
    const orders = [
      ...Array.from({ length: 50 }, (_, i) => ({
        id: `p1-${i}`,
        status: "approved",
        phaseId: "p1",
      })),
      ...Array.from({ length: 100 }, (_, i) => ({
        id: `p2-${i}`,
        status: "approved",
        phaseId: "p2",
      })),
      ...Array.from({ length: 50 }, (_, i) => ({
        id: `p3-${i}`,
        status: "approved",
        phaseId: "p3",
      })),
    ];

    const result = getAvailability(ticketType, phases, orders, "2026-03-05");
    expect(result.soldOut).toBe(true);
    expect(result.available).toBe(0);
  });
});

describe("committedAllotmentQty", () => {
  it("sums only items belonging to active allotments", () => {
    const items = [
      { quantity: 180, status: "pending" },
      { quantity: 20, status: "submitted" },
      { quantity: 50, status: "approved" },
      { quantity: 30, status: "rejected" }, // released
      { quantity: 15, status: "cancelled" }, // released
    ];
    expect(committedAllotmentQty(items)).toBe(250); // 180 + 20 + 50
  });

  it("returns 0 for undefined/empty", () => {
    expect(committedAllotmentQty(undefined)).toBe(0);
    expect(committedAllotmentQty([])).toBe(0);
  });
});

describe("getAvailability with allotments (cross-channel oversell guard)", () => {
  it("subtracts committed allotment quantity from open-sale availability", () => {
    const ticketType = { price: 25, quantity: 200 };
    // 180 committed to a school lot, no open-sale orders yet
    const result = getAvailability(ticketType, [], [], "2026-03-05", [], 180);
    expect(result.available).toBe(20); // 200 - 180
    expect(result.soldOut).toBe(false);
  });

  it("does NOT double-count minted allotment orders (they carry allotmentId)", () => {
    const ticketType = { price: 25, quantity: 200 };
    // The lot was approved: 180 minted orders exist, all tagged with allotmentId,
    // and the 180 committed quantity is still passed in. Must not subtract twice.
    const orders = Array.from({ length: 180 }, (_, i) => ({
      id: `lot-${i}`,
      status: "approved",
      allotmentId: "lot-1",
    }));
    const result = getAvailability(ticketType, [], orders, "2026-03-05", [], 180);
    expect(result.available).toBe(20); // 200 - 180 (via committed, orders excluded)
  });

  it("open-sale orders and committed allotment stack correctly", () => {
    const ticketType = { price: 25, quantity: 200 };
    const orders = [
      ...Array.from({ length: 15 }, (_, i) => ({
        id: `open-${i}`,
        status: "approved",
      })),
      ...Array.from({ length: 180 }, (_, i) => ({
        id: `lot-${i}`,
        status: "approved",
        allotmentId: "lot-1",
      })),
    ];
    const result = getAvailability(ticketType, [], orders, "2026-03-05", [], 180);
    expect(result.available).toBe(5); // 200 - 15 open - 180 committed
  });

  it("releasing a lot (committed drops to 0) returns seats to open sale", () => {
    const ticketType = { price: 25, quantity: 200 };
    const result = getAvailability(ticketType, [], [], "2026-03-05", [], 0);
    expect(result.available).toBe(200);
  });

  it("marks soldOut when open sale + committed reach capacity", () => {
    const ticketType = { price: 25, quantity: 200 };
    const orders = Array.from({ length: 20 }, (_, i) => ({
      id: `open-${i}`,
      status: "approved",
    }));
    const result = getAvailability(ticketType, [], orders, "2026-03-05", [], 180);
    expect(result.available).toBe(0);
    expect(result.soldOut).toBe(true);
  });
});

describe("getAvailability for areas", () => {
  // Para áreas, ticketType.quantity = boxes disponibles, peoplePerTicket = personas
  // por box. Las órdenes companion (priceSnapshot=0) NO consumen stock.
  it("counts only primary orders (priceSnapshot>0) when ticketType is an area", () => {
    const ticketType = { price: 800, quantity: 5, peoplePerTicket: 8 };
    // 1 box vendido = 1 primary + 7 companions
    const orders = [
      { id: "primary-1", status: "approved", priceSnapshot: 800 },
      ...Array.from({ length: 7 }, (_, i) => ({
        id: `companion-1-${i}`,
        status: "approved",
        priceSnapshot: 0,
      })),
    ];

    const result = getAvailability(ticketType, [], orders, "2026-03-05");
    expect(result.available).toBe(4); // 5 boxes - 1 vendido
    expect(result.soldOut).toBe(false);
  });

  it("counts multiple boxes sold correctly", () => {
    const ticketType = { price: 800, quantity: 5, peoplePerTicket: 8 };
    // 3 boxes = 3 primaries + 21 companions
    const orders = [
      ...Array.from({ length: 3 }, (_, i) => ({
        id: `primary-${i}`,
        status: "approved",
        priceSnapshot: 800,
      })),
      ...Array.from({ length: 21 }, (_, i) => ({
        id: `companion-${i}`,
        status: "approved",
        priceSnapshot: 0,
      })),
    ];

    const result = getAvailability(ticketType, [], orders, "2026-03-05");
    expect(result.available).toBe(2);
  });

  it("pending primary orders also consume stock", () => {
    const ticketType = { price: 800, quantity: 2, peoplePerTicket: 8 };
    const orders = [
      { id: "primary-pending", status: "pending", priceSnapshot: 800 },
      ...Array.from({ length: 7 }, (_, i) => ({
        id: `companion-${i}`,
        status: "pending",
        priceSnapshot: 0,
      })),
    ];

    const result = getAvailability(ticketType, [], orders, "2026-03-05");
    expect(result.available).toBe(1);
  });

  it("rejected primary orders don't consume stock", () => {
    const ticketType = { price: 800, quantity: 5, peoplePerTicket: 8 };
    const orders = [
      { id: "primary-rej", status: "rejected", priceSnapshot: 800 },
      ...Array.from({ length: 7 }, (_, i) => ({
        id: `companion-${i}`,
        status: "rejected",
        priceSnapshot: 0,
      })),
    ];

    const result = getAvailability(ticketType, [], orders, "2026-03-05");
    expect(result.available).toBe(5);
  });

  it("reservation.quantity counts as boxes for areas", () => {
    const ticketType = { price: 800, quantity: 5, peoplePerTicket: 8 };
    const reservations = [
      { quantity: 1, expiresAt: Date.now() + 60000 },
      { quantity: 1, expiresAt: Date.now() + 60000 },
    ];

    const result = getAvailability(ticketType, [], [], "2026-03-05", reservations);
    expect(result.available).toBe(3); // 5 - 2 boxes reservados
  });

  it("area with phases: phase.quantity counts as boxes", () => {
    const ticketType = { price: 800, quantity: 0, peoplePerTicket: 8 };
    const phases = [
      { id: "p1", name: "Early", price: 700, quantity: 2, sortOrder: 1 },
      { id: "p2", name: "Regular", price: 800, quantity: 3, sortOrder: 2 },
    ];
    // 2 boxes vendidos en p1 (la fase debe agotarse y pasar a p2)
    const orders = [
      ...Array.from({ length: 2 }, (_, i) => ({
        id: `p1-primary-${i}`,
        status: "approved",
        phaseId: "p1",
        priceSnapshot: 700,
      })),
      ...Array.from({ length: 14 }, (_, i) => ({
        id: `p1-companion-${i}`,
        status: "approved",
        phaseId: "p1",
        priceSnapshot: 0,
      })),
    ];

    const result = getAvailability(ticketType, phases, orders, "2026-03-05");
    expect(result.activePhase?.id).toBe("p2");
    expect(result.price).toBe(800);
    expect(result.available).toBe(3); // 3 boxes en p2
  });

  it("individual ticketType (peoplePerTicket=1 or undefined) keeps legacy counting", () => {
    const ticketType = { price: 25, quantity: 100 };
    // Comportamiento clásico: cada orden cuenta como 1 persona
    const orders = Array.from({ length: 40 }, (_, i) => ({
      id: `order-${i}`,
      status: "approved",
      priceSnapshot: 25,
    }));

    const result = getAvailability(ticketType, [], orders, "2026-03-05");
    expect(result.available).toBe(60);
  });
});
