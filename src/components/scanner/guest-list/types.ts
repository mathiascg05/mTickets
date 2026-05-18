export type GuestOrder = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  cedula: string;
  status: string;
  visited: boolean;
  visitedAt: number | null;
  orderNumber: string | null;
  ticketType: { id: string; name: string } | null;
};
