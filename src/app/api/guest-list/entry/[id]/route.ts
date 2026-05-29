import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { assertOrganizerCanAccessGuestListEntry } from "@/lib/guestListAuth";
import { isValidEmail, isValidCedula, isValidName } from "@/lib/validation";
import { recordAuditLog } from "@/lib/auditLog";

async function authOrFail(req: NextRequest, entryId: string) {
  const authToken = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!authToken) {
    return {
      err: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const user = await adminDb.auth.verifyToken(authToken);
  if (!user?.email) {
    return {
      err: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const auth = await assertOrganizerCanAccessGuestListEntry(user.email, entryId);
  if (!auth.ok) {
    return {
      err: NextResponse.json({ error: auth.error }, { status: auth.status }),
    };
  }
  return { user, actorEmail: user.email, event: auth.data.event };
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id: entryId } = await ctx.params;
    const result = await authOrFail(req, entryId);
    if ("err" in result) return result.err;

    const body = await req.json();

    // Re-fetch the entry to know its current status
    const { guestListEntries } = await adminDb.query({
      guestListEntries: { $: { where: { id: entryId } } },
    });
    const current = guestListEntries[0];
    if (!current) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const updates: Record<string, unknown> = {};

    if (body.firstName !== undefined) {
      const v = String(body.firstName).trim();
      if (v && !isValidName(v)) {
        return NextResponse.json(
          { error: "Invalid first name" },
          { status: 400 },
        );
      }
      updates.firstName = v;
    }
    if (body.lastName !== undefined) {
      const v = String(body.lastName).trim();
      if (v && !isValidName(v)) {
        return NextResponse.json(
          { error: "Invalid last name" },
          { status: 400 },
        );
      }
      updates.lastName = v;
    }
    if (body.email !== undefined) {
      const v = String(body.email).trim().toLowerCase();
      if (v && !isValidEmail(v)) {
        return NextResponse.json({ error: "Invalid email" }, { status: 400 });
      }
      updates.email = v;
    }
    if (body.cedula !== undefined) {
      const v = String(body.cedula).trim();
      if (v && !isValidCedula(v)) {
        return NextResponse.json({ error: "Invalid cedula" }, { status: 400 });
      }
      updates.cedula = v;
    }
    if (body.priceOverride !== undefined) {
      if (current.status === "registered") {
        return NextResponse.json(
          { error: "Cannot change price after redemption" },
          { status: 400 },
        );
      }
      if (body.priceOverride === null) {
        updates.priceOverride = null;
      } else {
        const num = Number(body.priceOverride);
        if (!Number.isFinite(num) || num < 0) {
          return NextResponse.json(
            { error: "Invalid price" },
            { status: 400 },
          );
        }
        updates.priceOverride = Math.round(num * 100) / 100;
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ ok: true, noChange: true });
    }

    await adminDb.transact([
      adminDb.tx.guestListEntries[entryId].update(updates),
    ]);
    await recordAuditLog({
      action: "glentry.edit",
      actorEmail: result.actorEmail,
      entityType: "guestListEntry",
      entityId: entryId,
      guestListEventId: result.event.id,
      summary: `Editó invitado de guest list en ${result.event.name}`,
      metadata: { changedFields: Object.keys(updates) },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[guest-list/entry/PATCH] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id: entryId } = await ctx.params;
    const result = await authOrFail(req, entryId);
    if ("err" in result) return result.err;

    const cancelOrder = req.nextUrl.searchParams.get("cancelOrder") === "true";

    const { guestListEntries } = await adminDb.query({
      guestListEntries: {
        $: { where: { id: entryId } },
        order: {},
      },
    });
    const entry = guestListEntries[0];
    if (!entry) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const rawOrder = entry.order as unknown;
    const order = (Array.isArray(rawOrder) ? rawOrder[0] : rawOrder) as
      | { id: string; status: string }
      | undefined;

    const txns = [];
    if (order && cancelOrder) {
      txns.push(
        adminDb.tx.guestListOrders[order.id].update({ status: "cancelled" }),
      );
    }
    txns.push(adminDb.tx.guestListEntries[entryId].delete());

    await adminDb.transact(txns);
    await recordAuditLog({
      action: "glentry.delete",
      actorEmail: result.actorEmail,
      entityType: "guestListEntry",
      entityId: entryId,
      guestListEventId: result.event.id,
      summary: `Eliminó invitado de guest list en ${result.event.name}${
        order && cancelOrder ? " (canceló su orden)" : ""
      }`,
      metadata: { cancelledOrder: !!(order && cancelOrder) },
    });
    return NextResponse.json({ ok: true, cancelledOrder: !!(order && cancelOrder) });
  } catch (err) {
    console.error("[guest-list/entry/DELETE] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
