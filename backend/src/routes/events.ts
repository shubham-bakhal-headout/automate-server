import { Router } from 'express';
import db from '../db';
import { updateScriptHealth } from '../lib/scriptHealth';

const router = Router();

type FieldResult = { key: string; ok: boolean; error?: string };

// POST /api/events — called by the extension after each fill attempt
router.post('/', async (req, res) => {
  const {
    vendorUrl,
    userEmail,
    userName,
    bookingId,
    status,
    durationMs,
    fieldResults,
    error,
  } = req.body as {
    vendorUrl?: string;
    userEmail?: string;
    userName?: string;
    bookingId?: string;
    status?: 'SUCCESS' | 'PARTIAL' | 'FAILURE';
    durationMs?: number;
    fieldResults?: FieldResult[];
    error?: string;
  };

  if (!vendorUrl || !userEmail || !status) {
    return res.status(400).json({ error: 'vendorUrl, userEmail, and status are required' });
  }
  if (!['SUCCESS', 'PARTIAL', 'FAILURE'].includes(status)) {
    return res.status(400).json({ error: 'status must be SUCCESS, PARTIAL, or FAILURE' });
  }

  const vendor = await db.vendor.findUnique({ where: { url: vendorUrl } });
  if (!vendor) return res.status(404).json({ error: 'No vendor found for this URL' });

  const user = await db.user.upsert({
    where: { email: userEmail },
    create: { email: userEmail, name: userName },
    update: { ...(userName && { name: userName }) },
  });

  // Link to the latest runnable script (the one the extension actually fetched).
  const script = await db.script.findFirst({
    where: { vendorId: vendor.id, status: { not: 'DISABLED' } },
    orderBy: { version: 'desc' },
    select: { id: true },
  });

  const event = await db.fillEvent.create({
    data: {
      vendorId: vendor.id,
      userId: user.id,
      scriptId: script?.id ?? null,
      bookingId: bookingId ?? null,
      status,
      durationMs: durationMs ?? null,
      fieldResults: Array.isArray(fieldResults) ? (fieldResults as object[]) : [],
      error: error ?? null,
    },
  });

  if (script?.id) {
    await updateScriptHealth(script.id, fieldResults);
  }

  return res.status(201).json({ data: { eventId: event.id } });
});

export default router;
