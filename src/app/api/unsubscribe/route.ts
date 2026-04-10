import { NextRequest, NextResponse } from "next/server";
import { verifyUnsubscribeToken } from "@/lib/unsubscribeToken";
import { suppressEmail } from "@/lib/emailSuppression";

function htmlResponse(title: string, message: string, status = 200) {
  return new NextResponse(
    `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} - maTickets</title>
<style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f7fa}
.card{max-width:400px;padding:32px;background:#fff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.1);text-align:center}
h1{color:#1a2b4a;font-size:24px}p{color:#64748b;font-size:16px}</style>
</head>
<body><div class="card"><h1>${title}</h1><p>${message}</p></div></body>
</html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

// RFC 8058 one-click unsubscribe (POST)
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const email = searchParams.get("email");
  const token = searchParams.get("token");

  if (!email || !token) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }

  if (!verifyUnsubscribeToken(email, token)) {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }

  await suppressEmail(email, "unsubscribe", "unsubscribe-link");
  return NextResponse.json({ status: "unsubscribed" });
}

// Browser click fallback (GET)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const email = searchParams.get("email");
  const token = searchParams.get("token");

  if (!email || !token) {
    return htmlResponse("Error", "Invalid unsubscribe link.", 400);
  }

  if (!verifyUnsubscribeToken(email, token)) {
    return htmlResponse("Error", "This unsubscribe link is invalid or expired.", 400);
  }

  await suppressEmail(email, "unsubscribe", "unsubscribe-link");
  return htmlResponse(
    "Unsubscribed",
    "You have been successfully unsubscribed from maTickets emails. You will no longer receive marketing or notification emails from us.",
  );
}
