import { adminDb } from "../src/lib/adminDb";

const SUPER_ADMIN_EMAIL = "matickets.ve@gmail.com";

async function backfill() {
  // Backfill organizerEmail on all existing concerts
  const { concerts } = await adminDb.query({ concerts: {} });
  const concertTxns = concerts
    .filter((c: { organizerEmail?: string }) => !c.organizerEmail)
    .map((c: { id: string }) =>
      adminDb.tx.concerts[c.id].update({ organizerEmail: SUPER_ADMIN_EMAIL }),
    );

  if (concertTxns.length > 0) {
    await adminDb.transact(concertTxns);
    console.log(`Backfilled ${concertTxns.length} concerts with organizerEmail`);
  } else {
    console.log("No concerts need backfilling");
  }

  // Set super admin user type
  const { $users } = await adminDb.query({
    $users: { $: { where: { email: SUPER_ADMIN_EMAIL } } },
  });

  if ($users.length > 0) {
    await adminDb.transact(
      adminDb.tx.$users[$users[0].id].update({ type: "superadmin" }),
    );
    console.log(`Set ${SUPER_ADMIN_EMAIL} as superadmin`);
  } else {
    console.log(`User ${SUPER_ADMIN_EMAIL} not found - they will be set as superadmin on first login`);
  }
}

backfill().catch(console.error);
