import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";

// Retención de comprobantes de pago: 90 días desde la creación de la orden,
// sin importar su estatus. Se borra solo la imagen del storage ($files); el
// resto del dato de la orden (nombre, cédula, email, proofReferenceNumber…)
// se conserva. El path se reemplaza por el centinela "proof-deleted".
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const DELETED_SENTINEL = "proof-deleted";

export async function GET(req: NextRequest) {
  // Verify Vercel cron secret — mandatory
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const cutoff = Date.now() - RETENTION_MS;

    // Barrido completo de órdenes con más de 90 días. Si el volumen crece mucho,
    // se puede acotar a una ventana (p. ej. createdAt entre cutoff-7d y cutoff),
    // ya que el cron corre a diario y cada orden cruza el umbral una sola vez.
    const { orders, guestListOrders } = await adminDb.query({
      orders: { $: { where: { createdAt: { $lt: cutoff } } } },
      guestListOrders: { $: { where: { createdAt: { $lt: cutoff } } } },
    });

    type Target = {
      kind: "orders" | "guestListOrders";
      id: string;
      path: string;
    };
    const targets: Target[] = [];
    for (const o of orders) {
      const p = o.paymentProofPath;
      if (p?.startsWith("payment-proofs/")) {
        targets.push({ kind: "orders", id: o.id, path: p });
      }
    }
    for (const o of guestListOrders) {
      const p = o.paymentProofPath;
      if (p?.startsWith("payment-proofs/")) {
        targets.push({ kind: "guestListOrders", id: o.id, path: p });
      }
    }

    if (targets.length === 0) {
      return NextResponse.json({ deleted: 0, filesRemoved: 0 });
    }

    // Resolver las filas $files de todos los paths objetivo en una sola query.
    const paths = targets.map((t) => t.path);
    const { $files } = await adminDb.query({
      $files: { $: { where: { path: { $in: paths } } } },
    });
    const fileIdByPath = new Map<string, string>();
    for (const f of $files) fileIdByPath.set(f.path, f.id);

    const fileDeletes = targets
      .map((t) => fileIdByPath.get(t.path))
      .filter((id): id is string => Boolean(id))
      .map((id) => adminDb.tx.$files[id].delete());

    // Marcar el centinela aunque el archivo ya no exista, para dejar de
    // reprocesar la orden y para que el admin muestre "comprobante eliminado".
    const orderUpdates = targets.map((t) =>
      t.kind === "orders"
        ? adminDb.tx.orders[t.id].update({ paymentProofPath: DELETED_SENTINEL })
        : adminDb.tx.guestListOrders[t.id].update({
            paymentProofPath: DELETED_SENTINEL,
          }),
    );

    await adminDb.transact([...fileDeletes, ...orderUpdates]);

    console.log(
      `[cleanup-payment-proofs] Cleared ${targets.length} orders, removed ${fileDeletes.length} proof files`,
    );
    return NextResponse.json({
      deleted: targets.length,
      filesRemoved: fileDeletes.length,
    });
  } catch (err) {
    console.error("[cleanup-payment-proofs] Error:", err);
    return NextResponse.json(
      { error: "Failed to clean up payment proofs" },
      { status: 500 },
    );
  }
}
