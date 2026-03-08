import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { authenticate } from '../middleware/auth.js';
import type { AuthRequest } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { generateId } from '@agentmark/shared';

const router = Router();

// ============================================================
// Public tracking endpoint (no auth required)
// ============================================================

const trackSchema = z.object({
  organizationId: z.string().uuid(),
  sessionId: z.string().min(1),
  visitorId: z.string().min(1),
  event: z.string().min(1).max(255),
  properties: z.record(z.unknown()).optional().default({}),
  page: z.string().optional(),
  referrer: z.string().optional(),
  timestamp: z.string().optional(),
});

// POST /analytics/track - Public event ingestion endpoint
router.post('/track', validate(trackSchema), async (req: Request, res: Response) => {
  const { organizationId, sessionId, visitorId, event, properties, page, referrer, timestamp } = req.body;

  await query(
    `INSERT INTO analytics_events (organization_id, session_id, visitor_id, event, properties, page, referrer, user_agent, ip_address, timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      organizationId, sessionId, visitorId, event,
      JSON.stringify(properties), page, referrer,
      req.headers['user-agent'], req.ip,
      timestamp ? new Date(timestamp) : new Date(),
    ]
  );

  // Return 1x1 pixel for image-based tracking compatibility
  if (req.query.pixel === '1') {
    const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    res.writeHead(200, { 'Content-Type': 'image/gif', 'Content-Length': pixel.length, 'Cache-Control': 'no-store' });
    res.end(pixel);
    return;
  }

  res.status(202).json({ success: true });
});

// ============================================================
// Authenticated analytics endpoints
// ============================================================

// GET /analytics/overview - Dashboard overview metrics
router.get('/overview', authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const orgId = authReq.auth!.organizationId;
  const { period = '7d' } = req.query;

  const periodMap: Record<string, string> = {
    today: '1 day',
    '7d': '7 days',
    '30d': '30 days',
    '90d': '90 days',
  };
  const interval = periodMap[period as string] || '7 days';

  // Run multiple analytics queries in parallel
  const [totalEvents, uniqueVisitors, topPages, topEvents, eventTimeline] = await Promise.all([
    query(
      `SELECT COUNT(*) as total FROM analytics_events
       WHERE organization_id = $1 AND timestamp >= NOW() - $2::interval`,
      [orgId, interval]
    ),
    query(
      `SELECT COUNT(DISTINCT visitor_id) as total FROM analytics_events
       WHERE organization_id = $1 AND timestamp >= NOW() - $2::interval`,
      [orgId, interval]
    ),
    query(
      `SELECT page, COUNT(*) as views, COUNT(DISTINCT visitor_id) as unique_visitors
       FROM analytics_events
       WHERE organization_id = $1 AND timestamp >= NOW() - $2::interval AND page IS NOT NULL
       GROUP BY page ORDER BY views DESC LIMIT 10`,
      [orgId, interval]
    ),
    query(
      `SELECT event, COUNT(*) as count
       FROM analytics_events
       WHERE organization_id = $1 AND timestamp >= NOW() - $2::interval
       GROUP BY event ORDER BY count DESC LIMIT 10`,
      [orgId, interval]
    ),
    query(
      `SELECT DATE_TRUNC('day', timestamp) as date, COUNT(*) as events, COUNT(DISTINCT visitor_id) as visitors
       FROM analytics_events
       WHERE organization_id = $1 AND timestamp >= NOW() - $2::interval
       GROUP BY date ORDER BY date`,
      [orgId, interval]
    ),
  ]);

  res.json({
    success: true,
    data: {
      totalEvents: parseInt(totalEvents.rows[0].total),
      uniqueVisitors: parseInt(uniqueVisitors.rows[0].total),
      topPages: topPages.rows,
      topEvents: topEvents.rows,
      timeline: eventTimeline.rows,
    },
  });
});

// POST /analytics/query - Custom analytics query
router.post('/query', authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const orgId = authReq.auth!.organizationId;
  const { event, metrics, dimensions, filters, period, granularity } = req.body;

  const periodMap: Record<string, string> = {
    today: '1 day', '7d': '7 days', '30d': '30 days', '90d': '90 days',
  };
  const interval = periodMap[period] || '7 days';

  // Build dynamic query
  const conditions = [`organization_id = $1`, `timestamp >= NOW() - $2::interval`];
  const params: unknown[] = [orgId, interval];
  let paramIdx = 3;

  if (event) {
    conditions.push(`event = $${paramIdx++}`);
    params.push(event);
  }

  if (filters) {
    for (const filter of filters) {
      const operators: Record<string, string> = {
        eq: '=', neq: '!=', gt: '>', lt: '<', gte: '>=', lte: '<=',
        contains: 'LIKE', not_contains: 'NOT LIKE',
      };
      const op = operators[filter.operator] || '=';
      const value = filter.operator === 'contains' || filter.operator === 'not_contains'
        ? `%${filter.value}%` : filter.value;
      conditions.push(`properties->>'${filter.field}' ${op} $${paramIdx++}`);
      params.push(value);
    }
  }

  const gran = granularity || 'day';
  const groupBy = dimensions?.length
    ? dimensions.map((d: string) => `properties->>'${d}'`).join(', ')
    : `DATE_TRUNC('${gran}', timestamp)`;

  const selectMetrics = (metrics || ['count']).map((m: string) => {
    switch (m) {
      case 'count': return 'COUNT(*) as count';
      case 'unique_visitors': return 'COUNT(DISTINCT visitor_id) as unique_visitors';
      case 'unique_sessions': return 'COUNT(DISTINCT session_id) as unique_sessions';
      default: return `COUNT(*) as ${m}`;
    }
  }).join(', ');

  const { rows } = await query(
    `SELECT ${groupBy} as dimension, ${selectMetrics}
     FROM analytics_events
     WHERE ${conditions.join(' AND ')}
     GROUP BY dimension ORDER BY dimension LIMIT 1000`,
    params
  );

  res.json({ success: true, data: rows });
});

// GET /analytics/funnel/:id - Run funnel analysis
router.get('/funnel/:id', authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const orgId = authReq.auth!.organizationId;
  const { period = '30d' } = req.query;

  const periodMap: Record<string, string> = {
    '7d': '7 days', '30d': '30 days', '90d': '90 days',
  };
  const interval = periodMap[period as string] || '30 days';

  // Get funnel definition
  const funnelResult = await query(
    'SELECT * FROM funnels WHERE id = $1 AND organization_id = $2',
    [req.params.id, orgId]
  );

  if (funnelResult.rows.length === 0) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Funnel not found' } });
    return;
  }

  const funnel = funnelResult.rows[0];
  const steps = funnel.steps as { order: number; name: string; event: string }[];

  // Calculate each funnel step
  const stepResults = [];
  let previousVisitors: Set<string> | null = null;

  for (const step of steps.sort((a, b) => a.order - b.order)) {
    const { rows } = await query(
      `SELECT DISTINCT visitor_id FROM analytics_events
       WHERE organization_id = $1 AND event = $2 AND timestamp >= NOW() - $3::interval`,
      [orgId, step.event, interval]
    );

    const currentVisitors = new Set(rows.map(r => r.visitor_id));
    let completedCount: number;

    if (previousVisitors === null) {
      completedCount = currentVisitors.size;
    } else {
      // Intersection with previous step
      completedCount = [...currentVisitors].filter(v => previousVisitors!.has(v)).length;
    }

    const entered = previousVisitors?.size ?? completedCount;
    stepResults.push({
      step,
      entered,
      completed: completedCount,
      dropoff: entered - completedCount,
      conversionRate: entered > 0 ? Math.round((completedCount / entered) * 10000) / 100 : 0,
    });

    previousVisitors = currentVisitors;
  }

  const overallConversion = stepResults.length > 0 && stepResults[0].entered > 0
    ? Math.round((stepResults[stepResults.length - 1].completed / stepResults[0].entered) * 10000) / 100
    : 0;

  res.json({
    success: true,
    data: {
      funnelId: funnel.id,
      name: funnel.name,
      steps: stepResults,
      overallConversion,
    },
  });
});

// GET /analytics/realtime - Real-time active visitors
router.get('/realtime', authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const orgId = authReq.auth!.organizationId;

  const [activeVisitors, recentEvents] = await Promise.all([
    query(
      `SELECT COUNT(DISTINCT visitor_id) as count, COUNT(DISTINCT session_id) as sessions
       FROM analytics_events
       WHERE organization_id = $1 AND timestamp >= NOW() - INTERVAL '5 minutes'`,
      [orgId]
    ),
    query(
      `SELECT event, page, visitor_id, timestamp
       FROM analytics_events
       WHERE organization_id = $1 AND timestamp >= NOW() - INTERVAL '5 minutes'
       ORDER BY timestamp DESC LIMIT 50`,
      [orgId]
    ),
  ]);

  res.json({
    success: true,
    data: {
      activeVisitors: parseInt(activeVisitors.rows[0].count),
      activeSessions: parseInt(activeVisitors.rows[0].sessions),
      recentEvents: recentEvents.rows,
    },
  });
});

export default router;
