import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query, transaction } from '../db/pool.js';
import { authenticate, authorize } from '../middleware/auth.js';
import type { AuthRequest } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();
router.use(authenticate);

const createContentSchema = z.object({
  type: z.enum(['blog_post', 'email', 'social_post', 'ad_copy', 'landing_page', 'sms', 'push_notification']),
  title: z.string().min(1).max(500),
  body: z.string().optional().default(''),
  metadata: z.record(z.unknown()).optional().default({}),
  campaignId: z.string().uuid().optional(),
});

const updateContentSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  body: z.string().optional(),
  status: z.enum(['draft', 'review', 'approved', 'published', 'archived']).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// GET /content
router.get('/', async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { type, status, page = '1', pageSize = '25' } = req.query;

  const conditions = ['organization_id = $1'];
  const params: unknown[] = [authReq.auth!.organizationId];
  let paramIdx = 2;

  if (type) {
    conditions.push(`type = $${paramIdx++}`);
    params.push(type);
  }
  if (status) {
    conditions.push(`status = $${paramIdx++}`);
    params.push(status);
  }

  const offset = (parseInt(page as string) - 1) * parseInt(pageSize as string);
  const limit = Math.min(parseInt(pageSize as string), 100);

  const countResult = await query(
    `SELECT COUNT(*) FROM content WHERE ${conditions.join(' AND ')}`,
    params
  );
  const total = parseInt(countResult.rows[0].count);

  const { rows } = await query(
    `SELECT * FROM content WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...params, limit, offset]
  );

  res.json({
    success: true,
    data: rows,
    pagination: {
      page: parseInt(page as string),
      pageSize: limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

// POST /content
router.post('/', authorize('owner', 'admin', 'editor'), validate(createContentSchema), async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { type, title, body, metadata, campaignId } = req.body;

  const result = await transaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO content (organization_id, type, title, body, metadata, campaign_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [authReq.auth!.organizationId, type, title, body, JSON.stringify(metadata), campaignId, authReq.auth!.userId]
    );

    // Create initial version
    await client.query(
      'INSERT INTO content_versions (content_id, version, body, created_by) VALUES ($1, 1, $2, $3)',
      [rows[0].id, body, authReq.auth!.userId]
    );

    return rows[0];
  });

  res.status(201).json({ success: true, data: result });
});

// GET /content/:id
router.get('/:id', async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { rows } = await query(
    'SELECT * FROM content WHERE id = $1 AND organization_id = $2',
    [req.params.id, authReq.auth!.organizationId]
  );

  if (rows.length === 0) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Content not found' } });
    return;
  }

  // Fetch versions
  const versions = await query(
    'SELECT * FROM content_versions WHERE content_id = $1 ORDER BY version DESC',
    [req.params.id]
  );

  res.json({ success: true, data: { ...rows[0], versions: versions.rows } });
});

// PUT /content/:id
router.put('/:id', authorize('owner', 'admin', 'editor'), validate(updateContentSchema), async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { title, body, status, metadata } = req.body;

  const result = await transaction(async (client) => {
    // Build dynamic update
    const updates: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (title !== undefined) { updates.push(`title = $${idx++}`); params.push(title); }
    if (body !== undefined) { updates.push(`body = $${idx++}`); params.push(body); }
    if (status !== undefined) { updates.push(`status = $${idx++}`); params.push(status); }
    if (metadata !== undefined) { updates.push(`metadata = $${idx++}`); params.push(JSON.stringify(metadata)); }

    if (updates.length === 0) {
      const { rows } = await client.query('SELECT * FROM content WHERE id = $1 AND organization_id = $2', [req.params.id, authReq.auth!.organizationId]);
      return rows[0];
    }

    params.push(req.params.id, authReq.auth!.organizationId);
    const { rows } = await client.query(
      `UPDATE content SET ${updates.join(', ')} WHERE id = $${idx++} AND organization_id = $${idx++} RETURNING *`,
      params
    );

    if (rows.length === 0) {
      return null;
    }

    // Create new version if body changed
    if (body !== undefined) {
      const versionResult = await client.query(
        'SELECT MAX(version) as max_version FROM content_versions WHERE content_id = $1',
        [req.params.id]
      );
      const nextVersion = (versionResult.rows[0].max_version || 0) + 1;
      await client.query(
        'INSERT INTO content_versions (content_id, version, body, created_by) VALUES ($1, $2, $3, $4)',
        [req.params.id, nextVersion, body, authReq.auth!.userId]
      );
    }

    return rows[0];
  });

  if (!result) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Content not found' } });
    return;
  }

  res.json({ success: true, data: result });
});

// DELETE /content/:id
router.delete('/:id', authorize('owner', 'admin'), async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { rowCount } = await query(
    'DELETE FROM content WHERE id = $1 AND organization_id = $2',
    [req.params.id, authReq.auth!.organizationId]
  );

  if (rowCount === 0) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Content not found' } });
    return;
  }

  res.json({ success: true, data: { deleted: true } });
});

export default router;
