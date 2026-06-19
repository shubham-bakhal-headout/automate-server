import { PrismaClient } from '@prisma/client';
import { buildLegacyAutofillScript, LEGACY_FORM_URL, legacyFieldMap } from '../src/lib/legacyScript';

const db = new PrismaClient();

/**
 * Bootstrap seed — creates ONLY the baseline vendor + its autofill script so the
 * extension has something to fetch. No fake users or fill events: real usage data
 * comes from the extension. Safe to re-run (idempotent on the vendor URL).
 */
async function main() {
  const vendor = await db.vendor.upsert({
    where: { url: LEGACY_FORM_URL },
    create: { name: 'Order Request (Google Form)', url: LEGACY_FORM_URL },
    update: {},
  });

  const existing = await db.script.findUnique({
    where: { vendorId_version: { vendorId: vendor.id, version: 1 } },
  });

  if (!existing) {
    await db.script.create({
      data: {
        vendorId: vendor.id,
        version: 1,
        content: buildLegacyAutofillScript(),
        fieldMap: legacyFieldMap,
        status: 'ACTIVE',
      },
    });
  }

  console.log(`Seeded vendor "${vendor.name}" with autofill script v1 (ACTIVE).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
