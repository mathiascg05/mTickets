import { NextRequest, NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

const intlMiddleware = createIntlMiddleware(routing);

// Simple in-memory rate limiter (resets on cold start — acceptable for Vercel serverless)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

const RATE_LIMITS: Record<string, { max: number; windowMs: number }> = {
  "/api/create-order": { max: 500, windowMs: 60_000 },
  "/api/create-reservation": { max: 500, windowMs: 60_000 },
  "/api/verify-ticket-email": { max: 10, windowMs: 60_000 },
  "/api/join-queue": { max: 1000, windowMs: 60_000 },
  "/api/queue-heartbeat": { max: 15000, windowMs: 60_000 },
  "/api/verify-scanner-pin": { max: 5, windowMs: 60_000 },
  "/api/send-ticket-email": { max: 10, windowMs: 60_000 },
  "/api/send-confirmation-email": { max: 10, windowMs: 60_000 },
  "/api/exchange-rates": { max: 30, windowMs: 60_000 },
  "/api/admin-auth": { max: 10, windowMs: 60_000 },
  "/api/reset-password": { max: 3, windowMs: 60_000 },
  "/api/organizer-contact": { max: 20, windowMs: 60_000 },
};

// Prefix-based limits (per IP). Useful for routes with dynamic path segments.
const RATE_LIMIT_PREFIXES: Array<{
  prefix: string;
  max: number;
  windowMs: number;
}> = [
  { prefix: "/api/messages/by-token/", max: 30, windowMs: 10 * 60_000 },
];

// Routes that authenticate by request signature or shared secret rather than
// by browser-issued cookies/tokens. CSRF is not relevant for these and
// rejecting them on Origin would break legitimate webhook/cron callers.
const CSRF_EXEMPT_PREFIXES = ["/api/webhooks/", "/api/cron/"];

function isStateChangingMethod(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

function getAllowedOrigins(): string[] {
  const origins = new Set<string>();
  if (process.env.NEXT_PUBLIC_APP_URL) origins.add(process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, ""));
  if (process.env.VERCEL_URL) origins.add(`https://${process.env.VERCEL_URL}`);
  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost:3000");
    origins.add("http://127.0.0.1:3000");
  }
  return [...origins];
}

function isAllowedOrigin(originHeader: string | null, refererHeader: string | null): boolean {
  const allowed = getAllowedOrigins();
  if (allowed.length === 0) return true;
  const candidate = originHeader || (refererHeader ? new URL(refererHeader).origin : null);
  if (!candidate) return false;
  return allowed.includes(candidate.replace(/\/$/, ""));
}

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

  // ── API requests: keep existing CSRF + rate limiting logic ──
  if (pathname.startsWith("/api/")) {
    if (
      isStateChangingMethod(req.method) &&
      !CSRF_EXEMPT_PREFIXES.some((p) => pathname.startsWith(p))
    ) {
      if (!isAllowedOrigin(req.headers.get("origin"), req.headers.get("referer"))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const limit = RATE_LIMITS[pathname];
    if (limit) {
      cleanupIfNeeded();
      const ip = getClientIp(req);
      const key = `${ip}:${pathname}`;
      if (isRateLimited(key, limit.max, limit.windowMs)) {
        return NextResponse.json(
          { error: "Too many requests. Please try again later." },
          { status: 429 },
        );
      }
    }

    for (const pfx of RATE_LIMIT_PREFIXES) {
      if (pathname.startsWith(pfx.prefix)) {
        cleanupIfNeeded();
        const ip = getClientIp(req);
        const key = `${ip}:${pfx.prefix}`;
        if (isRateLimited(key, pfx.max, pfx.windowMs)) {
          return NextResponse.json(
            { error: "Too many requests. Please try again later." },
            { status: 429 },
          );
        }
        break;
      }
    }
    return NextResponse.next();
  }

  // ── Page requests: delegate to next-intl for locale detection + routing ──
  return intlMiddleware(req);
}

export const config = {
  // Apply middleware to API routes and all pages except _next, static files,
  // and favicon. next-intl needs to see page requests to detect/inject locale.
  matcher: ["/((?!_next|.*\\..*).*)"],
};
