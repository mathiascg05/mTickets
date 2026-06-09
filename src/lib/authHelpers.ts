export const SUPER_ADMIN_EMAIL = "matickets.ve@gmail.com";

export function isSuperAdmin(email: string | undefined | null): boolean {
  return email?.toLowerCase() === SUPER_ADMIN_EMAIL;
}

export type ConcertAuthInfo = {
  organizerEmail: string;
  collaborators?: { email: string }[] | null;
};

export function isAuthorizedForConcert(
  userEmail: string,
  concert: string | ConcertAuthInfo,
): boolean {
  const lower = userEmail.toLowerCase();
  if (lower === SUPER_ADMIN_EMAIL) return true;

  if (typeof concert === "string") {
    return lower === concert.toLowerCase();
  }

  if (lower === concert.organizerEmail.toLowerCase()) return true;
  return (concert.collaborators ?? []).some(
    (c) => c.email.toLowerCase() === lower,
  );
}

export function isPrimaryOrganizer(
  userEmail: string,
  concertOrganizerEmail: string,
): boolean {
  const lower = userEmail.toLowerCase();
  return (
    lower === SUPER_ADMIN_EMAIL ||
    lower === concertOrganizerEmail.toLowerCase()
  );
}

type AuthFailure = { ok: false; status: number; error: string };
type AuthSuccess = { ok: true };

export type ConcertAccessInfo = {
  id: string;
  name: string;
  slug: string;
  organizerEmail: string;
  defaultLanguage?: string;
  primaryColor?: string;
  collaborators?: { email: string }[];
};

export async function assertOrganizerCanAccessConcert(
  userEmail: string | undefined | null,
  concertId: string,
): Promise<({ ok: true } & { data: ConcertAccessInfo }) | AuthFailure> {
  if (!userEmail) return { ok: false, status: 401, error: "Unauthorized" };

  const { adminDb } = await import("./adminDb");
  const { concerts } = await adminDb.query({
    concerts: {
      $: { where: { id: concertId } },
      collaborators: {},
    },
  });

  const concert = concerts[0] as ConcertAccessInfo | undefined;
  if (!concert) return { ok: false, status: 404, error: "Concert not found" };
  if (!isAuthorizedForConcert(userEmail, concert)) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  return { ok: true, data: concert };
}

export async function assertOrganizerCanAccessOrder(
  userEmail: string | undefined | null,
  orderId: string,
): Promise<AuthSuccess | AuthFailure> {
  if (!userEmail) return { ok: false, status: 401, error: "Unauthorized" };

  const { adminDb } = await import("./adminDb");
  const { orders } = await adminDb.query({
    orders: {
      $: { where: { id: orderId } },
      ticketType: { concert: { collaborators: {} } },
    },
  });

  const order = orders[0];
  if (!order) return { ok: false, status: 404, error: "Order not found" };

  // Admin SDK returns has-one relations as arrays at runtime despite types
  const rawTT = order.ticketType as unknown;
  const ticketType = (Array.isArray(rawTT) ? rawTT[0] : rawTT) as
    | { concert: unknown }
    | undefined;
  const rawConcert = ticketType?.concert as unknown;
  const concert = (Array.isArray(rawConcert) ? rawConcert[0] : rawConcert) as
    | ConcertAuthInfo
    | undefined;

  if (!concert) return { ok: false, status: 404, error: "Concert not found" };
  if (!isAuthorizedForConcert(userEmail, concert)) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  return { ok: true };
}
