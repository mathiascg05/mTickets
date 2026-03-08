import { NextRequest, NextResponse } from "next/server";

// Simple in-memory rate limiter (resets on cold start — acceptable for Vercel serverless)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

const RATE_LIMITS: Record<string, { max: number; windowMs: number }> = {
  "/api/create-order": { max: 10, windowMs: 60_000 },
  "/api/create-reservation": { max: 5, windowMs: 60_000 },
  "/api/verify-ticket-email": { max: 10, windowMs: 60_000 },
  "/api/join-queue": { max: 10, windowMs: 60_000 },
  "/api/queue-heartbeat": { max: 60, windowMs: 60_000 },
};

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function isRateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  entry.count++;
  return entry.count > max;
}

// Periodically clean old entries to prevent memory growth
let lastCleanup = Date.now();
function cleanupIfNeeded() {
  const now = Date.now();
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(key);
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const limit = RATE_LIMITS[pathname];

  if (!limit) return NextResponse.next();

  cleanupIfNeeded();

  const ip = getClientIp(req);
  const key = `${ip}:${pathname}`;

  if (isRateLimited(key, limit.max, limit.windowMs)) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/create-order", "/api/create-reservation", "/api/verify-ticket-email", "/api/join-queue", "/api/queue-heartbeat"],
};
