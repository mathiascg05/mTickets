import { NextResponse } from "next/server";

export const runtime = "edge";

export async function GET() {
  return new NextResponse(null, {
    status: 303,
    headers: {
      Location: "/",
      "Clear-Site-Data": '"cache", "storage", "executionContexts"',
      "Cache-Control": "no-store",
    },
  });
}
