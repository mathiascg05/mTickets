import { NextRequest, NextResponse } from "next/server";
import { id as genId } from "@instantdb/admin";
import { adminDb } from "@/lib/adminDb";
import { getAvailability, getTodayString } from "@/lib/phases";
import { isValidUUID, isValidQty } from "@/lib/validation";
import { QUEUE_THRESHOLD } from "@/lib/queueConstants";

const RESERVATION_DURATION = 10 * 60 * 1000; // 10 minutes

export async function POST(req: NextRequest) {
  try {
    const { ticketTypeId, qty, queueToken } = await req.json();

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

    const { ticketTypes } = await adminDb.query({
      ticketTypes: {
        $: { where: { id: ticketTypeId } },
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
      return NextResponse.json(
        { error: "Ticket type not found" },
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
    }[];
    const allReservations = (ticketType.reservations || []) as {
      id: string;
      quantity: number;
      expiresAt: number;
      phaseId?: string;
    }[];
    const activeReservations = allReservations.filter(
      (r) => r.expiresAt > Date.now(),
    );

    const today = getTodayString();
    const { available, activePhase } = getAvailability(
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

    // Queue gate: if queue is active, require a valid queueToken
    const now = Date.now();
    const qEntries = ticketType.queueEntries || [];
    const activeWaiters = qEntries.filter(
      (e: { status: string; expiresAt: number }) =>
        e.status === "waiting" && e.expiresAt > now,
    ).length;
    const admittedCount = qEntries.filter(
      (e: { status: string; expiresAt: number }) =>
        e.status === "admitted" && e.expiresAt > now,
    ).length;
    const activeBuyers = activeReservations.length + admittedCount;
    const queueActive = activeBuyers >= QUEUE_THRESHOLD || activeWaiters > 0;

    if (queueActive && !queueToken) {
      return NextResponse.json(
        { error: "Queue is active. Please join the queue first." },
        { status: 403 },
      );
    }

    if (queueToken) {
      const tokenEntry = qEntries.find(
        (e: { id: string; status: string; expiresAt: number }) =>
          e.id === queueToken && e.status === "admitted" && e.expiresAt > now,
      );
      if (!tokenEntry) {
        return NextResponse.json(
          { error: "Invalid or expired queue token." },
          { status: 403 },
        );
      }
    }

    const reservationId = genId();
    const expiresAt = Date.now() + RESERVATION_DURATION;

    await adminDb.transact(
      adminDb.tx.reservations[reservationId]
        .update({
          quantity: qty,
          expiresAt,
          createdAt: Date.now(),
          ...(activePhase ? { phaseId: activePhase.id } : {}),
        })
        .link({ ticketType: ticketTypeId }),
    );

    // Mark queue entry as "purchasing" so it's no longer counted as "admitted"
    // This fixes the double-counting bug where activeBuyers = reservations + admitted
    if (queueToken) {
      await adminDb.transact(
        adminDb.tx.queueEntries[queueToken].update({ status: "purchasing" }),
      );
    }

    // ── Post-write validation: re-read and rollback if overbooked ──
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
        const freshOrders = freshTT.orders as { id: string; status: string; phaseId?: string }[];
        const freshReservations = ((freshTT.reservations || []) as { id: string; quantity: number; expiresAt: number; phaseId?: string }[])
          .filter((r) => r.expiresAt > Date.now());
        const freshPhases = (freshTT.phases || []) as { id: string; name: string; price: number; quantity: number; endDate?: string; sortOrder: number }[];

        const freshAvail = getAvailability(freshTT, freshPhases, freshOrders, getTodayString(), freshReservations);

        if (freshAvail.available < 0) {
          // Rollback: delete the just-created reservation
          await adminDb.transact(
            adminDb.tx.reservations[reservationId].delete(),
          );
          return NextResponse.json(
            { error: "Tickets oversold due to concurrent reservation. Please try again.", code: "CONCURRENT_CONFLICT" },
            { status: 409 },
          );
        }
      }
    }

    return NextResponse.json({ reservationId, expiresAt }, { status: 200 });
  } catch (err) {
    console.error("[create-reservation] Error:", err);
    return NextResponse.json(
      { error: "Failed to create reservation" },
      { status: 500 },
    );
  }
}
