import { describe, it, expect } from "vitest";
import { getAvailability, getActivePhase } from "../phases";

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
