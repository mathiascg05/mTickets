import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { isValidEmail, isValidUUID } from "@/lib/validation";

// In-memory rate limit: 5 lookups per email per 60s
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(key) ?? [];
  const recent = timestamps.filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) return false;
  recent.push(now);
  rateLimitMap.set(key, recent);
  return true;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, concertId } = body;

    if (!isValidEmail(email)) {
      return NextResponse.json({ orders: [] });
    }
    if (!isValidUUID(concertId)) {
      return NextResponse.json({ orders: [] });
    }

    const normalizedEmail = (email as string).toLowerCase().trim();

    if (!checkRateLimit(normalizedEmail)) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 },
      );
    }

    // Query orders by email, include ticketType to filter by concert
    const { orders } = await adminDb.query({
      orders: {
        $: { where: { email: normalizedEmail } },
        ticketType: {
          concert: {},
        },
      },
    });

    // Filter to orders belonging to the requested concert
    const matching = orders
      .filter((order) => {
        const rawTT = order.ticketType as unknown;
        const tt = Array.isArray(rawTT) ? rawTT[0] : rawTT;
        const rawConcert = tt?.concert as unknown;
        const concert = Array.isArray(rawConcert) ? rawConcert[0] : rawConcert;
        return concert?.id === concertId;
      })
      .map((order) => {
        const rawTT = order.ticketType as unknown;
        const tt = Array.isArray(rawTT) ? rawTT[0] : rawTT;
        return {
          id: order.id,
          orderNumber: order.orderNumber ?? null,
          firstName: order.firstName,
          lastName: order.lastName,
          status: order.status,
          ticketTypeName: tt?.name ?? "Unknown",
          createdAt: order.createdAt,
        };
      });

    return NextResponse.json({ orders: matching });
  } catch (err) {
    console.error("[lookup-tickets] error:", err);
    return NextResponse.json({ orders: [] });
  }
}
