import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query, transaction } from '../db/pool.js';
import { authenticate, authorize } from '../middleware/auth.js';
import type { AuthRequest } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();
router.use(authenticate);

const createContactSchema = z.object({
  email: z.string().email(),
  firstName: z.string().max(255).optional(),
  lastName: z.string().max(255).optional(),
  phone: z.string().max(50).optional(),
  tags: z.array(z.string()).optional().default([]),
  properties: z.record(z.unknown()).optional().default({}),
});

const bulkImportSchema = z.object({
  contacts: z.array(createContactSchema).min(1).max(10000),
});

// GET /contacts
router.get('/', async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { search, tag, status, page = '1', pageSize = '25', sortBy = 'created_at', sortDir = 'desc' } = req.query;

  const conditions = ['organization_id = $1'];
  const params: unknown[] = [authReq.auth!.organizationId];
  let paramIdx = 2;

  if (search) {
    conditions.push(`(email ILIKE $${paramIdx} OR first_name ILIKE $${paramIdx} OR last_name ILIKE $${paramIdx})`);
    params.push(`%${search}%`);
    paramIdx++;
  }
  if (tag) {
    conditions.push(`$${paramIdx++} = ANY(tags)`);
    params.push(tag);
  }
  if (status) {
    conditions.push(`subscription_status = $${paramIdx++}`);
    params.push(status);
  }

  const offset = (parseInt(page as string) - 1) * parseInt(pageSize as string);
  const limit = Math.min(parseInt(pageSize as string), 100);

  const allowedSort = ['created_at', 'email', 'lead_score', 'last_activity_at'];
  const sort = allowedSort.includes(sortBy as string) ? sortBy : 'created_at';
  const dir = sortDir === 'asc' ? 'ASC' : 'DESC';

  const countResult = await query(`SELECT COUNT(*) FROM contacts WHERE ${conditions.join(' AND ')}`, params);

  const { rows } = await query(
    `SELECT * FROM contacts WHERE ${conditions.join(' AND ')} ORDER BY ${sort} ${dir} LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
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

// POST /contacts
router.post('/', authorize('owner', 'admin', 'editor'), validate(createContactSchema), async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { email, firstName, lastName, phone, tags, properties } = req.body;

  try {
    const { rows } = await query(
      `INSERT INTO contacts (organization_id, email, first_name, last_name, phone, tags, properties)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [authReq.auth!.organizationId, email, firstName, lastName, phone, tags, JSON.stringify(properties)]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error: any) {
    if (error.code === '23505') {
      res.status(409).json({ success: false, error: { code: 'DUPLICATE', message: 'Contact with this email already exists' } });
      return;
    }
    throw error;
  }
});

// POST /contacts/bulk - Bulk import
router.post('/bulk', authorize('owner', 'admin'), validate(bulkImportSchema), async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { contacts } = req.body;

  const result = await transaction(async (client) => {
    let imported = 0;
    let skipped = 0;

    for (const contact of contacts) {
      try {
        await client.query(
          `INSERT INTO contacts (organization_id, email, first_name, last_name, phone, tags, properties)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (organization_id, email) DO UPDATE SET
             first_name = COALESCE(EXCLUDED.first_name, contacts.first_name),
             last_name = COALESCE(EXCLUDED.last_name, contacts.last_name),
             phone = COALESCE(EXCLUDED.phone, contacts.phone),
             tags = ARRAY(SELECT DISTINCT unnest(contacts.tags || EXCLUDED.tags)),
             properties = contacts.properties || EXCLUDED.properties`,
          [authReq.auth!.organizationId, contact.email, contact.firstName, contact.lastName, contact.phone, contact.tags, JSON.stringify(contact.properties)]
        );
        imported++;
      } catch {
        skipped++;
      }
    }

    return { imported, skipped, total: contacts.length };
  });

  res.json({ success: true, data: result });
});

// GET /contacts/:id
router.get('/:id', async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { rows } = await query(
    'SELECT * FROM contacts WHERE id = $1 AND organization_id = $2',
    [req.params.id, authReq.auth!.organizationId]
  );

  if (rows.length === 0) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Contact not found' } });
    return;
  }

  // Get recent activity
  const activity = await query(
    `SELECT event, properties, timestamp FROM analytics_events
     WHERE organization_id = $1 AND visitor_id = $2
     ORDER BY timestamp DESC LIMIT 20`,
    [authReq.auth!.organizationId, rows[0].email]
  );

  res.json({ success: true, data: { ...rows[0], recentActivity: activity.rows } });
});

// PUT /contacts/:id
router.put('/:id', authorize('owner', 'admin', 'editor'), async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { firstName, lastName, phone, tags, properties, subscriptionStatus } = req.body;

  const updates: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (firstName !== undefined) { updates.push(`first_name = $${idx++}`); params.push(firstName); }
  if (lastName !== undefined) { updates.push(`last_name = $${idx++}`); params.push(lastName); }
  if (phone !== undefined) { updates.push(`phone = $${idx++}`); params.push(phone); }
  if (tags !== undefined) { updates.push(`tags = $${idx++}`); params.push(tags); }
  if (properties !== undefined) { updates.push(`properties = properties || $${idx++}`); params.push(JSON.stringify(properties)); }
  if (subscriptionStatus !== undefined) { updates.push(`subscription_status = $${idx++}`); params.push(subscriptionStatus); }

  if (updates.length === 0) {
    res.status(400).json({ success: false, error: { code: 'NO_UPDATES', message: 'No fields to update' } });
    return;
  }

  params.push(req.params.id, authReq.auth!.organizationId);
  const { rows } = await query(
    `UPDATE contacts SET ${updates.join(', ')} WHERE id = $${idx++} AND organization_id = $${idx++} RETURNING *`,
    params
  );

  if (rows.length === 0) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Contact not found' } });
    return;
  }

  res.json({ success: true, data: rows[0] });
});

export default router;
