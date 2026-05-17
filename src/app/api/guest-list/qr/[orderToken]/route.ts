import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { adminDb } from "@/lib/adminDb";
import { isValidToken } from "@/lib/guestListTokens";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ orderToken: string }> },
) {
  try {
    const { orderToken } = await ctx.params;
    if (!isValidToken(orderToken)) {
      return NextResponse.json({ error: "Invalid token" }, { status: 400 });
    }

    const { guestListOrders } = await adminDb.query({
      guestListOrders: { $: { where: { orderToken } } },
    });
    const order = guestListOrders[0] as { id: string } | undefined;
    if (!order) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const buffer = await QRCode.toBuffer(`gl:${order.id}`, {
      width: 400,
      margin: 2,
      errorCorrectionLevel: "H",
      color: { dark: "#1a2b4a", light: "#ffffff" },
    });

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    console.error("[guest-list/qr] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
