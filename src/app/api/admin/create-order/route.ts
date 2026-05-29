import { NextRequest, NextResponse } from "next/server";
import { id as genId } from "@instantdb/admin";
import { adminDb } from "@/lib/adminDb";
import { isAuthorizedForConcert } from "@/lib/authHelpers";
import { approveOrderInternal } from "@/lib/approveOrder";
import { getAvailability, getTodayString } from "@/lib/phases";
import {
  isValidUUID,
  isValidQty,
  isValidName,
  isValidEmail,
  isValidCedula,
} from "@/lib/validation";
import { computePlatformFeeAtPurchase } from "@/lib/order-pricing";
import { errorResponse } from "@/lib/serverI18n";
import { recordAuditLog } from "@/lib/auditLog";

type AdminCreateOrderBody = {
  ticketTypeId: string;
  qty: number;
  firstName: string;
  lastName: string;
  email: string;
  cedula: string;
  customFieldValues?: string;
  promoter?: string;
  paymentMethodName: string;
  isCortesia: boolean;
  status: "approved" | "pending";
  paymentProofPath?: string;
  purchaseRate?: number;
  purchaseRateCurrency?: string;
  purchaseAmountBs?: number;
};

export async function POST(req: NextRequest) {
  try {
    const authToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!authToken) {
      return errorResponse(req, "UNAUTHORIZED", 401);
    }
    const user = await adminDb.auth.verifyToken(authToken);
    if (!user?.email) {
      return errorResponse(req, "UNAUTHORIZED", 401);
    }

    const body: AdminCreateOrderBody = await req.json();
    const {
      ticketTypeId,
      qty,
      firstName,
      lastName,
      email,
      cedula,
      customFieldValues,
      promoter,
      paymentMethodName,
      isCortesia,
      status,
      paymentProofPath,
      purchaseRate,
      purchaseRateCurrency,
      purchaseAmountBs,
    } = body;

    // Input validation
    if (!isValidUUID(ticketTypeId)) {
      return errorResponse(req, "INVALID_TICKET_TYPE", 400);
    }
    if (!isValidQty(qty)) {
      return errorResponse(req, "QTY_OUT_OF_RANGE", 400);
    }
    if (!isValidName(firstName) || !isValidName(lastName)) {
      return errorResponse(req, "INVALID_INPUT", 400);
    }
    if (!isValidEmail(email)) {
      return errorResponse(req, "INVALID_INPUT", 400);
    }
    if (!isValidCedula(cedula)) {
      return errorResponse(req, "INVALID_INPUT", 400);
    }
    if (typeof paymentMethodName !== "string" || !isValidName(paymentMethodName) || paymentMethodName.length > 100) {
      return errorResponse(req, "INVALID_INPUT", 400);
    }
    if (status !== "approved" && status !== "pending") {
      return errorResponse(req, "INVALID_INPUT", 400);
    }
    if (typeof isCortesia !== "boolean") {
      return errorResponse(req, "INVALID_INPUT", 400);
    }
    if (paymentProofPath !== undefined) {
      if (typeof paymentProofPath !== "string" || paymentProofPath.length > 200) {
        return errorResponse(req, "INVALID_INPUT", 400);
      }
      const allowed =
        paymentProofPath === "cortesia" ||
        paymentProofPath === "admin-created" ||
        /^payment-proofs\/\d+-[a-zA-Z0-9._-]+$/.test(paymentProofPath);
      if (!allowed) {
        return errorResponse(req, "INVALID_INPUT", 400);
      }
    }
    if (customFieldValues !== undefined) {
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
    if (promoter !== undefined && (typeof promoter !== "string" || promoter.length > 200)) {
      return errorResponse(req, "INVALID_INPUT", 400);
    }
    if (purchaseRate !== undefined && (typeof purchaseRate !== "number" || !Number.isFinite(purchaseRate) || purchaseRate <= 0)) {
      return errorResponse(req, "INVALID_INPUT", 400);
    }
    if (purchaseRateCurrency !== undefined && (typeof purchaseRateCurrency !== "string" || purchaseRateCurrency.length > 10)) {
      return errorResponse(req, "INVALID_INPUT", 400);
    }
    if (purchaseAmountBs !== undefined && (typeof purchaseAmountBs !== "number" || !Number.isFinite(purchaseAmountBs) || purchaseAmountBs < 0)) {
      return errorResponse(req, "INVALID_INPUT", 400);
    }

    // Load ticketType + concert + collaborators + paymentMethods + phases + orders
    const { ticketTypes } = await adminDb.query({
      ticketTypes: {
        $: { where: { id: ticketTypeId } },
        concert: {
          collaborators: {},
          paymentMethods: {},
          platformFeeConfig: {},
        },
        orders: {},
        phases: { $: { order: { sortOrder: "asc" } } },
      },
    });

    const ticketType = ticketTypes[0];
    if (!ticketType) {
      return errorResponse(req, "TICKET_TYPE_NOT_FOUND", 404);
    }

    const rawConcert = ticketType.concert as unknown;
    const concert = (Array.isArray(rawConcert) ? rawConcert[0] : rawConcert) as
      | {
          id: string;
          name: string;
          organizerEmail: string;
          collaborators?: { email: string }[];
          paymentMethods?: { id: string; name: string }[];
          platformFeeConfig?:
            | { feePercent: number; feeFixed: number; billingMode?: string }
            | { feePercent: number; feeFixed: number; billingMode?: string }[];
        }
      | undefined;

    if (!concert) {
      return errorResponse(req, "CONCERT_NOT_FOUND", 404);
    }

    // Authorization: organizer / collaborator / super admin
    if (!isAuthorizedForConcert(user.email, concert)) {
      return errorResponse(req, "FORBIDDEN", 403);
    }

    const phases = (ticketType.phases || []) as {
      id: string;
      name: string;
      price: number;
      quantity: number;
      endDate?: string;
      sortOrder: number;
    }[];
    const allOrders = ticketType.orders as { id: string; status: string; phaseId?: string }[];

    const today = getTodayString();
    const { available, activePhase, price: effectivePrice } = getAvailability(
      ticketType,
      phases,
      allOrders,
      today,
    );

    if (available < qty) {
      return errorResponse(req, "NOT_ENOUGH_TICKETS", 409, {
        extra: { available },
      });
    }

    // Ticket-type fees (admin flow uses ticketType fee mode like the previous client-side path)
    const feePercentSnapshot = (ticketType as { feePercent?: number }).feePercent ?? 0;
    const feeFixedSnapshot = (ticketType as { feeFixed?: number }).feeFixed ?? 0;
    const feeAmountSnapshot =
      (effectivePrice * feePercentSnapshot) / 100 + feeFixedSnapshot;
    const grossPerOrder = effectivePrice + feeAmountSnapshot;
    const couponDiscountPerOrder = isCortesia ? grossPerOrder : 0;
    const totalSnapshot = Math.max(0, grossPerOrder - couponDiscountPerOrder);

    // Platform fee
    const rawPlatformFeeConfig = concert.platformFeeConfig;
    const platformFeeConfig = (
      Array.isArray(rawPlatformFeeConfig)
        ? rawPlatformFeeConfig[0]
        : rawPlatformFeeConfig
    ) as { feePercent: number; feeFixed: number; billingMode?: string } | undefined;
    const platformFeePercentSnapshot = platformFeeConfig?.feePercent ?? 0;
    const platformFeeFixedSnapshot = platformFeeConfig?.feeFixed ?? 0;
    const platformFeeAmountSnapshot = isCortesia
      ? 0
      : computePlatformFeeAtPurchase({
          basePrice: effectivePrice,
          feePercent: platformFeePercentSnapshot,
          feeFixed: platformFeeFixedSnapshot,
        });
    const billingMode = platformFeeConfig?.billingMode || "prepaid";

    // Pre-check: if the admin asked to create as "approved" and this batch
    // will incur platform fees (not cortesía), make sure the organizer has
    // enough balance (prepaid only). Mirrors `/api/approve-order`'s 402 shape.
    if (
      status === "approved" &&
      !isCortesia &&
      platformFeeAmountSnapshot > 0 &&
      billingMode === "prepaid"
    ) {
      const totalFeeRequired =
        Math.round(platformFeeAmountSnapshot * qty * 100) / 100;
      const { organizerBalances } = await adminDb.query({
        organizerBalances: {
          $: { where: { email: concert.organizerEmail.toLowerCase() } },
        },
      });
      const balance = organizerBalances[0];
      if (!balance || balance.balance < totalFeeRequired) {
        return NextResponse.json(
          {
            error: balance ? "INSUFFICIENT_BALANCE" : "NO_BALANCE",
            message: balance
              ? "Insufficient balance to approve this order."
              : "No balance found. Please top up your account.",
            requiredFee: totalFeeRequired,
            currentBalance: balance?.balance ?? 0,
          },
          { status: 402 },
        );
      }
    }

    const effectivePaymentMethod = isCortesia ? "Cortesia" : paymentMethodName;
    const purchaseGroupId = qty > 1 ? genId() : undefined;
    const orderIds: string[] = [];

    const trimmed = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      cedula: cedula.trim(),
    };

    const orderTxns = Array.from({ length: qty }, () => {
      const orderId = genId();
      orderIds.push(orderId);

      const monetaryExtras = isCortesia
        ? { discountAmount: grossPerOrder }
        : purchaseRate != null && purchaseRateCurrency
          ? {
              purchaseRate,
              purchaseRateCurrency,
              ...(purchaseAmountBs != null ? { purchaseAmountBs } : {}),
            }
          : {};

      return adminDb.tx.orders[orderId]
        .update({
          firstName: trimmed.firstName,
          lastName: trimmed.lastName,
          email: trimmed.email,
          cedula: trimmed.cedula,
          paymentMethod: effectivePaymentMethod,
          // Always create as pending; if admin requested "approved" we route
          // through `approveOrderInternal` afterwards so the fee debit and the
          // balance transaction happen under the same code path used by the
          // manual "Aprobar" flow.
          status: "pending",
          paymentProofPath: paymentProofPath ?? (isCortesia ? "cortesia" : "admin-created"),
          visited: false,
          createdAt: Date.now(),
          priceSnapshot: effectivePrice,
          feePercentSnapshot,
          feeFixedSnapshot,
          feeAmountSnapshot,
          totalSnapshot,
          platformFeePercentSnapshot,
          platformFeeFixedSnapshot,
          platformFeeAmountSnapshot,
          ...(activePhase ? { phaseId: activePhase.id } : {}),
          ...(purchaseGroupId ? { purchaseGroupId } : {}),
          ...monetaryExtras,
          ...(customFieldValues ? { customFieldValues } : {}),
          ...(promoter ? { promoter } : {}),
        })
        .link({ ticketType: ticketTypeId });
    });

    try {
      await adminDb.transact(orderTxns);
    } catch (err) {
      console.error("[admin/create-order] Transaction failed:", err);
      return errorResponse(req, "CREATE_ORDER_FAILED", 500);
    }

    // If admin asked for "approved", route each created order through the
    // standard approve flow so the organizer's balance is debited and a
    // `balanceTransactions` row is recorded (cortesía short-circuits at the
    // `platformFee > 0` check inside `approveOrderInternal` since the
    // snapshot is 0).
    if (status === "approved") {
      const approveResults = await Promise.all(
        orderIds.map((oid) => approveOrderInternal(oid, { skipEmail: true })),
      );
      const failures = approveResults
        .map((r, i) => ({ orderId: orderIds[i], result: r }))
        .filter((x) => !x.result.success);
      if (failures.length > 0) {
        const first = failures[0].result;
        console.error("[admin/create-order] Approve failures:", failures);
        return NextResponse.json(
          {
            error: "PARTIAL_APPROVE_FAILED",
            message:
              first.error ||
              "Some orders were created but could not be approved.",
            orderIds,
            approvedCount: approveResults.filter((r) => r.success).length,
            failedCount: failures.length,
            firstErrorCode: first.errorCode,
            requiredFee: first.requiredFee,
            currentBalance: first.currentBalance,
          },
          { status: 500 },
        );
      }
    }

    await recordAuditLog({
      action: "order.create_admin",
      actorEmail: user.email,
      entityType: "order",
      entityId: orderIds[0],
      concertId: concert.id,
      summary: isCortesia
        ? `Creó ${qty} cortesía(s) para ${trimmed.email}`
        : `Creó ${qty} orden(es) (${status}) para ${trimmed.email}`,
      metadata: {
        count: qty,
        orderIds,
        isCortesia,
        status,
        ticketTypeId,
        email: trimmed.email,
      },
    });

    return NextResponse.json({ orderIds }, { status: 200 });
  } catch (err) {
    console.error("[admin/create-order] Unexpected error:", err);
    return errorResponse(req, "INTERNAL_ERROR", 500);
  }
}
