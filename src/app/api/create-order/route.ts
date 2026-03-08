import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { id as genId } from "@instantdb/admin";
import { adminDb } from "@/lib/adminDb";
import { getAvailability, getTodayString } from "@/lib/phases";
import { generatePrefix, formatOrderNumber } from "@/lib/orderNumber";
import { transporter, generateMessageId } from "@/lib/mailer";
import {
  buildConfirmationEmailHtml,
  buildConfirmationEmailText,
} from "@/lib/emailTemplate";
import {
  isValidUUID,
  isValidQty,
  isValidName,
  validateAttendee,
} from "@/lib/validation";

type CreateOrderBody = {
  ticketTypeId: string;
  qty: number;
  attendees: {
    firstName: string;
    lastName: string;
    email: string;
    cedula: string;
  }[];
  paymentMethodName: string;
  promoter?: string;
  couponCode?: string;
  reservationId?: string;
  referenceNumber?: string;
  paymentProofPath?: string;
  purchaseGroupId?: string;
  queueToken?: string;
};

const MAX_RETRIES = 5;

export async function POST(req: NextRequest) {
  try {
    const body: CreateOrderBody = await req.json();
    const {
      ticketTypeId,
      qty,
      attendees,
      paymentMethodName,
      promoter,
      couponCode,
      reservationId,
      referenceNumber,
      paymentProofPath,
      purchaseGroupId,
      queueToken,
    } = body;

    // Input validation
    if (!isValidUUID(ticketTypeId)) {
      return NextResponse.json(
        { error: "Invalid ticketTypeId format" },
        { status: 400 },
      );
    }
    if (!isValidQty(qty)) {
      return NextResponse.json(
        { error: "qty must be an integer between 1 and 10" },
        { status: 400 },
      );
    }
    if (!Array.isArray(attendees) || attendees.length !== qty) {
      return NextResponse.json(
        { error: "attendees array must match qty" },
        { status: 400 },
      );
    }
    const validationErrors = attendees.flatMap((a, i) => validateAttendee(a, i));
    if (validationErrors.length > 0) {
      return NextResponse.json(
        { error: "Validation failed", details: validationErrors },
        { status: 400 },
      );
    }
    if (paymentMethodName && (!isValidName(paymentMethodName) || paymentMethodName.length > 100)) {
      return NextResponse.json(
        { error: "Invalid payment method name" },
        { status: 400 },
      );
    }
    if (reservationId && !isValidUUID(reservationId)) {
      return NextResponse.json(
        { error: "Invalid reservationId format" },
        { status: 400 },
      );
    }
    if (purchaseGroupId && !isValidUUID(purchaseGroupId)) {
      return NextResponse.json(
        { error: "Invalid purchaseGroupId format" },
        { status: 400 },
      );
    }

    // Query fresh data server-side
    const { ticketTypes } = await adminDb.query({
      ticketTypes: {
        $: { where: { id: ticketTypeId } },
        concert: {
          coupons: {
            $: { where: { active: true } },
          },
        },
        orders: {},
        phases: {
          $: { order: { sortOrder: "asc" } },
        },
        reservations: {},
      },
    });

    const ticketType = ticketTypes[0];
    if (!ticketType) {
      return NextResponse.json(
        { error: "Ticket type not found" },
        { status: 404 },
      );
    }

    // Admin SDK returns has-one relations as arrays
    const rawConcert = ticketType.concert as unknown;
    const concert = (Array.isArray(rawConcert) ? rawConcert[0] : rawConcert) as {
      id: string;
      name: string;
      date: string;
      venue?: string;
      slug: string;
      lastOrderSeq?: number;
      coupons: { id: string; code: string; discountType: string; discountValue: number; maxUses?: number; active: boolean }[];
    };

    if (!concert) {
      return NextResponse.json(
        { error: "Concert not found for this ticket type" },
        { status: 404 },
      );
    }

    const phases = (ticketType.phases || []) as {
      id: string;
      name: string;
      price: number;
      quantity: number;
      endDate?: string;
      sortOrder: number;
    }[];
    const allOrders = ticketType.orders as {
      id: string;
      status: string;
      phaseId?: string;
      couponCode?: string;
    }[];
    const allReservations = (ticketType.reservations || []) as {
      id: string;
      quantity: number;
      expiresAt: number;
      phaseId?: string;
    }[];

    // Filter out expired reservations and the buyer's own reservation
    const activeReservations = allReservations.filter(
      (r) => r.expiresAt > Date.now() && r.id !== reservationId,
    );

    const today = getTodayString();
    const { available, activePhase, price: effectivePrice } = getAvailability(
      ticketType,
      phases,
      allOrders,
      today,
      activeReservations,
    );

    if (available < qty) {
      return NextResponse.json(
        { error: "Not enough tickets available", available },
        { status: 409 },
      );
    }

    // Validate coupon server-side
    let discountAmount = 0;
    let validatedCouponCode: string | undefined;
    if (couponCode) {
      const coupons = concert.coupons || [];
      const coupon = coupons.find(
        (c) => c.code.toUpperCase() === couponCode.toUpperCase(),
      );
      if (!coupon) {
        return NextResponse.json(
          { error: "Invalid coupon code" },
          { status: 400 },
        );
      }
      if (!coupon.active) {
        return NextResponse.json(
          { error: "Coupon is no longer active" },
          { status: 400 },
        );
      }
      if (coupon.maxUses != null) {
        const usageCount = allOrders.filter(
          (o) =>
            o.couponCode === coupon.code &&
            (o.status === "approved" || o.status === "pending"),
        ).length;
        if (usageCount >= coupon.maxUses) {
          return NextResponse.json(
            { error: "Coupon usage limit reached" },
            { status: 400 },
          );
        }
      }

      const subtotal = effectivePrice * qty;
      discountAmount =
        coupon.discountType === "percentage"
          ? Math.min(subtotal, subtotal * (coupon.discountValue / 100))
          : Math.min(coupon.discountValue, subtotal);
      validatedCouponCode = coupon.code;
    }

    // Generate order numbers using atomic counter with retry
    const prefix = generatePrefix(concert.name);
    let currentSeq = 0;

    const orderIds: string[] = [];
    const orderNumbers: string[] = [];
    const trimmedAttendees = attendees.map((a) => ({
      firstName: a.firstName.trim(),
      lastName: a.lastName.trim(),
      email: a.email.trim(),
      cedula: a.cedula.trim(),
    }));

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      // Always read fresh lastOrderSeq to avoid collisions
      const { concerts: freshConcerts } = await adminDb.query({
        concerts: { $: { where: { id: concert.id } } },
      });
      currentSeq = freshConcerts[0]?.lastOrderSeq || 0;

      orderIds.length = 0;
      orderNumbers.length = 0;

      const orderTxns = trimmedAttendees.map((attendee, idx) => {
        const orderId = genId();
        const seq = currentSeq + idx + 1;
        const orderNumber = formatOrderNumber(prefix, seq);
        orderIds.push(orderId);
        orderNumbers.push(orderNumber);

        return adminDb.tx.orders[orderId]
          .update({
            firstName: attendee.firstName,
            lastName: attendee.lastName,
            email: attendee.email,
            cedula: attendee.cedula,
            paymentMethod: paymentMethodName,
            status: "pending",
            visited: false,
            createdAt: Date.now(),
            orderNumber,
            ...(paymentProofPath ? { paymentProofPath } : {}),
            ...(referenceNumber ? { proofReferenceNumber: referenceNumber } : {}),
            ...(promoter ? { promoter } : {}),
            ...(validatedCouponCode
              ? { couponCode: validatedCouponCode, discountAmount }
              : {}),
            ...(activePhase ? { phaseId: activePhase.id } : {}),
            ...(purchaseGroupId ? { purchaseGroupId } : {}),
          })
          .link({ ticketType: ticketTypeId });
      });

      // Update concert's lastOrderSeq
      const newSeq = currentSeq + qty;
      const seqTxn = adminDb.tx.concerts[concert.id].update({
        lastOrderSeq: newSeq,
      });

      const allTxns = [...orderTxns, seqTxn];

      try {
        await adminDb.transact(allTxns);
        break; // Success
      } catch (err) {
        if (attempt === MAX_RETRIES - 1) {
          console.error("[create-order] Transaction failed after retries:", err);
          return NextResponse.json(
            { error: "Failed to create order. Please try again." },
            { status: 500 },
          );
        }
        console.warn(`[create-order] Transaction attempt ${attempt + 1} failed, retrying...`);
        await new Promise((r) => setTimeout(r, 50 + Math.random() * 150));
      }
    }

    // Cleanup reservation and queue entry after successful order creation
    const cleanupTxns = [
      ...(reservationId
        ? [adminDb.tx.reservations[reservationId].delete()]
        : []),
      ...(queueToken
        ? [adminDb.tx.queueEntries[queueToken].update({ status: "completed" })]
        : []),
    ];
    if (cleanupTxns.length > 0) {
      try {
        await adminDb.transact(cleanupTxns);
      } catch (err) {
        console.error("[create-order] Cleanup transaction failed:", err);
      }
    }

    // ── Post-write validation: re-read and rollback if invariants violated ──
    {
      const { ticketTypes: freshTTs } = await adminDb.query({
        ticketTypes: {
          $: { where: { id: ticketTypeId } },
          orders: {},
          phases: {
            $: { order: { sortOrder: "asc" } },
          },
          reservations: {},
        },
      });

      const freshTT = freshTTs[0];
      if (freshTT) {
        const freshOrders = freshTT.orders as { id: string; status: string; phaseId?: string; couponCode?: string }[];
        const freshReservations = ((freshTT.reservations || []) as { id: string; quantity: number; expiresAt: number; phaseId?: string }[])
          .filter((r) => r.expiresAt > Date.now());
        const freshPhases = (freshTT.phases || []) as { id: string; name: string; price: number; quantity: number; endDate?: string; sortOrder: number }[];

        const freshAvail = getAvailability(freshTT, freshPhases, freshOrders, getTodayString(), freshReservations);

        let rollback = false;
        let rollbackReason = "";

        if (freshAvail.available < 0) {
          rollback = true;
          rollbackReason = "Tickets oversold due to concurrent purchase. Please try again.";
        }

        // Check coupon overuse
        if (!rollback && validatedCouponCode) {
          const coupons = concert.coupons || [];
          const coupon = coupons.find((c) => c.code.toUpperCase() === validatedCouponCode!.toUpperCase());
          if (coupon?.maxUses != null) {
            const usageCount = freshOrders.filter(
              (o) =>
                o.couponCode === coupon.code &&
                (o.status === "approved" || o.status === "pending"),
            ).length;
            if (usageCount > coupon.maxUses) {
              rollback = true;
              rollbackReason = "Coupon usage limit exceeded due to concurrent purchase. Please try again.";
            }
          }
        }

        if (rollback) {
          // Rollback: delete created orders, restore concert seq, restore queue entry
          const rollbackTxns = [
            ...orderIds.map((oid) => adminDb.tx.orders[oid].delete()),
            adminDb.tx.concerts[concert.id].update({ lastOrderSeq: currentSeq }),
            ...(queueToken
              ? [adminDb.tx.queueEntries[queueToken].update({ status: "admitted" })]
              : []),
          ];
          await adminDb.transact(rollbackTxns);

          return NextResponse.json(
            { error: rollbackReason, code: "CONCURRENT_CONFLICT" },
            { status: 409 },
          );
        }
      }
    }

    // Send confirmation emails in the background (Vercel after() support)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    after(async () => {
      const gmailUser = process.env.GMAIL_USER;
      if (!gmailUser) return;

      for (let idx = 0; idx < orderIds.length; idx++) {
        const orderId = orderIds[idx];
        const attendee = trimmedAttendees[idx];
        const orderNumber = orderNumbers[idx];
        const phase = activePhase
          ? phases.find((p) => p.id === activePhase.id)
          : null;
        const basePrice = phase ? phase.price : ticketType.price;
        const finalPrice = basePrice - (validatedCouponCode ? discountAmount : 0);
        const orderUrl = `${appUrl}/ticket/${orderId}`;

        const emailParams = {
          firstName: attendee.firstName,
          lastName: attendee.lastName,
          eventName: concert.name,
          eventDate: concert.date,
          venue: concert.venue || "",
          ticketTypeName: ticketType.name,
          price: `$${finalPrice.toFixed(2)}`,
          orderUrl,
          orderNumber,
        };

        const mailOptions = {
          from: `"maTickets" <${gmailUser}>`,
          replyTo: gmailUser,
          to: attendee.email,
          subject: `Order ${orderNumber} - ${concert.name}`,
          html: buildConfirmationEmailHtml(emailParams),
          text: buildConfirmationEmailText(emailParams),
          messageId: generateMessageId(),
          date: new Date(),
          envelope: { from: gmailUser, to: attendee.email },
          headers: {
            "List-Unsubscribe": `<mailto:${gmailUser}?subject=unsubscribe>`,
            "X-Mailer": "maTickets",
          },
        };

        try {
          await transporter.sendMail(mailOptions);
        } catch (err) {
          console.error(`[create-order] Email failed for order ${orderId}:`, err);
        }
      }
    });

    return NextResponse.json({ orderIds }, { status: 200 });
  } catch (err) {
    console.error("[create-order] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
