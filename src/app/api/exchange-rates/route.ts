import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";

const URLS: Record<string, string> = {
  USD: "https://ve.dolarapi.com/v1/dolares/oficial",
  EUR: "https://ve.dolarapi.com/v1/euros/oficial",
};

const RATE_IDS: Record<string, string> = {
  USD: "a0000000-0000-4000-8000-000000000001",
  EUR: "a0000000-0000-4000-8000-000000000002",
};

export async function GET(request: NextRequest) {
  const currency = request.nextUrl.searchParams.get("currency");

  if (!currency || !URLS[currency]) {
    return NextResponse.json(
      { error: "Invalid currency. Use ?currency=USD or ?currency=EUR" },
      { status: 400 },
    );
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(URLS[currency], {
      signal: controller.signal,
      cache: "no-store",
      headers: { "User-Agent": "matickets/1.0" },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.error("[exchange-rates] Upstream error:", res.status, res.statusText);
      return NextResponse.json(
        { error: "Failed to fetch exchange rate" },
        { status: 502 },
      );
    }

    const data = await res.json();

    // Cache the rate in InstantDB (server-side, no client auth needed)
    const rateId = RATE_IDS[currency];
    if (rateId && data.promedio) {
      try {
        await adminDb.transact(
          adminDb.tx.exchangeRates[rateId].update({
            currency,
            rate: data.promedio,
            fetchedAt: Date.now(),
          }),
        );
      } catch (err) {
        console.error("[exchange-rates] Failed to cache rate:", err);
      }
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("[exchange-rates] Fetch error:", err);
    return NextResponse.json(
      { error: "Failed to fetch exchange rate" },
      { status: 502 },
    );
  }
}
