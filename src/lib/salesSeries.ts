import { addDays, caracasToday, daysBetween, toCaracasDay } from "./formatters";

export type SalesOrder = { createdAt: number; status: string };

export type SalesPoint = {
  /** "YYYY-MM-DD" in Venezuela time. */
  day: string;
  approved: number;
  pending: number;
  total: number;
  cumulative: number;
};

export type SalesSeries = {
  points: SalesPoint[];
  /** Approved + pending tickets across the whole series. */
  total: number;
  today: string;
};

// A single stray order with a bogus timestamp shouldn't turn the chart into
// thousands of empty days.
export const MAX_SERIES_DAYS = 400;

/** Minimum days of history before a projection means anything. */
export const MIN_DAYS_FOR_PROJECTION = 3;

const PROJECTION_WINDOW_DAYS = 7;

/**
 * Buckets orders into one point per calendar day in Venezuela, filling the gaps
 * so a sales drought reads as a drought instead of a flat line.
 *
 * Rejected and cancelled orders never became a sale, so they are left out.
 */
export function buildSalesSeries(
  orders: SalesOrder[],
  opts: { eventDate?: string; today?: string } = {},
): SalesSeries | null {
  const today = opts.today ?? caracasToday();

  const byDay = new Map<string, { approved: number; pending: number }>();
  for (const o of orders) {
    if (o.status !== "approved" && o.status !== "pending") continue;
    if (!Number.isFinite(o.createdAt)) continue;
    const day = toCaracasDay(o.createdAt);
    const bucket = byDay.get(day) ?? { approved: 0, pending: 0 };
    if (o.status === "approved") bucket.approved += 1;
    else bucket.pending += 1;
    byDay.set(day, bucket);
  }
  if (byDay.size === 0) return null;

  const sortedDays = [...byDay.keys()].sort();
  const lastSale = sortedDays[sortedDays.length - 1];
  // Run up to today — but for an event that already happened, stop at the
  // event rather than trailing months of dead space.
  const horizon =
    opts.eventDate && opts.eventDate < today ? opts.eventDate : today;
  const last = lastSale > horizon ? lastSale : horizon;

  let first = sortedDays[0];
  if (daysBetween(first, last) > MAX_SERIES_DAYS) {
    first = addDays(last, -MAX_SERIES_DAYS);
  }

  const span = daysBetween(first, last);
  const points: SalesPoint[] = [];
  let cumulative = 0;
  for (let i = 0; i <= span; i++) {
    const day = addDays(first, i);
    const bucket = byDay.get(day) ?? { approved: 0, pending: 0 };
    const total = bucket.approved + bucket.pending;
    cumulative += total;
    points.push({ day, ...bucket, total, cumulative });
  }
  return { points, total: cumulative, today };
}

/**
 * Extrapolates the last 7 days' average pace to the event date.
 *
 * Returns null when a projection would be meaningless: no event date, the
 * event already happened, or fewer than 3 days of history.
 */
export function buildProjection(
  series: SalesSeries | null,
  eventDate?: string,
): { projected: number; perDay: number; daysLeft: number } | null {
  if (!series || !eventDate) return null;
  const { points, today, total } = series;
  if (eventDate < today) return null;

  const daysOfData = daysBetween(points[0].day, today) + 1;
  if (daysOfData < MIN_DAYS_FOR_PROJECTION) return null;

  // Calendar window, so days with no sales pull the average down.
  const windowStart = addDays(today, -(PROJECTION_WINDOW_DAYS - 1));
  const perDay =
    points
      .filter((p) => p.day >= windowStart && p.day <= today)
      .reduce((s, p) => s + p.total, 0) / PROJECTION_WINDOW_DAYS;

  const daysLeft = daysBetween(today, eventDate);
  return { projected: Math.round(total + perDay * daysLeft), perDay, daysLeft };
}
