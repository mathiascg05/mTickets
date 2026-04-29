import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { assignUniquePrefix } from "@/lib/orderNumber";

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    try {
      const user = await adminDb.auth.verifyToken(authHeader.slice(7));
      if (!user?.email) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    } catch {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const { name } = await req.json();
    if (typeof name !== "string" || !name.trim()) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 },
      );
    }

    const prefix = await assignUniquePrefix(adminDb, name);
    return NextResponse.json({ prefix });
  } catch (err) {
    console.error("[assign-prefix] error:", err);
    return NextResponse.json(
      { error: "Failed to assign prefix" },
      { status: 500 },
    );
  }
}
