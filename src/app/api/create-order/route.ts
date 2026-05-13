import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { id as genId } from "@instantdb/admin";
import { adminDb } from "@/lib/adminDb";
import { getAvailability, getTodayString } from "@/lib/phases";
import { generatePrefix, formatOrderNumber } from "@/lib/orderNumber";
import { transporter, generateMessageId, EMAIL_FROM } from "@/lib/mailer";
import {
  buildConfirmationEmailHtml,
  buildConfirmationEmailText,
} from "@/lib/emailTemplate";
import { isEmailSuppressed } from "@/lib/emailSuppression";
import { buildMailHeaders } from "@/lib/emailHeaders";
import {
  isValidUUID,
  isValidQty,
  isValidName,
  validateAttendee,
} from "@/lib/validation";
import {
  computeOrderTotalAtPurchase,
  computePlatformFeeAtPurchase,
} from "@/lib/order-pricing";
import { errorResponse } from "@/lib/serverI18n";
import { detectLocale, resolveEmailLang } from "@/lib/serverLocale";
import { formatEventDate } from "@/lib/formatters";
import { getTranslations } from "next-intl/server";

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
  paymentMethodId?: string;
  promoter?: string;
  customFieldValues?: string;
  couponCode?: string;
  reservationId?: string;
  referenceNumber?: string;
  paymentProofPath?: string;
  purchaseGroupId?: string;
  queueToken?: string;
  purchaseRate?: number;
  purchaseRateCurrency?: string;
  purchaseAmountBs?: number;
  acceptedTermsVersion?: string;
  acceptedPrivacyVersion?: string;
};

const MAX_RETRIES = 10;

