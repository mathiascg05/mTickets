import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { isValidUUID } from "@/lib/validation";
import { WAITING_TTL, ADMITTED_TTL } from "@/lib/queueConstants";
import { processQueueAdmissions } from "@/lib/queueAdmission";

/**
 * Heartbeat de la cola. Para no saturar la base de datos bajo alta concurrencia
 * (cada waiter latía cada 15s leyendo TODAS las queueEntries del ticketType dos
 * veces → ~O(N²)), separamos dos caminos:
 *
 *  - BARATO (default, cada latido): lee SOLO el propio entry + el concierto,
 *    extiende su TTL y devuelve su estado actual. Si otro evento (create-reservation
 *    al liberar un slot) ya lo admitió, el estado ya está actualizado y lo refleja.
 *    No calcula posición ni procesa admisiones → una sola lectura puntual.
 *
 *  - COMPLETO (`full: true`, cada ~3 latidos / ~45s): además lee todas las
 *    queueEntries para calcular posición y corre processQueueAdmissions como
 *    backstop. La admisión en tiempo real la siguen disparando join-queue y
 *    create-reservation (que liberan slots), así que sigue siendo oportuna.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { queueEntryId } = body;
    const full = body.full === true;

    if (!isValidUUID(queueEntryId)) {
      return NextResponse.json(
        { error: "Invalid queueEntryId format" },
        { status: 400 },
      );
    }

    const { queueEntries } = await adminDb.query({
      queueEntries: {
        $: { where: { id: queueEntryId } },
        ticketType: {
          concert: {},
          // Solo en el camino completo traemos a los hermanos (lectura pesada).
          ...(full ? { queueEntries: {} } : {}),
        },
      },
    });

    const entry = queueEntries[0];
    if (!entry) {
      return NextResponse.json(
        { error: "Queue entry not found" },
        { status: 404 },
      );
    }

    const rawConcertHeartbeat = entry.ticketType?.concert as unknown;
    const concertForHeartbeat = (Array.isArray(rawConcertHeartbeat)
      ? rawConcertHeartbeat[0]
      : rawConcertHeartbeat) as { status?: string } | undefined;
    if (concertForHeartbeat && concertForHeartbeat.status !== "active") {
      return NextResponse.json(
        { error: "Event is not available", code: "event_unavailable" },
        { status: 404 },
      );
    }

    if (entry.status !== "waiting" && entry.status !== "admitted") {
      return NextResponse.json({
        status: entry.status,
        position: 0,
        totalWaiting: 0,
        estimatedWaitMin: 0,
      });
    }

    // Extender TTL (siempre, barato).
    const newExpiresAt =
      entry.status === "waiting"
        ? Date.now() + WAITING_TTL
        : Date.now() + ADMITTED_TTL;

    await adminDb.transact(
      adminDb.tx.queueEntries[queueEntryId].update({
        expiresAt: newExpiresAt,
      }),
    );

    // Camino BARATO: devolver el estado propio sin calcular posición ni procesar
    // admisiones. El cliente conserva su última posición conocida (position null).
    if (!full) {
      return NextResponse.json({
        status: entry.status,
        position: null,
        totalWaiting: null,
        estimatedWaitMin: null,
      });
    }

    // Camino COMPLETO: backstop de admisión + posición.
    const ticketTypeId = entry.ticketType?.id;
    if (ticketTypeId) {
      await processQueueAdmissions(ticketTypeId);
    }

    const now = Date.now();
    const allEntries = entry.ticketType?.queueEntries || [];
    const waitingAhead =
      entry.status === "waiting"
        ? allEntries.filter(
            (e: { status: string; expiresAt: number; position: number }) =>
              e.status === "waiting" &&
              e.expiresAt > now &&
              e.position < entry.position,
          ).length
        : 0;

    const totalWaiting = allEntries.filter(
      (e: { status: string; expiresAt: number }) =>
        e.status === "waiting" && e.expiresAt > now,
    ).length;

    const estimatedWaitMin = Math.max(1, Math.ceil((waitingAhead * 30) / 60));

    return NextResponse.json({
      status: entry.status,
      position: waitingAhead + 1,
      totalWaiting,
      estimatedWaitMin,
    });
  } catch (err) {
    console.error("[queue-heartbeat] Error:", err);
    return NextResponse.json(
      { error: "Failed to process heartbeat" },
      { status: 500 },
    );
  }
}
