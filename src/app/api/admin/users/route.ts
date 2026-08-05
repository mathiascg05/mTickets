import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { isSuperAdmin } from "@/lib/authHelpers";

/**
 * GET /api/admin/users
 *
 * Super-admin-only roster of every registered account ($users) with everything
 * we know about them: contact details, signup date, legal acceptances, platform
 * balance, events they organize, collaborations, and how many orders they placed
 * as a buyer.
 *
 * Why a server route instead of a client query: the super admin can read $users
 * from the client (see instant.perms.ts), but `credentials` — where the signup
 * date lives — is fully locked, so the join has to happen with the admin token.
 *
 * Performance: flat queries in parallel + in-memory joins, same approach as
 * /api/admin/platform-stats (nested queries over orders are an order of
 * magnitude slower).
 */

type UserRow = {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  type?: string;
  imageURL?: string;
  acceptedTermsVersion?: string;
  acceptedTermsAt?: number;
  acceptedOrganizerTermsVersion?: string;
  acceptedOrganizerTermsAt?: number;
  acceptedPrivacyVersion?: string;
  acceptedPrivacyAt?: number;
  credentials?: unknown;
};

type EventRow = {
  id: string;
  name: string;
  status: string;
  organizerEmail: string;
  isDemo?: boolean;
};

type CollaboratorRow = {
  id: string;
  email: string;
  role?: string;
  invitedAt?: number;
  lastAccessedAt?: number;
  concert?: unknown;
  event?: unknown;
};

/** The admin SDK returns has-one relations array-wrapped despite the types. */
function one<T>(raw: unknown): T | undefined {
  return (Array.isArray(raw) ? raw[0] : raw) as T | undefined;
}

const lower = (email: string | undefined | null) =>
  (email ?? "").trim().toLowerCase();

