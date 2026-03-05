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

  const res = await fetch(URLS[currency], { next: { revalidate: 3600 } });

  if (!res.ok) {
    return NextResponse.json(
      { error: "Failed to fetch exchange rate" },
      { status: 502 },
    );
  }

  const data = await res.json();
  return NextResponse.json(data);
}
