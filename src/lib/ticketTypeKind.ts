export type TicketTypeKindInput = {
  peoplePerTicket?: number;
};

export function getPeoplePerTicket(tt: TicketTypeKindInput): number {
  const n = tt.peoplePerTicket;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

export function isAreaTicket(tt: TicketTypeKindInput): boolean {
  return getPeoplePerTicket(tt) > 1;
}
