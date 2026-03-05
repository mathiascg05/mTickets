export type Phase = {
  id: string;
  name: string;
  price: number;
  quantity: number;
  endDate?: string;
  sortOrder: number;
};

type OrderForPhase = {
  id: string;
  status: string;
  phaseId?: string;
};

type ReservationForPhase = {
  quantity: number;
  expiresAt: number;
  phaseId?: string;
};

function activeReservedQty(
  reservations: ReservationForPhase[],
  phaseId?: string,
): number {
  const now = Date.now();
  return reservations
    .filter((r) => r.expiresAt > now && (phaseId ? r.phaseId === phaseId : true))
    .reduce((sum, r) => sum + r.quantity, 0);
}

export function getActivePhase(
  phases: Phase[],
  allOrders: OrderForPhase[],
  today: string, // "YYYY-MM-DD"
  reservations: ReservationForPhase[] = [],
): Phase | null {
  const sorted = [...phases].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const phase of sorted) {
    const sold = allOrders.filter(
      (o) =>
        o.phaseId === phase.id &&
        (o.status === "approved" || o.status === "pending"),
    ).length;
    const reserved = activeReservedQty(reservations, phase.id);
    if (sold + reserved >= phase.quantity) continue;
    if (phase.endDate && today > phase.endDate) continue;
    return phase;
  }
  return null;
}

export type Availability = {
  price: number;
  available: number;
  totalCapacity: number;
  activePhase: Phase | null;
  soldOut: boolean;
};

export function getAvailability(
  ticketType: { price: number; quantity: number },
  phases: Phase[],
  allOrders: OrderForPhase[],
  today: string,
  reservations: ReservationForPhase[] = [],
): Availability {
  if (!phases || phases.length === 0) {
    const approvedOrPending = allOrders.filter(
      (o) => o.status === "approved" || o.status === "pending",
    ).length;
    const reserved = activeReservedQty(reservations);
    const available = ticketType.quantity - approvedOrPending - reserved;
    return {
      price: ticketType.price,
      available,
      totalCapacity: ticketType.quantity,
      activePhase: null,
      soldOut: available <= 0,
    };
  }

  const activePhase = getActivePhase(phases, allOrders, today, reservations);
  if (!activePhase) {
    return {
      price: ticketType.price,
      available: 0,
      totalCapacity: phases.reduce((s, p) => s + p.quantity, 0),
      activePhase: null,
      soldOut: true,
    };
  }

  const sold = allOrders.filter(
    (o) =>
      o.phaseId === activePhase.id &&
      (o.status === "approved" || o.status === "pending"),
  ).length;
  const reserved = activeReservedQty(reservations, activePhase.id);

  return {
    price: activePhase.price,
    available: activePhase.quantity - sold - reserved,
    totalCapacity: phases.reduce((s, p) => s + p.quantity, 0),
    activePhase,
    soldOut: false,
  };
}

export function getTodayString(): string {
  return new Date().toISOString().slice(0, 10);
}
