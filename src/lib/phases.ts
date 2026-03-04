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

export function getActivePhase(
  phases: Phase[],
  allOrders: OrderForPhase[],
  today: string, // "YYYY-MM-DD"
): Phase | null {
  const sorted = [...phases].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const phase of sorted) {
    const sold = allOrders.filter(
      (o) =>
        o.phaseId === phase.id &&
        (o.status === "approved" || o.status === "pending"),
    ).length;
    if (sold >= phase.quantity) continue;
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
): Availability {
  if (!phases || phases.length === 0) {
    const approvedOrPending = allOrders.filter(
      (o) => o.status === "approved" || o.status === "pending",
    ).length;
    const available = ticketType.quantity - approvedOrPending;
    return {
      price: ticketType.price,
      available,
      totalCapacity: ticketType.quantity,
      activePhase: null,
      soldOut: available <= 0,
    };
  }

  const activePhase = getActivePhase(phases, allOrders, today);
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

  return {
    price: activePhase.price,
    available: activePhase.quantity - sold,
    totalCapacity: phases.reduce((s, p) => s + p.quantity, 0),
    activePhase,
    soldOut: false,
  };
}

export function getTodayString(): string {
  return new Date().toISOString().slice(0, 10);
}
