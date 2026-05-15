import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { id as genId } from "@instantdb/admin";
import { adminDb } from "@/lib/adminDb";
import { generateOrderToken, isValidToken } from "@/lib/guestListTokens";
import { isValidName } from "@/lib/validation";
import { detectLocale } from "@/lib/serverLocale";
import { sendGuestListTicketEmail } from "@/lib/guestListTicketSender";
import {
  assignGuestListOrderNumber,
  assignUniqueGuestListPrefix,
} from "@/lib/guestListOrderNumber";

type CreateBody = {
  inviteToken: string;
  paymentMethod?: string;
  paymentMethodId?: string;
  referenceNumber?: string;
  paymentProofPath?: string;
  customFieldValues?: string;
  acceptedTermsVersion?: string;
  acceptedPrivacyVersion?: string;
};

export async function POST(req: NextRequest) {
  try {
    const body: CreateBody = await req.json();
    const {
      inviteToken,
      paymentMethod,
      paymentMethodId,
      referenceNumber,
      paymentProofPath,
      customFieldValues,
      acceptedTermsVersion,
      acceptedPrivacyVersion,
    } = body;

    if (!isValidToken(inviteToken)) {
      return NextResponse.json({ error: "Invalid token" }, { status: 400 });
    }
    if (paymentMethod && (!isValidName(paymentMethod) || paymentMethod.length > 100)) {
      return NextResponse.json({ error: "Invalid payment method" }, { status: 400 });
    }
    if (referenceNumber && (typeof referenceNumber !== "string" || referenceNumber.length > 100)) {
      return NextResponse.json({ error: "Invalid reference" }, { status: 400 });
    }
    if (
      paymentProofPath &&
      !/^payment-proofs\/\d+-[a-zA-Z0-9._-]+$/.test(paymentProofPath)
    ) {
      return NextResponse.json({ error: "Invalid proof path" }, { status: 400 });
    }
    if (customFieldValues) {
      if (typeof customFieldValues !== "string" || customFieldValues.length > 5000) {
        return NextResponse.json({ error: "Invalid custom fields" }, { status: 400 });
      }
      try {
        const parsed = JSON.parse(customFieldValues);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          return NextResponse.json({ error: "Invalid custom fields" }, { status: 400 });
        }
      } catch {
        return NextResponse.json({ error: "Invalid custom fields" }, { status: 400 });
      }
    }

    const { guestListEntries } = await adminDb.query({
      guestListEntries: {
        $: { where: { inviteToken } },
        event: { paymentMethods: {} },
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
          ticketType?: unknown;
        }
      | undefined;
    if (!entry) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (entry.status === "registered") {
      return NextResponse.json(
        { error: "Already redeemed" },
        { status: 409 },
      );
    }
    if (entry.status === "revoked") {
      return NextResponse.json({ error: "Revoked" }, { status: 410 });
    }

    const rawEvent = entry.event as unknown;
    const event = (Array.isArray(rawEvent) ? rawEvent[0] : rawEvent) as
      | {
          id: string;
          name: string;
          status: string;
          defaultPrice: number;
          capacity?: number;
          orderNumberPrefix?: string;
          paymentMethods?: {
            id: string;
            name: string;
            requireScreenshot?: boolean;
            requireReferenceNumber?: boolean;
          }[];
        }
      | undefined;
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
    if (event.status !== "active") {
      return NextResponse.json({ error: "Event not active" }, { status: 410 });
    }

    // Capacity check
    if (typeof event.capacity === "number") {
      const { guestListOrders: existingOrders } = await adminDb.query({
        guestListOrders: {
          $: { where: { "entry.event.id": event.id, status: "approved" } },
        },
      });
      if (existingOrders.length >= event.capacity) {
        return NextResponse.json({ error: "Capacity reached" }, { status: 409 });
      }
    }

    // Ensure event has a unique prefix (assign on first order if missing)
    let prefix = event.orderNumberPrefix;
    if (!prefix) {
      prefix = await assignUniqueGuestListPrefix(event.name);
      await adminDb.transact([
        adminDb.tx.guestListEvents[event.id].update({
          orderNumberPrefix: prefix,
        }),
      ]);
    }

    const rawTicketType = entry.ticketType as unknown;
    const ticketType = (Array.isArray(rawTicketType) ? rawTicketType[0] : rawTicketType) as
      | { id: string; price: number }
      | undefined;
    const basePrice = ticketType ? ticketType.price : event.defaultPrice;
    const finalPrice =
      typeof entry.priceOverride === "number"
        ? entry.priceOverride
        : basePrice;
    const isFree = finalPrice === 0;
    const status = isFree ? "approved" : "pending";

    let resolvedPaymentMethod: { id: string; name: string } | undefined;
    if (!isFree) {
      const methods = event.paymentMethods || [];
      if (paymentMethodId) {
        const found = methods.find((m) => m.id === paymentMethodId);
        if (!found) {
          return NextResponse.json(
            { error: "Invalid payment method" },
            { status: 400 },
          );
        }
        resolvedPaymentMethod = { id: found.id, name: found.name };
        if (found.requireScreenshot !== false && !paymentProofPath) {
          return NextResponse.json(
            { error: "Payment proof required" },
            { status: 400 },
          );
        }
        if (found.requireReferenceNumber === true && !referenceNumber) {
          return NextResponse.json(
            { error: "Reference number required" },
            { status: 400 },
          );
        }
      } else {
        if (methods.length > 0) {
          return NextResponse.json(
            { error: "Payment method required" },
            { status: 400 },
          );
        }
        if (!paymentProofPath && !referenceNumber) {
          return NextResponse.json(
            { error: "Payment proof or reference required" },
            { status: 400 },
          );
        }
      }
    }

    const orderId = genId();
    const orderToken = generateOrderToken();
    const orderLanguage = detectLocale(req);

    const fields: Record<string, unknown> = {
      firstName: entry.firstName || "",
      lastName: entry.lastName || "",
      email: entry.email || "",
      cedula: entry.cedula || "",
      status,
      visited: false,
      pricePaid: finalPrice,
      orderToken,
      language: orderLanguage,
      createdAt: Date.now(),
    };
    if (resolvedPaymentMethod) {
      fields.paymentMethod = resolvedPaymentMethod.name;
      fields.paymentMethodId = resolvedPaymentMethod.id;
    } else if (paymentMethod) {
      fields.paymentMethod = paymentMethod;
    }
    if (referenceNumber) fields.proofReferenceNumber = referenceNumber;
    if (paymentProofPath) fields.paymentProofPath = paymentProofPath;
    if (customFieldValues) fields.customFieldValues = customFieldValues;

    const orderTx = adminDb.tx.guestListOrders[orderId]
      .update(fields)
      .link({ entry: entry.id });

    await adminDb.transact([
      ticketType ? orderTx.link({ ticketType: ticketType.id }) : orderTx,
      adminDb.tx.guestListEntries[entry.id].update({
        status: "registered",
        registeredAt: Date.now(),
      }),
    ]);

    if (isFree) {
      // Assign order number + dispatch ticket email asynchronously
      after(async () => {
        try {
          await assignGuestListOrderNumber(orderId, event.id, event.name);
          await sendGuestListTicketEmail(orderId);
        } catch (err) {
          console.error("[guest-list/create-order] post-send error:", err);
        }
      });
    }

    return NextResponse.json({
      orderId,
      orderToken,
      status,
      isFree,
    });
  } catch (err) {
    console.error("[guest-list/create-order] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
