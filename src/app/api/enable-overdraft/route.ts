import { NextRequest, NextResponse } from "next/server";
import { id as genId } from "@instantdb/admin";
import { adminDb } from "@/lib/adminDb";
import { isAuthorizedForConcert } from "@/lib/authHelpers";
import { recordAuditLog } from "@/lib/auditLog";

type RequestBody = {
  concertId: string;
};

export async function POST(req: NextRequest) {
  try {
    const authToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!authToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await adminDb.auth.verifyToken(authToken);
    if (!user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { concertId }: RequestBody = await req.json();
    if (!concertId || typeof concertId !== "string") {
      return NextResponse.json(
        { error: "concertId is required" },
        { status: 400 },
      );
    }

    const { concerts } = await adminDb.query({
      concerts: {
        $: { where: { id: concertId } },
        collaborators: {},
        platformFeeConfig: {},
      },
    });
    const concert = concerts[0] as
      | {
          id: string;
          organizerEmail: string;
          collaborators?: { email: string }[];
          platformFeeConfig: unknown;
        }
      | undefined;
    if (!concert) {
      return NextResponse.json(
        { error: "Concert not found" },
        { status: 404 },
      );
    }
    if (!isAuthorizedForConcert(user.email, concert)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const rawFeeConfig = concert.platformFeeConfig as unknown;
    const feeConfig = (
      Array.isArray(rawFeeConfig) ? rawFeeConfig[0] : rawFeeConfig
    ) as
      | {
          id: string;
          feePercent: number;
          feeFixed: number;
          billingMode: string;
          allowOverdraft?: boolean;
        }
      | undefined;

    const now = Date.now();
    const activator = user.email.toLowerCase();

    if (feeConfig) {
      if (feeConfig.allowOverdraft === true) {
        return NextResponse.json({ success: true, alreadyEnabled: true });
      }
      await adminDb.transact([
        adminDb.tx.platformFeeConfigs[feeConfig.id].update({
          allowOverdraft: true,
          overdraftActivatedAt: now,
          overdraftActivatedBy: activator,
          updatedAt: now,
        }),
      ]);
    } else {
      const newId = genId();
      await adminDb.transact([
        adminDb.tx.platformFeeConfigs[newId]
          .update({
            feePercent: 0,
            feeFixed: 0,
            billingMode: "prepaid",
            allowOverdraft: true,
            overdraftActivatedAt: now,
            overdraftActivatedBy: activator,
            updatedAt: now,
          })
          .link({ concert: concertId }),
      ]);
    }

    await recordAuditLog({
      action: "overdraft.enable",
      actorEmail: user.email,
      entityType: "platformFeeConfig",
      entityId: concert.id,
      concertId: concert.id,
      summary: "Habilitó cierre a crédito (overdraft)",
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[enable-overdraft] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
