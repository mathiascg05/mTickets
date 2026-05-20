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
  priceSnapshot?: number;
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
  isArea = false,
): Phase | null {
  const sorted = [...phases].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const phase of sorted) {
    const sold = allOrders.filter(
      (o) =>
        o.phaseId === phase.id &&
        (o.status === "approved" || o.status === "pending") &&
        (!isArea || (o.priceSnapshot ?? 0) > 0),
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
  displayPhase: Phase | null;
  soldOut: boolean;
};

function getLastSoldPhase(
  phases: Phase[],
  allOrders: OrderForPhase[],
  isArea = false,
): Phase | null {
  if (phases.length === 0) return null;
  const sortedDesc = [...phases].sort((a, b) => b.sortOrder - a.sortOrder);
  const withSales = sortedDesc.find((p) =>
    allOrders.some(
      (o) =>
        o.phaseId === p.id &&
        (o.status === "approved" || o.status === "pending") &&
        (!isArea || (o.priceSnapshot ?? 0) > 0),
    ),
  );
  return withSales ?? sortedDesc[0];
}

export function getAvailability(
  ticketType: { price: number; quantity: number; peoplePerTicket?: number },
  phases: Phase[],
  allOrders: OrderForPhase[],
  today: string,
  reservations: ReservationForPhase[] = [],
): Availability {
  const isArea = (ticketType.peoplePerTicket ?? 1) > 1;

  if (!phases || phases.length === 0) {
    const approvedOrPending = allOrders.filter(
      (o) =>
        (o.status === "approved" || o.status === "pending") &&
        (!isArea || (o.priceSnapshot ?? 0) > 0),
    ).length;
    const reserved = activeReservedQty(reservations);
    const available = ticketType.quantity - approvedOrPending - reserved;
    return {
      price: ticketType.price,
      available,
      totalCapacity: ticketType.quantity,
      activePhase: null,
      displayPhase: null,
      soldOut: available <= 0,
    };
  }

  const activePhase = getActivePhase(phases, allOrders, today, reservations, isArea);
  if (!activePhase) {
    const lastSold = getLastSoldPhase(phases, allOrders, isArea);
    return {
      price: lastSold?.price ?? ticketType.price,
      available: 0,
      totalCapacity: phases.reduce((s, p) => s + p.quantity, 0),
      activePhase: null,
      displayPhase: lastSold,
      soldOut: true,
    };
  }

  const sold = allOrders.filter(
    (o) =>
      o.phaseId === activePhase.id &&
      (o.status === "approved" || o.status === "pending") &&
      (!isArea || (o.priceSnapshot ?? 0) > 0),
  ).length;
  const reserved = activeReservedQty(reservations, activePhase.id);

  return {
    price: activePhase.price,
    available: activePhase.quantity - sold - reserved,
    totalCapacity: phases.reduce((s, p) => s + p.quantity, 0),
    activePhase,
    displayPhase: activePhase,
    soldOut: false,
  };
}

export function getTodayString(): string {
  return new Date().toISOString().slice(0, 10);
}
