import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query, transaction } from '../db/pool.js';
import { authenticate, authorize } from '../middleware/auth.js';
import type { AuthRequest } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();
router.use(authenticate);

const createCampaignSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  type: z.enum(['email', 'social', 'multi_channel', 'drip', 'triggered']),
  channels: z.array(z.object({
    channel: z.enum(['email', 'social', 'sms', 'push', 'web']),
    enabled: z.boolean(),
    contentId: z.string().uuid().optional(),
    settings: z.record(z.unknown()).optional().default({}),
  })).optional().default([]),
  segmentId: z.string().uuid().optional(),
  schedule: z.object({
    startDate: z.string(),
    endDate: z.string().optional(),
    timezone: z.string().default('UTC'),
    frequency: z.enum(['once', 'daily', 'weekly', 'monthly']).optional(),
    sendTimes: z.array(z.string()).optional(),
  }).optional(),
  budget: z.object({
    total: z.number().min(0),
    daily: z.number().min(0).optional(),
    currency: z.string().default('USD'),
  }).optional(),
  abTest: z.object({
    enabled: z.boolean(),
    variants: z.array(z.object({
      name: z.string(),
      contentId: z.string().uuid(),
      weight: z.number().min(0).max(100),
    })),
    winnerCriteria: z.enum(['open_rate', 'click_rate', 'conversion_rate']),
    testDurationHours: z.number().min(1).max(168),
    trafficSplit: z.array(z.number()),
  }).optional(),
});

// GET /campaigns
router.get('/', async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { status, type, page = '1', pageSize = '25' } = req.query;

  const conditions = ['c.organization_id = $1'];
  const params: unknown[] = [authReq.auth!.organizationId];
  let paramIdx = 2;

  if (status) { conditions.push(`c.status = $${paramIdx++}`); params.push(status); }
  if (type) { conditions.push(`c.type = $${paramIdx++}`); params.push(type); }

  const offset = (parseInt(page as string) - 1) * parseInt(pageSize as string);
  const limit = Math.min(parseInt(pageSize as string), 100);

  const countResult = await query(
    `SELECT COUNT(*) FROM campaigns c WHERE ${conditions.join(' AND ')}`,
    params
  );

  const { rows } = await query(
    `SELECT c.*, s.name as segment_name, s.estimated_size as segment_size
     FROM campaigns c
     LEFT JOIN segments s ON c.segment_id = s.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY c.updated_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...params, limit, offset]
  );

  res.json({
    success: true,
    data: rows,
    pagination: {
      page: parseInt(page as string),
      pageSize: limit,
      total: parseInt(countResult.rows[0].count),
      totalPages: Math.ceil(parseInt(countResult.rows[0].count) / limit),
    },
  });
});

// POST /campaigns
router.post('/', authorize('owner', 'admin', 'editor'), validate(createCampaignSchema), async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { name, description, type, channels, segmentId, schedule, budget, abTest } = req.body;

  const { rows } = await query(
    `INSERT INTO campaigns (organization_id, name, description, type, channels, segment_id, schedule, budget, ab_test, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [
      authReq.auth!.organizationId, name, description, type,
      JSON.stringify(channels), segmentId,
      schedule ? JSON.stringify(schedule) : '{}',
      budget ? JSON.stringify({ ...budget, spent: 0 }) : null,
      abTest ? JSON.stringify(abTest) : null,
      authReq.auth!.userId,
    ]
  );

  res.status(201).json({ success: true, data: rows[0] });
});

// GET /campaigns/:id
router.get('/:id', async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { rows } = await query(
    `SELECT c.*, s.name as segment_name, s.estimated_size as segment_size
     FROM campaigns c
     LEFT JOIN segments s ON c.segment_id = s.id
     WHERE c.id = $1 AND c.organization_id = $2`,
    [req.params.id, authReq.auth!.organizationId]
  );

  if (rows.length === 0) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Campaign not found' } });
    return;
  }

  // Get send stats
  const statsResult = await query(
    `SELECT status, COUNT(*) as count FROM campaign_sends WHERE campaign_id = $1 GROUP BY status`,
    [req.params.id]
  );

  res.json({ success: true, data: { ...rows[0], sendStats: statsResult.rows } });
});

// PUT /campaigns/:id/status
router.put('/:id/status', authorize('owner', 'admin', 'editor'), async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { status } = req.body;

  const validTransitions: Record<string, string[]> = {
    draft: ['scheduled', 'cancelled'],
    scheduled: ['active', 'cancelled'],
    active: ['paused', 'completed', 'cancelled'],
    paused: ['active', 'cancelled'],
  };

  // Verify current status allows transition
  const current = await query(
    'SELECT status FROM campaigns WHERE id = $1 AND organization_id = $2',
    [req.params.id, authReq.auth!.organizationId]
  );

  if (current.rows.length === 0) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Campaign not found' } });
    return;
  }

  const allowed = validTransitions[current.rows[0].status];
  if (!allowed?.includes(status)) {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_TRANSITION', message: `Cannot transition from ${current.rows[0].status} to ${status}` },
    });
    return;
  }

  const { rows } = await query(
    'UPDATE campaigns SET status = $1 WHERE id = $2 AND organization_id = $3 RETURNING *',
    [status, req.params.id, authReq.auth!.organizationId]
  );

  res.json({ success: true, data: rows[0] });
});

// DELETE /campaigns/:id
router.delete('/:id', authorize('owner', 'admin'), async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { rowCount } = await query(
    "DELETE FROM campaigns WHERE id = $1 AND organization_id = $2 AND status IN ('draft', 'cancelled')",
    [req.params.id, authReq.auth!.organizationId]
  );

  if (rowCount === 0) {
    res.status(400).json({ success: false, error: { code: 'CANNOT_DELETE', message: 'Can only delete draft or cancelled campaigns' } });
    return;
  }

  res.json({ success: true, data: { deleted: true } });
});

export default router;