export async function POST(req: NextRequest) {
  try {
    const body: CreateOrderBody = await req.json();
    const {
      ticketTypeId,
      qty,
      attendees,
      paymentMethodName,
      paymentMethodId,
      promoter,
      customFieldValues,
      couponCode,
      reservationId,
      referenceNumber,
      paymentProofPath,
      purchaseGroupId,
      queueToken,
      purchaseRate,
      purchaseRateCurrency,
      purchaseAmountBs,
      acceptedTermsVersion,
      acceptedPrivacyVersion,
    } = body;

    // Input validation
    if (!isValidUUID(ticketTypeId)) {
      return errorResponse(req, "INVALID_TICKET_TYPE", 400);
    }
    if (!isValidQty(qty)) {
      return errorResponse(req, "QTY_OUT_OF_RANGE", 400);
    }
    if (!Array.isArray(attendees) || attendees.length !== qty) {
      return errorResponse(req, "ATTENDEES_MISMATCH", 400);
    }
    const validationErrors = attendees.flatMap((a, i) => validateAttendee(a, i));
    if (validationErrors.length > 0) {
      return errorResponse(req, "VALIDATION_FAILED", 400, {
        extra: { details: validationErrors },
      });
    }
    if (paymentMethodName && (!isValidName(paymentMethodName) || paymentMethodName.length > 100)) {
      return errorResponse(req, "INVALID_INPUT", 400);
    }
    if (paymentMethodId && !isValidUUID(paymentMethodId)) {
      return errorResponse(req, "INVALID_INPUT", 400);
    }
    if (reservationId && !isValidUUID(reservationId)) {
      return errorResponse(req, "INVALID_INPUT", 400);
    }
    if (purchaseGroupId && !isValidUUID(purchaseGroupId)) {
      return errorResponse(req, "INVALID_INPUT", 400);
    }
    if (paymentProofPath && !/^payment-proofs\/\d+-[a-zA-Z0-9._-]+$/.test(paymentProofPath)) {
      return errorResponse(req, "INVALID_INPUT", 400);
    }
    if (referenceNumber && (typeof referenceNumber !== "string" || referenceNumber.length > 100)) {
      return errorResponse(req, "INVALID_INPUT", 400);
    }
    // Check for duplicate reference numbers (skip memo-only codes like "MT-XXXXX")
    if (referenceNumber && !/^MT-[A-Z0-9]{5}$/.test(referenceNumber)) {
      const { orders: existingOrders } = await adminDb.query({
        orders: {
          $: {
            where: {
              proofReferenceNumber: referenceNumber,
              or: [{ status: "approved" }, { status: "pending" }],
            },
          },
        },
      });
      if (existingOrders.length > 0) {
        return errorResponse(req, "REFERENCE_NUMBER_USED", 400);
      }
    }
    if (customFieldValues) {
      if (typeof customFieldValues !== "string" || customFieldValues.length > 5000) {
        return errorResponse(req, "INVALID_INPUT", 400);
      }
      try {
        const parsed = JSON.parse(customFieldValues);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          return errorResponse(req, "INVALID_INPUT", 400);
        }
      } catch {
        return errorResponse(req, "INVALID_INPUT", 400);
      }
    }
    if (couponCode && (typeof couponCode !== "string" || couponCode.length > 50 || !/^[A-Z0-9_-]+$/i.test(couponCode))) {
      return errorResponse(req, "INVALID_COUPON", 400);
    }

    // Query fresh data server-side
    const { ticketTypes } = await adminDb.query({
      ticketTypes: {
        $: { where: { id: ticketTypeId } },
        concert: {
          coupons: {
            $: { where: { active: true } },
          },
          paymentMethods: {},
          platformFeeConfig: {},
        },
        orders: {},
        phases: {
          $: { order: { sortOrder: "asc" } },
        },
        reservations: {},
        queueEntries: {},
      },
    });

    const ticketType = ticketTypes[0];
    if (!ticketType) {
      return errorResponse(req, "TICKET_TYPE_NOT_FOUND", 404);
    }

    // Admin SDK returns has-one relations as arrays
    const rawConcert = ticketType.concert as unknown;
    const concert = (Array.isArray(rawConcert) ? rawConcert[0] : rawConcert) as {
      id: string;
      name: string;
      date: string;
      venue?: string;
      slug: string;
      status: string;
      lastOrderSeq?: number;
      orderNumberPrefix?: string;
      defaultLanguage?: string;
      coupons: { id: string; code: string; discountType: string; discountValue: number; maxUses?: number; active: boolean }[];
      paymentMethods: { id: string; type?: string; name: string; discountType?: string; discountValue?: number }[];
      platformFeeConfig?: { feePercent: number; feeFixed: number; billingMode?: string } | { feePercent: number; feeFixed: number; billingMode?: string }[];
    };

    if (!concert) {
      return errorResponse(req, "CONCERT_NOT_FOUND", 404);
    }

    if (concert.status !== "active") {
      return errorResponse(req, "EVENT_NOT_AVAILABLE", 404);
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
    const allQueueEntries = (ticketType.queueEntries || []) as {
      id: string;
      status: string;
      expiresAt: number;
    }[];

    // Validate reservationId belongs to this ticketType
    let validatedReservationId = reservationId;
    if (reservationId && !allReservations.some((r) => r.id === reservationId)) {
      validatedReservationId = undefined;
    }

    // Validate queueToken belongs to this ticketType
    let validatedQueueToken = queueToken;
    if (queueToken && !allQueueEntries.some((e) => e.id === queueToken)) {
      validatedQueueToken = undefined;
    }

    // Filter out expired reservations and the buyer's own reservation
    const activeReservations = allReservations.filter(
      (r) => r.expiresAt > Date.now() && r.id !== validatedReservationId,
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
      return errorResponse(req, "NOT_ENOUGH_TICKETS", 409, {
        extra: { available },
      });
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
        return errorResponse(req, "INVALID_COUPON", 400);
      }
      if (!coupon.active) {
        return errorResponse(req, "COUPON_INACTIVE", 400);
      }
      if (coupon.maxUses != null) {
        const usageCount = allOrders.filter(
          (o) =>
            o.couponCode === coupon.code &&
            (o.status === "approved" || o.status === "pending"),
        ).length;
        if (usageCount >= coupon.maxUses) {
          return errorResponse(req, "COUPON_LIMIT_REACHED", 400);
        }
      }

      const subtotal = effectivePrice * qty;
      discountAmount =
        coupon.discountType === "percentage"
          ? Math.min(subtotal, subtotal * (coupon.discountValue / 100))
          : Math.min(coupon.discountValue, subtotal);
      validatedCouponCode = coupon.code;
    }

    // Validate and compute payment-method discount server-side
    let paymentMethodDiscount = 0;
    if (paymentMethodId) {
      const pm = (concert.paymentMethods || []).find(
        (p) => p.id === paymentMethodId,
      );
      if (
        pm?.discountType &&
        typeof pm.discountValue === "number" &&
        pm.discountValue > 0
      ) {
        const subtotal = effectivePrice * qty;
        const computed =
          pm.discountType === "percentage"
            ? subtotal * (pm.discountValue / 100)
            : pm.discountValue;
        paymentMethodDiscount = Math.max(
          0,
          Math.min(computed, subtotal - discountAmount),
        );
        paymentMethodDiscount = Math.round(paymentMethodDiscount * 100) / 100;
      }
    }

    // Generate order numbers using atomic counter with retry.
    // Prefer the prefix stored on the concert (assigned at concert creation
    // and guaranteed unique by schema). Fallback to name-derived prefix only
    // for legacy concerts that haven't been backfilled yet.
    const prefix = concert.orderNumberPrefix || generatePrefix(concert.name);
    let currentSeq = 0;

    const orderIds: string[] = [];
    const orderNumbers: string[] = [];
    const trimmedAttendees = attendees.map((a) => ({
      firstName: a.firstName.trim(),
      lastName: a.lastName.trim(),
      email: a.email.trim(),
      cedula: a.cedula.trim(),
    }));

    // Capture buyer's locale for downstream email delivery
    const orderLanguage = detectLocale(req);

    const feePercentSnapshot = ticketType.feePercent ?? 0;
    const feeFixedSnapshot = ticketType.feeFixed ?? 0;
    const perOrderCouponDiscount =
      (validatedCouponCode ? discountAmount : 0) / qty;
    const perOrderPmDiscount = paymentMethodDiscount / qty;
    const { feeAmount: feeAmountSnapshot, total: totalSnapshot } =
      computeOrderTotalAtPurchase({
        basePrice: effectivePrice,
        feePercent: feePercentSnapshot,
        feeFixed: feeFixedSnapshot,
        couponDiscount: perOrderCouponDiscount,
        paymentMethodDiscount: perOrderPmDiscount,
      });

    const rawPlatformFeeConfig = concert.platformFeeConfig;
    const platformFeeConfig = (
      Array.isArray(rawPlatformFeeConfig)
        ? rawPlatformFeeConfig[0]
        : rawPlatformFeeConfig
    ) as { feePercent: number; feeFixed: number } | undefined;
    const platformFeePercentSnapshot = platformFeeConfig?.feePercent ?? 0;
    const platformFeeFixedSnapshot = platformFeeConfig?.feeFixed ?? 0;
    const platformFeeAmountSnapshot = computePlatformFeeAtPurchase({
      basePrice: effectivePrice,
      feePercent: platformFeePercentSnapshot,
      feeFixed: platformFeeFixedSnapshot,
    });

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
            language: orderLanguage,
            priceSnapshot: effectivePrice,
            feePercentSnapshot,
            feeFixedSnapshot,
            feeAmountSnapshot,
            totalSnapshot,
            platformFeePercentSnapshot,
            platformFeeFixedSnapshot,
            platformFeeAmountSnapshot,
            ...(paymentProofPath ? { paymentProofPath } : {}),
            ...(referenceNumber ? { proofReferenceNumber: referenceNumber } : {}),
            ...(promoter ? { promoter } : {}),
            ...(customFieldValues ? { customFieldValues } : {}),
            ...(validatedCouponCode
              ? { couponCode: validatedCouponCode, discountAmount }
              : {}),
            ...(paymentMethodDiscount > 0 ? { paymentMethodDiscount } : {}),
            ...(activePhase ? { phaseId: activePhase.id } : {}),
            ...(purchaseGroupId ? { purchaseGroupId } : {}),
            ...(purchaseRate ? { purchaseRate, purchaseRateCurrency } : {}),
            ...(purchaseAmountBs != null ? { purchaseAmountBs } : {}),
            ...(acceptedTermsVersion ? { acceptedTermsVersion } : {}),
            ...(acceptedPrivacyVersion ? { acceptedPrivacyVersion } : {}),
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
          // Cleanup: free capacity slot so other users can proceed
          const failCleanup = [
            ...(validatedReservationId ? [adminDb.tx.reservations[validatedReservationId].delete()] : []),
            ...(validatedQueueToken ? [adminDb.tx.queueEntries[validatedQueueToken].update({ status: "expired" })] : []),
          ];
          if (failCleanup.length > 0) {
            try { await adminDb.transact(failCleanup); } catch { /* best effort */ }
          }
          return errorResponse(req, "CREATE_ORDER_FAILED", 500);
        }
        console.warn(`[create-order] Transaction attempt ${attempt + 1} failed, retrying:`, err);
        await new Promise((r) => setTimeout(r, 50 + Math.random() * 200));
      }
    }

    // Cleanup reservation and queue entry after successful order creation
    const cleanupTxns = [
      ...(validatedReservationId
        ? [adminDb.tx.reservations[validatedReservationId].delete()]
        : []),
      ...(validatedQueueToken
        ? [adminDb.tx.queueEntries[validatedQueueToken].update({ status: "completed" })]
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

        if (freshAvail.available < 0) {
          rollback = true;
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
            }
          }
        }

        if (rollback) {
          // Rollback: delete created orders, restore concert seq, restore queue entry
          const rollbackTxns = [
            ...orderIds.map((oid) => adminDb.tx.orders[oid].delete()),
            adminDb.tx.concerts[concert.id].update({ lastOrderSeq: currentSeq }),
            ...(validatedQueueToken
              ? [adminDb.tx.queueEntries[validatedQueueToken].update({ status: "admitted" })]
              : []),
          ];
          await adminDb.transact(rollbackTxns);

          return errorResponse(req, "CONCURRENT_CONFLICT", 409);
        }
      }
    }

    // Send confirmation emails in the background (Vercel after() support)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    after(async () => {
      const emailFrom = EMAIL_FROM;
      if (!emailFrom) return;

      const emailLang = resolveEmailLang(orderLanguage, concert.defaultLanguage);
      const tEmail = await getTranslations({ locale: emailLang, namespace: "emails.confirmation" });
      const eventDateFormatted = formatEventDate(concert.date, emailLang);

      for (let idx = 0; idx < orderIds.length; idx++) {
        const orderId = orderIds[idx];
        const attendee = trimmedAttendees[idx];
        const orderNumber = orderNumbers[idx];
        const orderUrl = `${appUrl}/ticket/${orderId}`;

        const emailParams = {
          firstName: attendee.firstName,
          lastName: attendee.lastName,
          eventName: concert.name,
          eventDate: eventDateFormatted,
          venue: concert.venue || "",
          ticketTypeName: ticketType.name,
          price: `$${totalSnapshot.toFixed(2)}`,
          orderUrl,
          orderNumber,
          lang: emailLang,
        };

        if (await isEmailSuppressed(attendee.email)) {
          console.log(`[create-order] Skipping suppressed email: ${attendee.email}`);
          continue;
        }

        const mailOptions = {
          from: `"maTickets" <${emailFrom}>`,
          replyTo: emailFrom,
          to: attendee.email,
          subject: tEmail("subject", { orderNumber, eventName: concert.name }),
          html: await buildConfirmationEmailHtml(emailParams),
          text: await buildConfirmationEmailText(emailParams),
          messageId: generateMessageId(),
          date: new Date(),
          envelope: { from: emailFrom, to: attendee.email },
          headers: buildMailHeaders(attendee.email),
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
    return errorResponse(req, "INTERNAL_ERROR", 500);
  }
}
