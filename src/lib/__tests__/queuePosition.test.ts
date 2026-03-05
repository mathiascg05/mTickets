import { describe, it, expect } from "vitest";

/**
 * Tests for the queue position calculation logic used in the queue page.
 * These mirror the inline computations in src/app/queue/[ticketTypeId]/page.tsx
 * to verify correctness of FIFO ordering by `position` field (Fix 5).
 */

type QueueEntry = {
  id: string;
  status: string;
  position: number;
  createdAt: number;
  expiresAt: number;
};

/** Compute how many waiting entries are ahead of `currentEntry` */
function computeWaitingAhead(
  currentEntry: QueueEntry,
  allEntries: QueueEntry[],
  now: number,
): number {
  if (currentEntry.status !== "waiting") return 0;
  return allEntries.filter(
    (e) =>
      e.status === "waiting" &&
      e.expiresAt > now &&
      e.position < currentEntry.position,
  ).length;
}

/** Count total active waiters */
function computeTotalWaiting(
  allEntries: QueueEntry[],
  now: number,
): number {
  return allEntries.filter(
    (e) => e.status === "waiting" && e.expiresAt > now,
  ).length;
}

/** Compute estimated wait in minutes (min 1) */
function computeEstimatedWaitMin(waitingAhead: number): number {
  return Math.max(1, Math.ceil((waitingAhead * 30) / 60));
}

const NOW = Date.now();
const ACTIVE = NOW + 600_000; // 10 min from now
const EXPIRED = NOW - 1000;

function makeEntry(
  id: string,
  position: number,
  status = "waiting",
  expiresAt = ACTIVE,
  createdAt = NOW - position * 1000,
): QueueEntry {
  return { id, status, position, createdAt, expiresAt };
}

describe("queue position calculation", () => {
  it("returns 0 when user is first in line", () => {
    const current = makeEntry("me", 1);
    const all = [current, makeEntry("other", 2)];
    expect(computeWaitingAhead(current, all, NOW)).toBe(0);
  });

  it("counts entries with lower position as ahead", () => {
    const current = makeEntry("me", 5);
    const all = [
      makeEntry("a", 1),
      makeEntry("b", 2),
      makeEntry("c", 3),
      current,
      makeEntry("d", 7),
    ];
    expect(computeWaitingAhead(current, all, NOW)).toBe(3);
  });

  it("uses position field, not createdAt, for ordering (Fix 5)", () => {
    // Entry "a" has lower position but was created AFTER "me"
    // Entry "b" has higher position but was created BEFORE "me"
    const current = makeEntry("me", 5, "waiting", ACTIVE, NOW - 3000);
    const all = [
      { id: "a", status: "waiting", position: 2, createdAt: NOW - 1000, expiresAt: ACTIVE },
      { id: "b", status: "waiting", position: 8, createdAt: NOW - 5000, expiresAt: ACTIVE },
      current,
    ];

    // Only "a" (position 2) is ahead, not "b" (position 8)
    expect(computeWaitingAhead(current, all, NOW)).toBe(1);
  });

  it("excludes expired entries from ahead count", () => {
    const current = makeEntry("me", 5);
    const all = [
      makeEntry("expired-ahead", 1, "waiting", EXPIRED),
      makeEntry("active-ahead", 2),
      current,
    ];
    expect(computeWaitingAhead(current, all, NOW)).toBe(1);
  });

  it("excludes admitted entries from ahead count", () => {
    const current = makeEntry("me", 5);
    const all = [
      makeEntry("admitted", 1, "admitted"),
      makeEntry("waiting-ahead", 2),
      current,
    ];
    expect(computeWaitingAhead(current, all, NOW)).toBe(1);
  });

  it("excludes completed entries from ahead count", () => {
    const current = makeEntry("me", 3);
    const all = [
      makeEntry("completed", 1, "completed"),
      makeEntry("expired-status", 2, "expired"),
      current,
    ];
    expect(computeWaitingAhead(current, all, NOW)).toBe(0);
  });

  it("returns 0 for non-waiting entry", () => {
    const current = makeEntry("me", 5, "admitted");
    const all = [
      makeEntry("a", 1),
      makeEntry("b", 2),
      current,
    ];
    expect(computeWaitingAhead(current, all, NOW)).toBe(0);
  });

  it("handles empty queue", () => {
    const current = makeEntry("me", 1);
    expect(computeWaitingAhead(current, [current], NOW)).toBe(0);
  });
});

describe("total waiting count", () => {
  it("counts only active waiting entries", () => {
    const entries = [
      makeEntry("a", 1, "waiting"),
      makeEntry("b", 2, "waiting"),
      makeEntry("c", 3, "admitted"),
      makeEntry("d", 4, "waiting", EXPIRED),
      makeEntry("e", 5, "completed"),
    ];
    expect(computeTotalWaiting(entries, NOW)).toBe(2);
  });

  it("returns 0 for empty queue", () => {
    expect(computeTotalWaiting([], NOW)).toBe(0);
  });
});

describe("estimated wait time", () => {
  it("returns minimum 1 minute when 0 ahead", () => {
    expect(computeEstimatedWaitMin(0)).toBe(1);
  });

  it("returns 1 minute for 1 person ahead (30s)", () => {
    expect(computeEstimatedWaitMin(1)).toBe(1);
  });

  it("returns 1 minute for 2 people ahead (60s)", () => {
    expect(computeEstimatedWaitMin(2)).toBe(1);
  });

  it("returns 2 minutes for 3 people ahead (90s)", () => {
    expect(computeEstimatedWaitMin(3)).toBe(2);
  });

  it("returns 5 minutes for 10 people ahead (300s)", () => {
    expect(computeEstimatedWaitMin(10)).toBe(5);
  });
});
