import { NextRequest, NextResponse } from "next/server";
import { id as genId } from "@instantdb/admin";
import { adminDb } from "@/lib/adminDb";
import { getAvailability, getTodayString } from "@/lib/phases";
import { isValidUUID, isValidQty } from "@/lib/validation";

const RESERVATION_DURATION = 25 * 60 * 1000; // 25 minutes

export async function POST(req: NextRequest) {
  try {
    const { ticketTypeId, qty } = await req.json();

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

    return NextResponse.json({ reservationId, expiresAt }, { status: 200 });
  } catch (err) {
    console.error("[create-reservation] Error:", err);
    return NextResponse.json(
      { error: "Failed to create reservation" },
      { status: 500 },
    );
  }
}
