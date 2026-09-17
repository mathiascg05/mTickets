import { describe, it, expect } from "vitest";
import {
  toCaracasDay,
  caracasToday,
  addDays,
  daysBetween,
  VE_TIME_ZONE,
} from "../formatters";

describe("toCaracasDay", () => {
  it("uses the Venezuela day, not the UTC day", () => {
    // 2026-03-05T01:30:00Z is still 2026-03-04 at 21:30 in Caracas (UTC-4).
    expect(toCaracasDay(Date.parse("2026-03-05T01:30:00Z"))).toBe("2026-03-04");
  });

  it("rolls over at 04:00 UTC", () => {
    expect(toCaracasDay(Date.parse("2026-03-05T03:59:59Z"))).toBe("2026-03-04");
    expect(toCaracasDay(Date.parse("2026-03-05T04:00:00Z"))).toBe("2026-03-05");
  });

  it("keeps the same offset in July — Venezuela has no DST", () => {
    expect(toCaracasDay(Date.parse("2026-07-05T03:59:59Z"))).toBe("2026-07-04");
    expect(toCaracasDay(Date.parse("2026-07-05T04:00:00Z"))).toBe("2026-07-05");
  });

  it("pads month and day to two digits", () => {
    expect(toCaracasDay(Date.parse("2026-01-02T15:00:00Z"))).toBe("2026-01-02");
  });

  it("targets America/Caracas", () => {
    expect(VE_TIME_ZONE).toBe("America/Caracas");
  });
});

describe("caracasToday", () => {
  it("returns a YYYY-MM-DD string", () => {
    expect(caracasToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("addDays", () => {
  it("adds and subtracts days", () => {
    expect(addDays("2026-03-04", 1)).toBe("2026-03-05");
    expect(addDays("2026-03-04", -1)).toBe("2026-03-03");
    expect(addDays("2026-03-04", 0)).toBe("2026-03-04");
  });

  it("crosses month and year boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("handles leap years", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });
});

describe("daysBetween", () => {
  it("counts whole days forward and backward", () => {
    expect(daysBetween("2026-03-01", "2026-03-04")).toBe(3);
    expect(daysBetween("2026-03-04", "2026-03-01")).toBe(-3);
    expect(daysBetween("2026-03-04", "2026-03-04")).toBe(0);
  });

  it("spans months and years", () => {
    expect(daysBetween("2026-12-25", "2027-01-01")).toBe(7);
  });

  it("is the inverse of addDays", () => {
    const start = "2026-05-17";
    for (const n of [1, 7, 30, 365]) {
      expect(daysBetween(start, addDays(start, n))).toBe(n);
    }
  });
});
