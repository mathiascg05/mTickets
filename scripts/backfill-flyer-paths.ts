import { adminDb } from "../src/lib/adminDb";

type Concert = {
  id: string;
  flyerUrl?: string;
  flyerPath?: string;
  logoUrl?: string;
  logoPath?: string;
};

async function findFilePath(concertId: string, kind: "flyer" | "logo"): Promise<string | null> {
  const { $files } = await adminDb.query({
    $files: {
      $: { where: { path: { $like: `event-assets/${concertId}/${kind}%` } } },
    },
  });
  const file = $files[0] as { path?: string } | undefined;
  return file?.path || null;
}

async function backfill() {
  const { concerts } = await adminDb.query({ concerts: {} });
  console.log(`Scanning ${concerts.length} concerts...`);

  let flyerFixed = 0;
  let logoFixed = 0;
  let flyerMissing = 0;
  let logoMissing = 0;

  for (const c of concerts as Concert[]) {
    const updates: Record<string, string> = {};

    if (c.flyerUrl && !c.flyerPath) {
      const path = await findFilePath(c.id, "flyer");
      if (path) {
        updates.flyerPath = path;
        flyerFixed++;
      } else {
        console.warn(`  [flyer] no $files match for concert ${c.id}`);
        flyerMissing++;
      }
    }

    if (c.logoUrl && !c.logoPath) {
      const path = await findFilePath(c.id, "logo");
      if (path) {
        updates.logoPath = path;
        logoFixed++;
      } else {
        console.warn(`  [logo] no $files match for concert ${c.id}`);
        logoMissing++;
      }
    }

    if (Object.keys(updates).length > 0) {
      await adminDb.transact(adminDb.tx.concerts[c.id].update(updates));
    }
  }

  console.log(`Done. flyerPath set: ${flyerFixed}, logoPath set: ${logoFixed}`);
  if (flyerMissing || logoMissing) {
    console.log(`Missing files (manual re-upload needed): flyer=${flyerMissing}, logo=${logoMissing}`);
  }
}

backfill().catch((err) => {
  console.error(err);
  process.exit(1);
});
