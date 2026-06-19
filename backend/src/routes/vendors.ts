import { Router } from 'express';
import db from '../db';

const router = Router();

// List all vendors with their latest script status
router.get('/', async (_req, res) => {
  const vendors = await db.vendor.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      scripts: {
        orderBy: { version: 'desc' },
        take: 1,
        select: { id: true, version: true, status: true },
      },
      _count: { select: { events: true } },
    },
  });
  res.json({ data: vendors });
});

// Get single vendor
router.get('/:id', async (req, res) => {
  const vendor = await db.vendor.findUnique({
    where: { id: req.params.id },
    include: {
      scripts: { orderBy: { version: 'desc' } },
      _count: { select: { events: true } },
    },
  });
  if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
  return res.json({ data: vendor });
});

// Create vendor
router.post('/', async (req, res) => {
  const { name, url } = req.body as { name?: string; url?: string };
  if (!name || !url) return res.status(400).json({ error: 'name and url are required' });
  const vendor = await db.vendor.create({ data: { name, url } });
  return res.status(201).json({ data: vendor });
});

// Add a new script version to a vendor
router.post('/:id/scripts', async (req, res) => {
  const vendor = await db.vendor.findUnique({ where: { id: req.params.id } });
  if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

  const { content, fieldMap } = req.body as { content?: string; fieldMap?: unknown };
  if (!content) return res.status(400).json({ error: 'content is required' });

  const last = await db.script.findFirst({
    where: { vendorId: vendor.id },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const nextVersion = (last?.version ?? 0) + 1;

  // Disable all previous active scripts for this vendor
  await db.script.updateMany({
    where: { vendorId: vendor.id, status: 'ACTIVE' },
    data: { status: 'DISABLED' },
  });

  const script = await db.script.create({
    data: {
      vendorId: vendor.id,
      version: nextVersion,
      content,
      fieldMap: fieldMap ? (fieldMap as object) : undefined,
      status: 'ACTIVE',
    },
  });
  return res.status(201).json({ data: script });
});

export default router;
