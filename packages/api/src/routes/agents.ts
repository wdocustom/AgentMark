import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { authenticate, authorize } from '../middleware/auth.js';
import type { AuthRequest } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { AgentOrchestrator } from '../agents/orchestrator.js';

const router = Router();
router.use(authenticate);

const createTaskSchema = z.object({
  agentType: z.enum([
    'content_writer', 'campaign_manager', 'analytics_analyst',
    'seo_optimizer', 'audience_segmenter', 'ab_test_optimizer', 'orchestrator',
  ]),
  taskType: z.string().min(1),
  input: z.record(z.unknown()),
  priority: z.number().min(0).max(10).optional().default(5),
});

// GET /agents - List organization's agents
router.get('/', async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { rows } = await query(
    'SELECT * FROM agents WHERE organization_id = $1 ORDER BY type',
    [authReq.auth!.organizationId]
  );
  res.json({ success: true, data: rows });
});

// GET /agents/:id - Get agent details with recent tasks
router.get('/:id', async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { rows } = await query(
    'SELECT * FROM agents WHERE id = $1 AND organization_id = $2',
    [req.params.id, authReq.auth!.organizationId]
  );

  if (rows.length === 0) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Agent not found' } });
    return;
  }

  const tasks = await query(
    'SELECT * FROM agent_tasks WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 20',
    [req.params.id]
  );

  res.json({ success: true, data: { ...rows[0], recentTasks: tasks.rows } });
});

// POST /agents/task - Submit a task for an agent
router.post('/task', authorize('owner', 'admin', 'editor'), validate(createTaskSchema), async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { agentType, taskType, input, priority } = req.body;

  // Find the agent
  const agentResult = await query(
    'SELECT * FROM agents WHERE organization_id = $1 AND type = $2',
    [authReq.auth!.organizationId, agentType]
  );

  if (agentResult.rows.length === 0) {
    res.status(404).json({ success: false, error: { code: 'NO_AGENT', message: `No ${agentType} agent found` } });
    return;
  }

  const agent = agentResult.rows[0];

  // Create the task
  const { rows } = await query(
    `INSERT INTO agent_tasks (agent_id, organization_id, type, input, priority)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [agent.id, authReq.auth!.organizationId, taskType, JSON.stringify(input), priority]
  );

  // Execute the task asynchronously
  const orchestrator = new AgentOrchestrator(authReq.auth!.organizationId);
  orchestrator.executeTask(rows[0].id).catch(() => {});

  res.status(201).json({ success: true, data: rows[0] });
});

// GET /agents/tasks - List tasks
router.get('/tasks/list', async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { status, agentType, page = '1', pageSize = '25' } = req.query;

  const conditions = ['at.organization_id = $1'];
  const params: unknown[] = [authReq.auth!.organizationId];
  let paramIdx = 2;

  if (status) { conditions.push(`at.status = $${paramIdx++}`); params.push(status); }
  if (agentType) {
    conditions.push(`a.type = $${paramIdx++}`);
    params.push(agentType);
  }

  const offset = (parseInt(page as string) - 1) * parseInt(pageSize as string);
  const limit = Math.min(parseInt(pageSize as string), 100);

  const { rows } = await query(
    `SELECT at.*, a.type as agent_type, a.name as agent_name
     FROM agent_tasks at
     JOIN agents a ON at.agent_id = a.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY at.created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...params, limit, offset]
  );

  res.json({ success: true, data: rows });
});

// GET /agents/task/:id - Get task result
router.get('/task/:id', async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { rows } = await query(
    `SELECT at.*, a.type as agent_type, a.name as agent_name
     FROM agent_tasks at JOIN agents a ON at.agent_id = a.id
     WHERE at.id = $1 AND at.organization_id = $2`,
    [req.params.id, authReq.auth!.organizationId]
  );

  if (rows.length === 0) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Task not found' } });
    return;
  }

  res.json({ success: true, data: rows[0] });
});

export default router;
