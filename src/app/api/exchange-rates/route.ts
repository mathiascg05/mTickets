import { NextRequest, NextResponse } from "next/server";

const URLS: Record<string, string> = {
  USD: "https://ve.dolarapi.com/v1/dolares/oficial",
  EUR: "https://ve.dolarapi.com/v1/euros/oficial",
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
    return NextResponse.json(data);
  } catch (err) {
    console.error("[exchange-rates] Fetch error:", err);
    return NextResponse.json(
      { error: "Failed to fetch exchange rate" },
      { status: 502 },
    );
  }
}
