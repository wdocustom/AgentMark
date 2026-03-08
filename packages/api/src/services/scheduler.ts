import { query } from '../db/pool.js';
import { logger } from '../utils/logger.js';
import { emailSender } from './email-sender.js';
import { AgentOrchestrator } from '../agents/orchestrator.js';
import { sleep } from '@agentmark/shared';

/**
 * Built-in task scheduler - no cron libraries, no third-party schedulers.
 * Runs recurring tasks on configurable intervals.
 */
export class Scheduler {
  private tasks: Map<string, ScheduledTask> = new Map();
  private running = false;

  register(name: string, intervalMs: number, handler: () => Promise<void>): void {
    this.tasks.set(name, {
      name,
      intervalMs,
      handler,
      lastRun: 0,
      running: false,
    });
  }

  async start(): Promise<void> {
    this.running = true;
    logger.info({ tasks: [...this.tasks.keys()] }, 'Scheduler started');

    while (this.running) {
      const now = Date.now();

      for (const [name, task] of this.tasks) {
        if (task.running) continue;
        if (now - task.lastRun < task.intervalMs) continue;

        task.running = true;
        task.lastRun = now;

        task.handler()
          .catch((error) => logger.error({ task: name, error }, 'Scheduled task failed'))
          .finally(() => { task.running = false; });
      }

      await sleep(1000);
    }
  }

  stop(): void {
    this.running = false;
    logger.info('Scheduler stopped');
  }
}

interface ScheduledTask {
  name: string;
  intervalMs: number;
  handler: () => Promise<void>;
  lastRun: number;
  running: boolean;
}

export function createDefaultScheduler(): Scheduler {
  const scheduler = new Scheduler();

  // Process email queue every 5 seconds
  scheduler.register('email_queue', 5000, async () => {
    const result = await emailSender.processQueue(50);
    if (result.sent > 0 || result.failed > 0) {
      logger.info(result, 'Email queue processed');
    }
  });

  // Launch scheduled campaigns every minute
  scheduler.register('campaign_launcher', 60000, async () => {
    const { rows: campaigns } = await query(
      `SELECT id, organization_id FROM campaigns
       WHERE status = 'scheduled'
       AND (schedule->>'startDate')::timestamptz <= NOW()`,
    );

    for (const campaign of campaigns) {
      const orchestrator = new AgentOrchestrator(campaign.organization_id);
      const { rows: tasks } = await query(
        `INSERT INTO agent_tasks (agent_id, organization_id, type, input, priority)
         SELECT a.id, a.organization_id, 'launch_campaign', $1, 8
         FROM agents a WHERE a.organization_id = $2 AND a.type = 'campaign_manager'
         RETURNING id`,
        [JSON.stringify({ campaignId: campaign.id }), campaign.organization_id]
      );

      if (tasks.length > 0) {
        orchestrator.executeTask(tasks[0].id).catch(() => {});
      }
    }
  });

  // Auto-segment contacts every hour
  scheduler.register('auto_segment', 3600000, async () => {
    const { rows: orgs } = await query(
      "SELECT id FROM organizations WHERE plan IN ('growth', 'enterprise')"
    );

    for (const org of orgs) {
      const orchestrator = new AgentOrchestrator(org.id);
      const { rows: tasks } = await query(
        `INSERT INTO agent_tasks (agent_id, organization_id, type, input, priority)
         SELECT a.id, a.organization_id, 'auto_segment', '{}', 3
         FROM agents a WHERE a.organization_id = $1 AND a.type = 'campaign_manager'
         RETURNING id`,
        [org.id]
      );

      if (tasks.length > 0) {
        orchestrator.executeTask(tasks[0].id).catch(() => {});
      }
    }
  });

  // Clean up old analytics events monthly (keep 1 year)
  scheduler.register('analytics_cleanup', 86400000, async () => {
    const { rowCount } = await query(
      "DELETE FROM analytics_events WHERE timestamp < NOW() - INTERVAL '365 days'"
    );
    if (rowCount && rowCount > 0) {
      logger.info({ deleted: rowCount }, 'Old analytics events cleaned up');
    }
  });

  return scheduler;
}
