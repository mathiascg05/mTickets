import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { isValidToken } from "@/lib/guestListTokens";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await ctx.params;
    if (!isValidToken(token)) {
      return NextResponse.json({ error: "Invalid token" }, { status: 400 });
    }

    const { guestListEntries } = await adminDb.query({
      guestListEntries: {
        $: { where: { inviteToken: token } },
        event: {
          paymentMethods: { $: { order: { sortOrder: "asc" } } },
          customFields: { $: { order: { sortOrder: "asc" } } },
        },
        order: {},
        ticketType: {},
      },
    });
    const entry = guestListEntries[0] as
      | {
          id: string;
          email?: string;
          cedula?: string;
          firstName?: string;
          lastName?: string;
          priceOverride?: number;
          status: string;
          event: unknown;
          order?: unknown;
          ticketType?: unknown;
        }
      | undefined;

    if (!entry) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const rawEvent = entry.event as unknown;
    const event = (Array.isArray(rawEvent) ? rawEvent[0] : rawEvent) as
      | {
          id: string;
          name: string;
          slug: string;
          date: string;
          venue?: string;
          venueMapUrl?: string;
          description?: string;
          status: string;
          flyerUrl?: string;
          flyerPath?: string;
          logoUrl?: string;
          logoPath?: string;
          primaryColor?: string;
          defaultLanguage?: string;
          defaultPrice: number;
          organizerEmail: string;
          paymentMethods?: {
            id: string;
            type: string;
            name: string;
            instructions?: string;
            convertCurrency?: string;
            requireScreenshot?: boolean;
            requireReferenceNumber?: boolean;
            zelleEmail?: string;
            zelleName?: string;
            pmCedula?: string;
            pmPhone?: string;
            pmBank?: string;
            sortOrder: number;
          }[];
          customFields?: {
            id: string;
            label: string;
            fieldType: string;
            required: boolean;
            options?: string;
            sortOrder: number;
          }[];
        }
      | undefined;
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
    if (event.status !== "active") {
      return NextResponse.json({ error: "Event not active" }, { status: 410 });
    }

    if (entry.status === "revoked") {
      return NextResponse.json({ error: "Invitation revoked" }, { status: 410 });
    }

    const rawTicketType = entry.ticketType as unknown;
    const ticketType = (Array.isArray(rawTicketType) ? rawTicketType[0] : rawTicketType) as
      | { id: string; name: string; price: number; description?: string }
      | undefined;
    const basePrice = ticketType ? ticketType.price : event.defaultPrice;
    const finalPrice =
      typeof entry.priceOverride === "number"
        ? entry.priceOverride
        : basePrice;

    if (entry.status === "registered") {
      const rawOrder = entry.order as unknown;
      const order = (Array.isArray(rawOrder) ? rawOrder[0] : rawOrder) as
        | { orderToken: string }
        | undefined;
      return NextResponse.json({
        status: "registered",
        orderToken: order?.orderToken,
      });
    }

    return NextResponse.json({
      status: "invited",
      entry: {
        id: entry.id,
        firstName: entry.firstName || "",
        lastName: entry.lastName || "",
        email: entry.email || "",
        cedula: entry.cedula || "",
        finalPrice,
        ticketType: ticketType
          ? {
              id: ticketType.id,
              name: ticketType.name,
              description: ticketType.description || "",
            }
          : null,
      },
      event: {
        id: event.id,
        name: event.name,
        slug: event.slug,
        date: event.date,
        venue: event.venue || "",
        venueMapUrl: event.venueMapUrl || "",
        description: event.description || "",
        flyerUrl: event.flyerUrl || "",
        flyerPath: event.flyerPath || "",
        logoUrl: event.logoUrl || "",
        logoPath: event.logoPath || "",
        primaryColor: event.primaryColor || "#1a2b4a",
        defaultLanguage: event.defaultLanguage || "es",
        organizerEmail: event.organizerEmail,
      },
      paymentMethods: (event.paymentMethods || []).sort(
        (a, b) => a.sortOrder - b.sortOrder,
      ),
      customFields: (event.customFields || []).sort(
        (a, b) => a.sortOrder - b.sortOrder,
      ),
    });
  } catch (err) {
    console.error("[guest-list/redeem] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
