import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query, transaction } from '../db/pool.js';
import { hashPassword, verifyPassword, generateToken, authenticate, getUserById } from '../middleware/auth.js';
import type { AuthRequest } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { generateId, slugify } from '@agentmark/shared';

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(255),
  organizationName: z.string().min(1).max(255),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

// POST /auth/register
router.post('/register', validate(registerSchema), async (req: Request, res: Response) => {
  const { email, password, name, organizationName } = req.body;

  try {
    // Check if email exists
    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      res.status(409).json({
        success: false,
        error: { code: 'EMAIL_EXISTS', message: 'Email already registered' },
      });
      return;
    }

    const result = await transaction(async (client) => {
      // Create organization
      const orgResult = await client.query(
        'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id',
        [organizationName, slugify(organizationName) + '-' + generateId().substring(0, 6)]
      );
      const orgId = orgResult.rows[0].id;

      // Create user
      const passwordHash = await hashPassword(password);
      const userResult = await client.query(
        'INSERT INTO users (organization_id, email, password_hash, name, role) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [orgId, email, passwordHash, name, 'owner']
      );
      const userId = userResult.rows[0].id;

      // Create default agents for the organization
      const agentTypes = [
        { type: 'content_writer', name: 'Content Writer', capabilities: ['blog_post', 'email', 'social_post', 'ad_copy'] },
        { type: 'campaign_manager', name: 'Campaign Manager', capabilities: ['scheduling', 'ab_testing', 'optimization'] },
        { type: 'analytics_analyst', name: 'Analytics Analyst', capabilities: ['reporting', 'predictions', 'segmentation'] },
        { type: 'orchestrator', name: 'Orchestrator', capabilities: ['task_routing', 'workflow_management'] },
      ];

      for (const agent of agentTypes) {
        await client.query(
          'INSERT INTO agents (organization_id, type, name, capabilities) VALUES ($1, $2, $3, $4)',
          [orgId, agent.type, agent.name, agent.capabilities]
        );
      }

      return { userId, orgId };
    });

    const token = generateToken({
      userId: result.userId,
      organizationId: result.orgId,
      role: 'owner',
    });

    res.status(201).json({
      success: true,
      data: { token, userId: result.userId, organizationId: result.orgId },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Registration failed' },
    });
  }
});

// POST /auth/login
router.post('/login', validate(loginSchema), async (req: Request, res: Response) => {
  const { email, password } = req.body;

  try {
    const { rows } = await query(
      'SELECT id, password_hash, role, organization_id FROM users WHERE email = $1',
      [email]
    );

    if (rows.length === 0) {
      res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
      });
      return;
    }

    const user = rows[0];
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
      });
      return;
    }

    // Update last login
    await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    const token = generateToken({
      userId: user.id,
      organizationId: user.organization_id,
      role: user.role,
    });

    res.json({ success: true, data: { token } });
  } catch {
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Login failed' },
    });
  }
});

// GET /auth/me
router.get('/me', authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const user = await getUserById(authReq.auth!.userId);
  if (!user) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
    return;
  }
  res.json({ success: true, data: user });
});

export default router;
