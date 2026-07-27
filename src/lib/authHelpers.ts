export const SUPER_ADMIN_EMAIL = "matickets.ve@gmail.com";

export function isSuperAdmin(email: string | undefined | null): boolean {
  return email?.toLowerCase() === SUPER_ADMIN_EMAIL;
}

// ---------------------------------------------------------------------------
// Collaborator roles (RBAC per event)
// ---------------------------------------------------------------------------

/** Stored on eventCollaborators.role / guestListCollaborators.role. */
export type CollaboratorRole = "co_organizer" | "box_office";
export const COLLABORATOR_ROLES: CollaboratorRole[] = [
  "co_organizer",
  "box_office",
];
export const DEFAULT_COLLABORATOR_ROLE: CollaboratorRole = "co_organizer";

/** The role a user effectively has on a given event. "owner" = primary organizer or super admin. */
export type EventRole = "owner" | CollaboratorRole;

/** Discrete things a user can attempt on an event. */
export type Capability =
  | "manage_config" // event settings, ticket types, prices, payment methods, fees, coupons, branding, scanner PIN
  | "manage_orders" // view / approve / reject orders, reconcile
  | "create_orders" // box-office manual sale
  | "broadcast" // mass emails + support messages
  | "check_in" // scan tickets / mark visited
  | "view_revenue" // aggregate money figures (total collected, revenue by type, financial stats)
  | "manage_team"; // invite collaborators / change roles

const ROLE_CAPABILITIES: Record<EventRole, Capability[]> = {
  owner: [
    "manage_config",
    "manage_orders",
    "create_orders",
    "broadcast",
    "check_in",
    "view_revenue",
    "manage_team",
  ],
  co_organizer: [
    "manage_config",
    "manage_orders",
    "create_orders",
    "broadcast",
    "check_in",
    "view_revenue",
  ],
  // Box office: operational only. No config, no aggregate revenue, no team management.
  box_office: ["manage_orders", "create_orders", "broadcast", "check_in"],
};

export function normalizeCollaboratorRole(
  role: string | undefined | null,
): CollaboratorRole {
  return role === "box_office" ? "box_office" : DEFAULT_COLLABORATOR_ROLE;
}

export function roleCan(
  role: EventRole | null | undefined,
  capability: Capability,
): boolean {
  if (!role) return false;
  return ROLE_CAPABILITIES[role]?.includes(capability) ?? false;
}

export type CollaboratorInfo = { email: string; role?: string | null };

export type ConcertAuthInfo = {
  organizerEmail: string;
  collaborators?: CollaboratorInfo[] | null;
};

/**
 * Effective role of `userEmail` on `concert`, or null if they have no access.
 * A super admin or the primary organizer is "owner". A collaborator gets their
 * stored role (defaulting to co_organizer for legacy rows without a role).
 */
export function getEventRole(
  userEmail: string | undefined | null,
  concert: ConcertAuthInfo,
): EventRole | null {
  if (!userEmail) return null;
  const lower = userEmail.toLowerCase();
  if (lower === SUPER_ADMIN_EMAIL) return "owner";
  if (lower === concert.organizerEmail.toLowerCase()) return "owner";
  const collab = (concert.collaborators ?? []).find(
    (c) => c.email.toLowerCase() === lower,
  );
  if (!collab) return null;
  return normalizeCollaboratorRole(collab.role);
}

/** Convenience: can `userEmail` perform `capability` on `concert`? */
export function canPerformOnConcert(
  userEmail: string | undefined | null,
  concert: ConcertAuthInfo,
  capability: Capability,
): boolean {
  return roleCan(getEventRole(userEmail, concert), capability);
}

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
  collaborators?: CollaboratorInfo[];
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

/**
 * Server-side capability gate: asserts `userEmail` may perform `capability` on
 * the concert. Builds on assertOrganizerCanAccessConcert (which loads
 * collaborators + their roles) and then checks the role's capability set.
 */
export async function assertOrganizerCanPerform(
  userEmail: string | undefined | null,
  concertId: string,
  capability: Capability,
): Promise<({ ok: true } & { data: ConcertAccessInfo }) | AuthFailure> {
  const access = await assertOrganizerCanAccessConcert(userEmail, concertId);
  if (!access.ok) return access;
  if (!canPerformOnConcert(userEmail, access.data, capability)) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  return access;
}
