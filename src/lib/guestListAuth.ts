import { adminDb } from "./adminDb";
import { isSuperAdmin } from "./authHelpers";

type AuthFailure = { ok: false; status: number; error: string };
type AuthSuccess<T> = { ok: true; data: T };

type GuestListEventInfo = {
  id: string;
  name: string;
  slug: string;
  date: string;
  venue?: string;
  organizerEmail: string;
  status: string;
  defaultPrice: number;
  defaultLanguage?: string;
  primaryColor?: string;
  scannerPin?: string;
  capacity?: number;
  collaborators?: { email: string }[];
};

function userHasAccess(userEmail: string, event: GuestListEventInfo): boolean {
  const lower = userEmail.toLowerCase();
  if (isSuperAdmin(userEmail)) return true;
  if (event.organizerEmail.toLowerCase() === lower) return true;
  return (event.collaborators || []).some(
    (c) => c.email.toLowerCase() === lower,
  );
}

export async function assertOrganizerCanAccessGuestListEvent(
  userEmail: string | undefined | null,
  eventId: string,
): Promise<AuthSuccess<GuestListEventInfo> | AuthFailure> {
  if (!userEmail) return { ok: false, status: 401, error: "Unauthorized" };

  const { guestListEvents } = await adminDb.query({
    guestListEvents: {
      $: { where: { id: eventId } },
      collaborators: {},
    },
  });
  const event = guestListEvents[0] as GuestListEventInfo | undefined;
  if (!event) return { ok: false, status: 404, error: "Event not found" };

  if (!userHasAccess(userEmail, event)) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  return { ok: true, data: event };
}

export async function assertOrganizerCanAccessGuestListEntry(
  userEmail: string | undefined | null,
  entryId: string,
): Promise<
  | AuthSuccess<{ entry: { id: string }; event: GuestListEventInfo }>
  | AuthFailure
> {
  if (!userEmail) return { ok: false, status: 401, error: "Unauthorized" };

  const { guestListEntries } = await adminDb.query({
    guestListEntries: {
      $: { where: { id: entryId } },
      event: { collaborators: {} },
    },
  });
  const entry = guestListEntries[0];
  if (!entry) return { ok: false, status: 404, error: "Entry not found" };

  const rawEvent = entry.event as unknown;
  const event = (Array.isArray(rawEvent) ? rawEvent[0] : rawEvent) as
    | GuestListEventInfo
    | undefined;
  if (!event) return { ok: false, status: 404, error: "Event not found" };

  if (!userHasAccess(userEmail, event)) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  return { ok: true, data: { entry: { id: entry.id }, event } };
}

export async function assertOrganizerCanAccessGuestListOrder(
  userEmail: string | undefined | null,
  orderId: string,
): Promise<
  | AuthSuccess<{ order: { id: string }; event: GuestListEventInfo }>
  | AuthFailure
> {
  if (!userEmail) return { ok: false, status: 401, error: "Unauthorized" };
  const { guestListOrders } = await adminDb.query({
    guestListOrders: {
      $: { where: { id: orderId } },
      entry: { event: { collaborators: {} } },
    },
  });
  const order = guestListOrders[0];
  if (!order) return { ok: false, status: 404, error: "Order not found" };
  const rawEntry = order.entry as unknown;
  const entry = (Array.isArray(rawEntry) ? rawEntry[0] : rawEntry) as
    | { event: unknown }
    | undefined;
  const rawEvent = entry?.event as unknown;
  const event = (Array.isArray(rawEvent) ? rawEvent[0] : rawEvent) as
    | GuestListEventInfo
    | undefined;
  if (!event) return { ok: false, status: 404, error: "Event not found" };
  if (!userHasAccess(userEmail, event)) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  return { ok: true, data: { order: { id: order.id }, event } };
}
