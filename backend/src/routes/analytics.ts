import { Router } from 'express';
import db from '../db';

const router = Router();

function parseRange(req: { query: Record<string, unknown> }): { from: Date; to: Date } {
  const to = req.query.to ? new Date(req.query.to as string) : new Date();
  const from = req.query.from ? new Date(req.query.from as string) : new Date(Date.now() - 30 * 86400_000);
  return { from, to };
}

// GET /api/analytics/summary?from=ISO&to=ISO
router.get('/summary', async (req, res) => {
  const { from, to } = parseRange(req);
  const timeFilter = { createdAt: { gte: from, lte: to } };

  const [totalFills, successFills, partialFills, failureFills, activeUsersGroups, vendorCount, failingScripts, durationAgg] =
    await Promise.all([
      db.fillEvent.count({ where: timeFilter }),
      db.fillEvent.count({ where: { ...timeFilter, status: 'SUCCESS' } }),
      db.fillEvent.count({ where: { ...timeFilter, status: 'PARTIAL' } }),
      db.fillEvent.count({ where: { ...timeFilter, status: 'FAILURE' } }),
      db.fillEvent.groupBy({ by: ['userId'], where: timeFilter }),
      db.vendor.count(),
      db.script.count({ where: { status: 'FAILING' } }),
      db.fillEvent.aggregate({ where: { ...timeFilter, durationMs: { not: null } }, _avg: { durationMs: true } }),
    ]);

  const successRate = totalFills > 0 ? Math.round((successFills / totalFills) * 100) : 0;
  res.json({
    data: {
      totalFills,
      successFills,
      partialFills,
      failureFills,
      successRate,
      activeUsers: activeUsersGroups.length,
      vendorCount,
      failingScripts,
      avgDurationMs: durationAgg._avg.durationMs ? Math.round(durationAgg._avg.durationMs) : null,
      from: from.toISOString(),
      to: to.toISOString(),
    },
  });
});

// GET /api/analytics/by-vendor?from=ISO&to=ISO
router.get('/by-vendor', async (req, res) => {
  const { from, to } = parseRange(req);
  const timeFilter = { createdAt: { gte: from, lte: to } };

  const vendors = await db.vendor.findMany({
    include: {
      scripts: { orderBy: { version: 'desc' }, take: 1, select: { status: true, version: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const vendorIds = vendors.map((v) => v.id);
  const [totalCounts, successCounts] = await Promise.all([
    db.fillEvent.groupBy({ by: ['vendorId'], where: { vendorId: { in: vendorIds }, ...timeFilter }, _count: { id: true } }),
    db.fillEvent.groupBy({ by: ['vendorId'], where: { vendorId: { in: vendorIds }, status: 'SUCCESS', ...timeFilter }, _count: { id: true } }),
  ]);

  const totalMap = Object.fromEntries(totalCounts.map((r) => [r.vendorId, r._count.id]));
  const successMap = Object.fromEntries(successCounts.map((r) => [r.vendorId, r._count.id]));

  res.json({
    data: vendors.map((v) => {
      const total = totalMap[v.id] ?? 0;
      const successes = successMap[v.id] ?? 0;
      return {
        vendorId: v.id,
        vendorName: v.name,
        vendorUrl: v.url,
        totalFills: total,
        successRate: total > 0 ? Math.round((successes / total) * 100) : 0,
        latestScriptStatus: v.scripts[0]?.status ?? null,
        latestScriptVersion: v.scripts[0]?.version ?? null,
      };
    }),
  });
});

// GET /api/analytics/by-user?from=ISO&to=ISO
router.get('/by-user', async (req, res) => {
  const { from, to } = parseRange(req);
  const timeFilter = { createdAt: { gte: from, lte: to } };

  const users = await db.user.findMany({ orderBy: { createdAt: 'desc' } });
  const userIds = users.map((u) => u.id);

  const [totalCounts, successCounts] = await Promise.all([
    db.fillEvent.groupBy({ by: ['userId'], where: { userId: { in: userIds }, ...timeFilter }, _count: { id: true } }),
    db.fillEvent.groupBy({ by: ['userId'], where: { userId: { in: userIds }, status: 'SUCCESS', ...timeFilter }, _count: { id: true } }),
  ]);

  const totalMap = Object.fromEntries(totalCounts.map((r) => [r.userId, r._count.id]));
  const successMap = Object.fromEntries(successCounts.map((r) => [r.userId, r._count.id]));

  res.json({
    data: users
      .map((u) => ({
        userId: u.id,
        email: u.email,
        name: u.name,
        team: u.team,
        totalFills: totalMap[u.id] ?? 0,
        successRate:
          (totalMap[u.id] ?? 0) > 0
            ? Math.round(((successMap[u.id] ?? 0) / (totalMap[u.id] ?? 1)) * 100)
            : 0,
      }))
      .filter((u) => u.totalFills > 0),
  });
});

// GET /api/analytics/script-health
router.get('/script-health', async (_req, res) => {
  const scripts = await db.script.findMany({
    where: { status: { in: ['FAILING', 'ACTIVE'] } },
    orderBy: [{ status: 'asc' }, { version: 'desc' }],
    include: {
      vendor: { select: { id: true, name: true, url: true } },
      events: {
        where: { status: { in: ['FAILURE', 'PARTIAL'] } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, status: true, fieldResults: true, error: true, createdAt: true },
      },
      _count: { select: { events: true } },
    },
  });

  res.json({
    data: scripts.map((s) => ({
      scriptId: s.id,
      version: s.version,
      status: s.status,
      vendor: s.vendor,
      recentFailures: s.events,
      totalEvents: s._count.events,
    })),
  });
});

export default router;
