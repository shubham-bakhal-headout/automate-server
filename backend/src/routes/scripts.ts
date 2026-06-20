import { Router } from 'express';
import db from '../db';

const router = Router();

// Resolve the latest runnable script for a vendor by URL — used by the extension.
// A FAILING script is still served: FAILING is a health alert, not a kill switch,
// and the extension must be able to fetch it to keep running (and to recover once
// the form is fixed). Only DISABLED scripts are withheld.
// GET /api/scripts/resolve?url=<formUrl>&format=js
router.get('/resolve', async (req, res) => {
  const url = req.query.url as string | undefined;
  if (!url) return res.status(400).json({ error: 'url query param is required' });

  const vendor = await db.vendor.findUnique({ where: { url } });
  if (!vendor) return res.status(404).json({ error: 'No vendor found for this URL' });

  const script = await db.script.findFirst({
    where: { vendorId: vendor.id, status: { not: 'DISABLED' } },
    orderBy: { version: 'desc' },
  });
  if (!script) return res.status(404).json({ error: 'No runnable script for this vendor' });

  if (req.query.format === 'js') {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(script.content);
  }

  return res.json({
    data: {
      scriptId: script.id,
      vendorId: vendor.id,
      vendorName: vendor.name,
      version: script.version,
      content: script.content,
    },
  });
});

// Update a script (content, fieldMap, status)
router.put('/:id', async (req, res) => {
  const { content, fieldMap, status } = req.body as {
    content?: string;
    fieldMap?: unknown;
    status?: 'ACTIVE' | 'FAILING' | 'DISABLED';
  };

  const script = await db.script.findUnique({ where: { id: req.params.id } });
  if (!script) return res.status(404).json({ error: 'Script not found' });

  const updated = await db.script.update({
    where: { id: req.params.id },
    data: {
      ...(content !== undefined && { content }),
      ...(fieldMap !== undefined && { fieldMap: fieldMap as object }),
      ...(status !== undefined && { status }),
    },
  });
  return res.json({ data: updated });
});

// Delete a script version. Historical fill events keep their vendor record and
// lose only the script pointer so analytics can still count the fill.
router.delete('/:id', async (req, res) => {
  const script = await db.script.findUnique({ where: { id: req.params.id } });
  if (!script) return res.status(404).json({ error: 'Script not found' });

  await db.$transaction([
    db.fillEvent.updateMany({
      where: { scriptId: script.id },
      data: { scriptId: null },
    }),
    db.script.delete({ where: { id: script.id } }),
  ]);

  return res.status(204).send();
});

export default router;
