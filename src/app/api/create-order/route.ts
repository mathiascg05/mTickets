import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { id as genId } from "@instantdb/admin";
import { adminDb } from "@/lib/adminDb";
import {
  orderIdFor,
  extraGroupIdFor,
  extraItemIdFor,
} from "@/lib/deterministicId";
import {
  priceExtraSelection,
  extraSoldQty,
  extraAvailableStock,
  type ExtraSelection,
} from "@/lib/extras";
import {
  getAvailability,
  getTodayString,
  committedAllotmentQty,
} from "@/lib/phases";
import { generatePrefix, generateOrderCode } from "@/lib/orderNumber";
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
import { getPeoplePerTicket, isAreaTicket } from "@/lib/ticketTypeKind";
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
    phone: string;
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
  // Extras comprados en este checkout. UNA sola vez por compra, no por asistente.
  extras?: ExtraSelection[];
  submissionId?: string;
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
      submissionId,
      queueToken,
      purchaseRate,
      purchaseRateCurrency,
      purchaseAmountBs,
      acceptedTermsVersion,
      acceptedPrivacyVersion,
    } = body;
    const extrasSelection: ExtraSelection[] = Array.isArray(body.extras)
      ? body.extras
      : [];

    // Input validation
    if (!isValidUUID(ticketTypeId)) {
      return errorResponse(req, "INVALID_TICKET_TYPE", 400);
    }
    if (!isValidQty(qty)) {
      return errorResponse(req, "QTY_OUT_OF_RANGE", 400);
    }
    // Early validation: attendees must be ≥ qty (1+ persona por unidad) y razonablemente bounded.
    // El match exacto contra qty*peoplePerTicket se valida después de la query del ticketType.
    if (!Array.isArray(attendees) || attendees.length < qty || attendees.length > qty * 20) {
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
    if (extrasSelection.length > 20) {
      return errorResponse(req, "INVALID_INPUT", 400);
    }
    for (const sel of extrasSelection) {
      if (
        !sel ||
        !isValidUUID(sel.extraId) ||
        !Number.isInteger(sel.quantity) ||
        sel.quantity < 1 ||
        sel.quantity > 99
      ) {
        return errorResponse(req, "INVALID_INPUT", 400);
      }
    }
    // Un mismo extra no puede venir repetido: el pool se indexa por extraId.
    if (new Set(extrasSelection.map((e) => e.extraId)).size !== extrasSelection.length) {
      return errorResponse(req, "INVALID_INPUT", 400);
    }
    if (submissionId && !isValidUUID(submissionId)) {
      return errorResponse(req, "INVALID_INPUT", 400);
    }
    // Idempotency short-circuit: if this exact checkout submission already
    // produced orders (double-click / retry), return them instead of creating
    // duplicates or re-charging a coupon. Orders carry idempotencyKey =
    // submissionId, and their ids are derived from it (orderIdFor) so a truly
    // concurrent retry upserts the same rows rather than inserting new ones.
    if (submissionId) {
      const { orders: prior } = await adminDb.query({
        orders: {
          $: { where: { idempotencyKey: submissionId } },
        },
      });
      if (prior.length > 0) {
        return NextResponse.json(
          { orderIds: prior.map((o) => o.id) },
          { status: 200 },
        );
      }
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
          // Stock de extras: cada linea vendida cuenta mientras su checkout
          // tenga al menos una orden viva (ni rechazada ni cancelada).
          extras: {
            purchaseItems: {
              group: {
                orders: {},
              },
            },
          },
        },
        orders: {},
        phases: {
          $: { order: { sortOrder: "asc" } },
        },
        reservations: {},
        queueEntries: {},
        allotmentItems: {},
      },
    });

    const ticketType = ticketTypes[0];
    if (!ticketType) {
      return errorResponse(req, "TICKET_TYPE_NOT_FOUND", 404);
    }

    const peoplePerTicket = getPeoplePerTicket(ticketType);
    const isArea = isAreaTicket(ticketType);
    const expectedAttendees = qty * peoplePerTicket;
    if (attendees.length !== expectedAttendees) {
      return errorResponse(req, "ATTENDEES_MISMATCH", 400);
    }
    if (isArea && qty !== 1) {
      // V1: una sola área por compra para evitar 2×8=16 forms.
      return errorResponse(req, "QTY_OUT_OF_RANGE", 400);
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
      feeMode?: string;
      coupons: { id: string; code: string; discountType: string; discountValue: number; maxUses?: number; active: boolean }[];
      paymentMethods: { id: string; type?: string; name: string; discountType?: string; discountValue?: number; feePercent?: number; feeFixed?: number }[];
      platformFeeConfig?: { feePercent: number; feeFixed: number; billingMode?: string } | { feePercent: number; feeFixed: number; billingMode?: string }[];
      extras?: {
        id: string;
        name: string;
        price: number;
        stock?: number;
        active?: boolean;
        purchasable?: boolean;
        purchaseItems?: {
          quantity: number;
          group?: { orders?: { status?: string }[] } | { orders?: { status?: string }[] }[];
        }[];
      }[];
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

    // Seats committed to school allotments hold inventory from creation and are
    // invisible to the phase-aware order count, so subtract them explicitly to
    // prevent cross-channel oversell (open sale vs allotment).
    const committedQty = committedAllotmentQty(
      (ticketType.allotmentItems || []) as { quantity: number; status?: string }[],
    );

    const today = getTodayString();
    const { available, activePhase, price: effectivePrice } = getAvailability(
      ticketType,
      phases,
      allOrders,
      today,
      activeReservations,
      committedQty,
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

    const feeMode =
      concert.feeMode === "paymentMethod" ? "paymentMethod" : "ticketType";

    // Validate and compute payment-method discount + fee server-side
    let paymentMethodDiscount = 0;
    let pmFeePercent = 0;
    let pmFeeFixed = 0;
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
      if (pm && feeMode === "paymentMethod") {
        pmFeePercent = pm.feePercent ?? 0;
        pmFeeFixed = pm.feeFixed ?? 0;
      }
    }

    // ── Extras ────────────────────────────────────────────────────────────
    // Se recalculan igual que las entradas: el precio sale SIEMPRE del catalogo,
    // nunca del cliente. Cupones y descuento por metodo ya quedaron calculados
    // sobre el subtotal de entradas, asi que los extras no los tocan.
    const catalogExtras = concert.extras || [];
    for (const sel of extrasSelection) {
      const extra = catalogExtras.find((e) => e.id === sel.extraId);
      if (!extra) {
        return errorResponse(req, "EXTRA_NOT_FOUND", 404);
      }
      if (extra.active === false || extra.purchasable !== true) {
        return errorResponse(req, "EXTRA_NOT_AVAILABLE", 409);
      }
      const availableStock = extraAvailableStock(
        extra,
        extraSoldQty(extra.purchaseItems),
      );
      if (sel.quantity > availableStock) {
        return errorResponse(req, "EXTRA_OUT_OF_STOCK", 409, {
          extra: { extraId: extra.id, available: Number.isFinite(availableStock) ? availableStock : null },
        });
      }
    }
    const { lines: extraLines, subtotal: extrasSubtotal } = priceExtraSelection(
      extrasSelection,
      catalogExtras,
    );

    // Order numbers: random, non-sequential code (`PREFIX-XXXXXX`). No per-concert
    // counter → no serialization point → no contention under high concurrency.
    // Prefer the prefix stored on the concert (assigned at concert creation,
    // unique by schema). Fallback to name-derived prefix for legacy concerts.
    const prefix = concert.orderNumberPrefix || generatePrefix(concert.name);

    const orderIds: string[] = [];
    const orderNumbers: string[] = [];
    const trimmedAttendees = attendees.map((a) => ({
      firstName: a.firstName.trim(),
      lastName: a.lastName.trim(),
      email: a.email.trim(),
      cedula: a.cedula.trim(),
      phone: a.phone.trim(),
    }));
    // Para áreas, generamos un purchaseGroupId server-side por cada unidad de
    // área (qty áreas → qty groupIds). Para individuales mantenemos el del body.
    const unitGroupIds: string[] = isArea
      ? Array.from({ length: qty }, () => genId())
      : [];

    // Capture buyer's locale for downstream email delivery
    const orderLanguage = detectLocale(req);

    const feePercentSnapshot =
      feeMode === "ticketType" ? (ticketType.feePercent ?? 0) : 0;
    const feeFixedSnapshot =
      feeMode === "ticketType" ? (ticketType.feeFixed ?? 0) : 0;
    const perOrderCouponDiscount =
      (validatedCouponCode ? discountAmount : 0) / qty;
    const perOrderPmDiscount = paymentMethodDiscount / qty;
    const {
      feeAmount: feeAmountSnapshot,
      paymentMethodFeeAmount: paymentMethodFeeAmountSnapshot,
      total: totalSnapshot,
    } = computeOrderTotalAtPurchase({
      basePrice: effectivePrice,
      feePercent: feePercentSnapshot,
      feeFixed: feeFixedSnapshot,
      paymentMethodFeePercent: pmFeePercent,
      paymentMethodFeeFixed: pmFeeFixed,
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

    // Los extras son plata del CHECKOUT, no de una entrada, asi que viajan
    // enteros en la orden ancla (indice 0) — la misma convencion por la que las
    // companions de un area llevan todos los snapshots en 0 y solo la primary
    // carga cupon y purchaseAmountBs. Sumarlos a totalSnapshot y a
    // platformFeeAmountSnapshot hace que Ingresos Totales, Totales Combinados y
    // los "creditos para aprobar" cuadren sin tocar order-pricing ni approveOrder.
    const anchorPlatformFeeAmountSnapshot =
      extrasSubtotal > 0
        ? computePlatformFeeAtPurchase({
            basePrice: effectivePrice,
            feePercent: platformFeePercentSnapshot,
            feeFixed: platformFeeFixedSnapshot,
            extrasBase: extrasSubtotal,
          })
        : platformFeeAmountSnapshot;
    const extrasPlatformFeeSnapshot =
      Math.round((anchorPlatformFeeAmountSnapshot - platformFeeAmountSnapshot) * 100) / 100;
    const extrasAmountBs =
      extrasSubtotal > 0 && purchaseRate
        ? Math.round(extrasSubtotal * purchaseRate * 100) / 100
        : undefined;
    // Un doble-submit con el mismo submissionId reescribe EL MISMO pool en vez
    // de crear un segundo que duplicaria el derecho.
    const extraGroupId =
      extrasSubtotal > 0
        ? submissionId
          ? extraGroupIdFor(submissionId)
          : genId()
        : undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      orderIds.length = 0;
      orderNumbers.length = 0;

      // Para áreas: cada `qty` (unidades de área) genera un purchaseGroup propio,
      // con 1 primary (que lleva el precio + fees) y peoplePerTicket-1 companions
      // a precio 0. Para tickets individuales: peoplePerTicket=1, cada attendee es
      // su propia primary (comportamiento legacy).
      const orderTxns = trimmedAttendees.map((attendee, idx) => {
        // Deterministic order id when a submissionId is present → a retry/
        // double-submit upserts the SAME rows instead of duplicating them.
        const orderId = submissionId ? orderIdFor(submissionId, idx) : genId();
        const orderNumber = `${prefix}-${generateOrderCode()}`;
        orderIds.push(orderId);
        orderNumbers.push(orderNumber);

        const positionInUnit = idx % peoplePerTicket;
        const unitIndex = Math.floor(idx / peoplePerTicket);
        const isPrimary = positionInUnit === 0;
        // Para áreas, cada unidad recibe su propio purchaseGroupId server-side.
        // Para individuales con qty>1, mantenemos el purchaseGroupId del body si vino.
        const groupId = isArea
          ? unitGroupIds[unitIndex]
          : purchaseGroupId;

        const baseFields = {
          firstName: attendee.firstName,
          lastName: attendee.lastName,
          email: attendee.email,
          cedula: attendee.cedula,
          phone: attendee.phone,
          paymentMethod: paymentMethodName,
          status: "pending",
          visited: false,
          createdAt: Date.now(),
          orderNumber,
          language: orderLanguage,
        };

        // La orden ancla del checkout es la del indice 0: absorbe los extras.
        const isExtrasAnchor = idx === 0 && extrasSubtotal > 0;
        const pricingFields = isPrimary
          ? {
              priceSnapshot: effectivePrice,
              feePercentSnapshot,
              feeFixedSnapshot,
              feeAmountSnapshot,
              totalSnapshot: isExtrasAnchor
                ? Math.round((totalSnapshot + extrasSubtotal) * 100) / 100
                : totalSnapshot,
              platformFeePercentSnapshot,
              platformFeeFixedSnapshot,
              platformFeeAmountSnapshot: isExtrasAnchor
                ? anchorPlatformFeeAmountSnapshot
                : platformFeeAmountSnapshot,
              paymentMethodFeePercentSnapshot: pmFeePercent,
              paymentMethodFeeFixedSnapshot: pmFeeFixed,
              paymentMethodFeeAmountSnapshot,
            }
          : {
              priceSnapshot: 0,
              feePercentSnapshot: 0,
              feeFixedSnapshot: 0,
              feeAmountSnapshot: 0,
              totalSnapshot: 0,
              platformFeePercentSnapshot: 0,
              platformFeeFixedSnapshot: 0,
              platformFeeAmountSnapshot: 0,
              paymentMethodFeePercentSnapshot: 0,
              paymentMethodFeeFixedSnapshot: 0,
              paymentMethodFeeAmountSnapshot: 0,
            };

        // Cupón/descuento + purchaseRate solo en la primary (evita inflar usageCount
        // del cupón y duplicar el snapshot de la conversión Bs).
        // IMPORTANTE: guardamos el descuento POR ENTRADA (perOrder...), no el total
        // del carrito. matickets crea una fila por entrada; almacenar el total en
        // cada fila lo mostraba duplicado (×qty) en admin, tickets y correos.
        const monetaryExtras = isPrimary
          ? {
              ...(validatedCouponCode
                ? { couponCode: validatedCouponCode, discountAmount: perOrderCouponDiscount }
                : {}),
              ...(perOrderPmDiscount > 0 ? { paymentMethodDiscount: perOrderPmDiscount } : {}),
              ...(purchaseRate ? { purchaseRate, purchaseRateCurrency } : {}),
              ...(purchaseAmountBs != null ? { purchaseAmountBs } : {}),
            }
          : {};
        const extrasFields = isExtrasAnchor
          ? {
              extrasSubtotalSnapshot: extrasSubtotal,
              extrasPlatformFeeSnapshot,
              ...(extrasAmountBs != null ? { extrasAmountBs } : {}),
            }
          : {};

        const orderTx = adminDb.tx.orders[orderId]
          .update({
            ...baseFields,
            ...pricingFields,
            ...monetaryExtras,
            ...extrasFields,
            ...(paymentProofPath ? { paymentProofPath } : {}),
            ...(referenceNumber ? { proofReferenceNumber: referenceNumber } : {}),
            ...(promoter ? { promoter } : {}),
            ...(customFieldValues ? { customFieldValues } : {}),
            ...(activePhase ? { phaseId: activePhase.id } : {}),
            ...(groupId ? { purchaseGroupId: groupId } : {}),
            ...(acceptedTermsVersion ? { acceptedTermsVersion } : {}),
            ...(acceptedPrivacyVersion ? { acceptedPrivacyVersion } : {}),
            ...(submissionId ? { idempotencyKey: submissionId } : {}),
          })
          .link({ ticketType: ticketTypeId });
        // Cualquier QR del checkout puede canjear del pool, asi que TODAS las
        // ordenes se enlazan al grupo (incluidas las companions de un area).
        return extraGroupId
          ? orderTx.link({ extraPurchaseGroup: extraGroupId })
          : orderTx;
      });

      const extrasTxns = extraGroupId
        ? [
            adminDb.tx.extraPurchaseGroups[extraGroupId]
              .update({
                ...(submissionId ? { submissionId } : {}),
                anchorOrderId: orderIds[0],
                subtotalSnapshot: extrasSubtotal,
                createdAt: Date.now(),
              })
              .link({ concert: concert.id }),
            ...extraLines.map((line) =>
              adminDb.tx.extraPurchaseItems[extraItemIdFor(extraGroupId, line.extraId)]
                .update({
                  quantity: line.quantity,
                  unitPriceSnapshot: line.unitPrice,
                  subtotalSnapshot: line.subtotal,
                  extraNameSnapshot: line.name,
                  createdAt: Date.now(),
                })
                .link({ group: extraGroupId, extra: line.extraId }),
            ),
          ]
        : [];

      try {
        // El grupo va PRIMERO: las ordenes lo enlazan por id y asi la entidad
        // existe dentro de la misma transaccion atomica.
        await adminDb.transact([...extrasTxns, ...orderTxns]);
        break; // Success
      } catch (err) {
        // Reintento solo ante la rara colisión del orderNumber aleatorio (unique)
        // o un fallo transitorio. Cada intento regenera los códigos.
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
          allotmentItems: {},
        },
      });

      const freshTT = freshTTs[0];
      if (freshTT) {
        const freshOrders = freshTT.orders as { id: string; status: string; phaseId?: string; couponCode?: string; allotmentId?: string }[];
        const freshReservations = ((freshTT.reservations || []) as { id: string; quantity: number; expiresAt: number; phaseId?: string }[])
          .filter((r) => r.expiresAt > Date.now());
        const freshPhases = (freshTT.phases || []) as { id: string; name: string; price: number; quantity: number; endDate?: string; sortOrder: number }[];
        const freshCommitted = committedAllotmentQty(
          (freshTT.allotmentItems || []) as { quantity: number; status?: string }[],
        );

        const freshAvail = getAvailability(freshTT, freshPhases, freshOrders, getTodayString(), freshReservations, freshCommitted);

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
          // Rollback: borrar las órdenes creadas y restaurar el queue token.
          // (Ya no hay contador que restaurar: los orderNumber son aleatorios.)
          const rollbackTxns = [
            ...orderIds.map((oid) => adminDb.tx.orders[oid].delete()),
            // El pool de extras muere con la compra: si las ordenes se van, el
            // derecho a canjear tambien.
            ...(extraGroupId
              ? [
                  ...extraLines.map((line) =>
                    adminDb.tx.extraPurchaseItems[
                      extraItemIdFor(extraGroupId, line.extraId)
                    ].delete(),
                  ),
                  adminDb.tx.extraPurchaseGroups[extraGroupId].delete(),
                ]
              : []),
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

      const includedLabel = emailLang === "en"
        ? `Included in ${ticketType.name}`
        : `Incluido en ${ticketType.name}`;
      for (let idx = 0; idx < orderIds.length; idx++) {
        const orderId = orderIds[idx];
        const attendee = trimmedAttendees[idx];
        const orderNumber = orderNumbers[idx];
        const orderUrl = `${appUrl}/ticket/${orderId}`;
        const isCompanion = isArea && idx % peoplePerTicket !== 0;

        const emailParams = {
          firstName: attendee.firstName,
          lastName: attendee.lastName,
          eventName: concert.name,
          eventDate: eventDateFormatted,
          venue: concert.venue || "",
          ticketTypeName: ticketType.name,
          price: isCompanion ? includedLabel : `$${totalSnapshot.toFixed(2)}`,
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
