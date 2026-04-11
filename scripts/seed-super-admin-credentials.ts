/**
 * One-time script to seed super admin credentials for password auth.
 * Run with: npx tsx --env-file=.env scripts/seed-super-admin-credentials.ts
 */
import { init, id } from "@instantdb/admin";
import bcrypt from "bcryptjs";
import schema from "../src/instant.schema";

const adminDb = init({
  appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID!,
  adminToken: process.env.INSTANT_APP_ADMIN_TOKEN!,
  schema,
});

const SUPER_ADMIN_EMAIL = "matickets.ve@gmail.com";
const SUPER_ADMIN_PASSWORD = "Mathias01";

async function seed() {
  console.log("Looking up super admin user...");

  const { $users } = await adminDb.query({
    $users: {
      $: { where: { email: SUPER_ADMIN_EMAIL } },
      credentials: {},
    },
  });

  if ($users.length === 0) {
    console.error("Super admin user not found. They need to log in at least once first.");
    console.log("Creating token to ensure user exists...");
    await adminDb.auth.createToken({ email: SUPER_ADMIN_EMAIL });

    // Re-query
    const { $users: retry } = await adminDb.query({
      $users: {
        $: { where: { email: SUPER_ADMIN_EMAIL } },
        credentials: {},
      },
    });

    if (retry.length === 0) {
      console.error("Failed to create super admin user.");
      process.exit(1);
    }

    const user = retry[0];
    const creds = (user as unknown as { credentials: unknown[] }).credentials;
    if (Array.isArray(creds) && creds.length > 0) {
      console.log("Super admin already has credentials, skipping.");
      process.exit(0);
    }

    const passwordHash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 12);
    await adminDb.transact([
      adminDb.tx.$users[user.id].update({ type: "superadmin" }),
      adminDb.tx.credentials[id()]
        .update({ passwordHash, createdAt: Date.now() })
        .link({ user: user.id }),
    ]);
    console.log("Super admin credentials seeded successfully.");
    process.exit(0);
  }

  const user = $users[0];
  const creds = (user as unknown as { credentials: unknown[] }).credentials;
  if (Array.isArray(creds) && creds.length > 0) {
    console.log("Super admin already has credentials, skipping.");
    process.exit(0);
  }

  console.log("Hashing password...");
  const passwordHash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 12);

  console.log("Creating credentials...");
  await adminDb.transact([
    adminDb.tx.$users[user.id].update({ type: "superadmin" }),
    adminDb.tx.credentials[id()]
      .update({ passwordHash, createdAt: Date.now() })
      .link({ user: user.id }),
  ]);

  console.log("Super admin credentials seeded successfully.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
