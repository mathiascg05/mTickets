// Shared client cache for order-derived platform stats (/api/admin/platform-stats).
//
// The endpoint takes ~1.8s. To keep the Statistics tab fluid we cache results
// per period at module scope (survives component unmount/remount on tab
// switches) and revalidate in the background (stale-while-revalidate). The
// parent page also prefetches the default period on mount so the first visit
// to the tab is instant.

export type PlatformStats = {
  potentialDebt: number;
  perEvent: { id: string; ticketsSold: number; grossRevenue: number }[];
};

const cache = new Map<string, PlatformStats>();

function keyOf(from: string, to: string): string {
  return `${from}|${to}`;
}

export function getCachedStats(
  from: string,
  to: string,
): PlatformStats | undefined {
  return cache.get(keyOf(from, to));
}

export async function fetchPlatformStats(
  from: string,
  to: string,
  token: string,
): Promise<PlatformStats | null> {
  if (!token) return null;
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const res = await fetch(`/api/admin/platform-stats?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as PlatformStats;
  cache.set(keyOf(from, to), data);
  return data;
}
