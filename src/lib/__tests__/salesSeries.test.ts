import { describe, it, expect } from "vitest";
import { buildSalesSeries, buildProjection } from "../salesSeries";

/** Epoch ms for a given Venezuela wall-clock day at 15:00 VET (19:00 UTC). */
const at = (day: string, hourUtc = 19) =>
  Date.parse(`${day}T${String(hourUtc).padStart(2, "0")}:00:00Z`);

const order = (day: string, status = "approved", hourUtc?: number) => ({
  createdAt: at(day, hourUtc),
  status,
});

describe("buildSalesSeries", () => {
  it("returns null when nothing has sold", () => {
    expect(buildSalesSeries([], { today: "2026-03-10" })).toBeNull();
    expect(
      buildSalesSeries([order("2026-03-01", "rejected")], { today: "2026-03-10" }),
    ).toBeNull();
  });

  it("counts approved and pending, ignoring rejected and cancelled", () => {
    const series = buildSalesSeries(
      [
        order("2026-03-01", "approved"),
        order("2026-03-01", "pending"),
        order("2026-03-01", "rejected"),
        order("2026-03-01", "cancelled"),
      ],
      { today: "2026-03-01" },
    )!;
    expect(series.points).toHaveLength(1);
    expect(series.points[0]).toMatchObject({ approved: 1, pending: 1, total: 2 });
    expect(series.total).toBe(2);
  });

  it("buckets by the Venezuela day, not the UTC day", () => {
    // 02:00 UTC on 03-02 is still 22:00 on 03-01 in Caracas.
    const series = buildSalesSeries([order("2026-03-02", "approved", 2)], {
      today: "2026-03-05",
    })!;
    expect(series.points[0].day).toBe("2026-03-01");
  });

  it("fills days with no sales so a drought stays visible", () => {
    const series = buildSalesSeries(
      [order("2026-03-01"), order("2026-03-04")],
      { today: "2026-03-04" },
    )!;
    expect(series.points.map((p) => p.total)).toEqual([1, 0, 0, 1]);
  });

  it("accumulates a running total", () => {
    const series = buildSalesSeries(
      [order("2026-03-01"), order("2026-03-02"), order("2026-03-02")],
      { today: "2026-03-03" },
    )!;
    expect(series.points.map((p) => p.cumulative)).toEqual([1, 3, 3]);
    expect(series.total).toBe(3);
  });

  it("runs the axis up to today when sales have stalled", () => {
    const series = buildSalesSeries([order("2026-03-01")], { today: "2026-03-05" })!;
    expect(series.points).toHaveLength(5);
    expect(series.points[4].day).toBe("2026-03-05");
  });

  it("stops at the event date for an event that already happened", () => {
    const series = buildSalesSeries([order("2026-03-01")], {
      today: "2026-09-17",
      eventDate: "2026-03-04",
    })!;
    expect(series.points[series.points.length - 1].day).toBe("2026-03-04");
  });

  it("still shows late sales past a finished event", () => {
    const series = buildSalesSeries([order("2026-03-01"), order("2026-03-20")], {
      today: "2026-09-17",
      eventDate: "2026-03-04",
    })!;
    expect(series.points[series.points.length - 1].day).toBe("2026-03-20");
  });

  it("caps a bogus-timestamp span at 400 days", () => {
    const series = buildSalesSeries([order("2020-01-01"), order("2026-03-05")], {
      today: "2026-03-05",
    })!;
    expect(series.points).toHaveLength(401);
  });
});

describe("buildProjection", () => {
  const steady = (days: number, perDay: number, endDay: string) => {
    const orders = [];
    for (let i = 0; i < days; i++) {
      const day = new Date(Date.parse(`${endDay}T12:00:00Z`) - i * 86400000)
        .toISOString()
        .slice(0, 10);
      for (let n = 0; n < perDay; n++) orders.push(order(day));
    }
    return orders;
  };

  it("is hidden without an event date", () => {
    const series = buildSalesSeries(steady(10, 2, "2026-03-10"), { today: "2026-03-10" });
    expect(buildProjection(series, undefined)).toBeNull();
  });

  it("is hidden once the event has passed", () => {
    const series = buildSalesSeries(steady(10, 2, "2026-03-10"), {
      today: "2026-03-10",
      eventDate: "2026-03-01",
    });
    expect(buildProjection(series, "2026-03-01")).toBeNull();
  });

  it("is hidden with fewer than 3 days of data", () => {
    const series = buildSalesSeries(steady(2, 5, "2026-03-10"), { today: "2026-03-10" });
    expect(buildProjection(series, "2026-04-01")).toBeNull();
  });

  it("appears on the third day of data", () => {
    const series = buildSalesSeries(steady(3, 5, "2026-03-10"), { today: "2026-03-10" });
    expect(buildProjection(series, "2026-04-01")).not.toBeNull();
  });

  it("extrapolates the last 7 days' pace to the event date", () => {
    // 10 tickets/day for 10 days = 100 sold, pace 10/day, 20 days to go.
    const series = buildSalesSeries(steady(10, 10, "2026-03-10"), { today: "2026-03-10" });
    const p = buildProjection(series, "2026-03-30")!;
    expect(series!.total).toBe(100);
    expect(p.perDay).toBe(10);
    expect(p.daysLeft).toBe(20);
    expect(p.projected).toBe(300);
  });

  it("lets a sales drought drag the pace down", () => {
    // 20 tickets on one day, then a week of silence → pace 0/day.
    const series = buildSalesSeries(steady(1, 20, "2026-03-01"), { today: "2026-03-10" });
    const p = buildProjection(series, "2026-03-20")!;
    expect(p.perDay).toBe(0);
    expect(p.projected).toBe(20);
  });

  it("projects today's event as the current total", () => {
    const series = buildSalesSeries(steady(5, 4, "2026-03-10"), { today: "2026-03-10" });
    const p = buildProjection(series, "2026-03-10")!;
    expect(p.daysLeft).toBe(0);
    expect(p.projected).toBe(20);
  });
});