export async function GET(req: NextRequest) {
  try {
    const authToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!authToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // An expired/garbage token is an auth failure, not a server fault
    // (same .catch(() => null) shape as /api/order/view).
    const user = await adminDb.auth.verifyToken(authToken).catch(() => null);
    if (!user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!isSuperAdmin(user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [
      usersRes,
      balancesRes,
      concertsRes,
      guestListRes,
      collabsRes,
      glCollabsRes,
      ordersRes,
    ] = await Promise.all([
      adminDb.query({ $users: { credentials: {} } }),
      adminDb.query({ organizerBalances: {} }),
      adminDb.query({ concerts: {} }),
      adminDb.query({ guestListEvents: {} }),
      adminDb.query({ eventCollaborators: { concert: {} } }),
      adminDb.query({ guestListCollaborators: { event: {} } }),
      adminDb.query({ orders: {} }),
    ]);

    const users = usersRes.$users as unknown as UserRow[];
    const balances = balancesRes.organizerBalances as unknown as Array<{
      email: string;
      balance: number;
      currency: string;
      updatedAt: number;
    }>;
    const concerts = concertsRes.concerts as unknown as EventRow[];
    const guestListEvents = guestListRes.guestListEvents as unknown as EventRow[];
    const collabs = collabsRes.eventCollaborators as unknown as CollaboratorRow[];
    const glCollabs =
      glCollabsRes.guestListCollaborators as unknown as CollaboratorRow[];
    const orders = ordersRes.orders as unknown as Array<{
      email: string;
      createdAt: number;
    }>;

    // ---- indexes by lowercased email -------------------------------------
    const balanceByEmail = new Map<
      string,
      { balance: number; currency: string; updatedAt: number }
    >();
    for (const b of balances) {
      balanceByEmail.set(lower(b.email), {
        balance: b.balance,
        currency: b.currency,
        updatedAt: b.updatedAt,
      });
    }

    type OrganizedEvent = {
      id: string;
      name: string;
      status: string;
      kind: "concert" | "guestList";
      isDemo: boolean;
    };
    const eventsByEmail = new Map<string, OrganizedEvent[]>();
    const pushEvent = (email: string, ev: OrganizedEvent) => {
      const key = lower(email);
      const list = eventsByEmail.get(key);
      if (list) list.push(ev);
      else eventsByEmail.set(key, [ev]);
    };
    for (const c of concerts) {
      pushEvent(c.organizerEmail, {
        id: c.id,
        name: c.name,
        status: c.status,
        kind: "concert",
        isDemo: c.isDemo === true,
      });
    }
    for (const e of guestListEvents) {
      pushEvent(e.organizerEmail, {
        id: e.id,
        name: e.name,
        status: e.status,
        kind: "guestList",
        isDemo: e.isDemo === true,
      });
    }

    type Collaboration = {
      eventId: string | null;
      eventName: string | null;
      kind: "concert" | "guestList";
      role: string;
      invitedAt: number | null;
      lastAccessedAt: number | null;
    };
    const collabsByEmail = new Map<string, Collaboration[]>();
    const pushCollab = (email: string, c: Collaboration) => {
      const key = lower(email);
      const list = collabsByEmail.get(key);
      if (list) list.push(c);
      else collabsByEmail.set(key, [c]);
    };
    for (const c of collabs) {
      const ev = one<{ id: string; name: string }>(c.concert);
      pushCollab(c.email, {
        eventId: ev?.id ?? null,
        eventName: ev?.name ?? null,
        kind: "concert",
        // Legacy rows without a role are co_organizer (see authHelpers).
        role: c.role || "co_organizer",
        invitedAt: c.invitedAt ?? null,
        lastAccessedAt: c.lastAccessedAt ?? null,
      });
    }
    for (const c of glCollabs) {
      const ev = one<{ id: string; name: string }>(c.event);
      pushCollab(c.email, {
        eventId: ev?.id ?? null,
        eventName: ev?.name ?? null,
        kind: "guestList",
        role: c.role || "co_organizer",
        invitedAt: c.invitedAt ?? null,
        lastAccessedAt: c.lastAccessedAt ?? null,
      });
    }

    const ordersByEmail = new Map<string, { count: number; lastAt: number }>();
    for (const o of orders) {
      const key = lower(o.email);
      if (!key) continue;
      const entry = ordersByEmail.get(key);
      if (entry) {
        entry.count += 1;
        if (o.createdAt > entry.lastAt) entry.lastAt = o.createdAt;
      } else {
        ordersByEmail.set(key, { count: 1, lastAt: o.createdAt });
      }
    }

    // ---- assemble ---------------------------------------------------------
    const rows = users.map((u) => {
      const key = lower(u.email);
      const cred = one<{ createdAt?: number }>(u.credentials);
      const purchases = ordersByEmail.get(key);
      return {
        id: u.id,
        email: u.email ?? "",
        firstName: u.firstName ?? null,
        lastName: u.lastName ?? null,
        phone: u.phone ?? null,
        type: u.type ?? null,
        // No createdAt on $users: the credentials row is written in the same
        // signup transaction, so it is the real registration date. Accounts
        // created before passwords (or via invite) fall back to the legal
        // acceptance timestamp.
        createdAt: cred?.createdAt ?? u.acceptedTermsAt ?? null,
        hasPassword: !!cred,
        acceptedTermsVersion: u.acceptedTermsVersion ?? null,
        acceptedTermsAt: u.acceptedTermsAt ?? null,
        acceptedOrganizerTermsVersion: u.acceptedOrganizerTermsVersion ?? null,
        acceptedOrganizerTermsAt: u.acceptedOrganizerTermsAt ?? null,
        acceptedPrivacyVersion: u.acceptedPrivacyVersion ?? null,
        acceptedPrivacyAt: u.acceptedPrivacyAt ?? null,
        balance: balanceByEmail.get(key) ?? null,
        eventsOrganized: eventsByEmail.get(key) ?? [],
        collaborations: collabsByEmail.get(key) ?? [],
        ordersAsBuyer: purchases ?? { count: 0, lastAt: null },
      };
    });

    rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

    return NextResponse.json({ users: rows });
  } catch (err) {
    console.error("[admin/users] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
