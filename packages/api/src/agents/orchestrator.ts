import { query, transaction } from '../db/pool.js';
import { logger } from '../utils/logger.js';
import { ContentWriterAgent } from './content-writer.js';
import { CampaignManagerAgent } from './campaign-manager.js';
import { AnalyticsAnalystAgent } from './analytics-analyst.js';
import { SEOOptimizerAgent } from './seo-optimizer.js';

export interface AgentContext {
  organizationId: string;
  agentId: string;
  taskId: string;
  brandVoice?: Record<string, unknown>;
}

export interface AgentResult {
  success: boolean;
  output: Record<string, unknown>;
  tokensUsed?: number;
}

export class AgentOrchestrator {
  private organizationId: string;

  constructor(organizationId: string) {
    this.organizationId = organizationId;
  }

  async executeTask(taskId: string): Promise<void> {
    // Mark task as running
    const taskResult = await query(
      `UPDATE agent_tasks SET status = 'running', started_at = NOW()
       WHERE id = $1 AND organization_id = $2 RETURNING *`,
      [taskId, this.organizationId]
    );

    if (taskResult.rows.length === 0) {
      logger.error({ taskId }, 'Task not found');
      return;
    }

    const task = taskResult.rows[0];

    // Get agent info
    const agentResult = await query('SELECT * FROM agents WHERE id = $1', [task.agent_id]);
    const agent = agentResult.rows[0];

    // Get org brand voice
    const orgResult = await query('SELECT brand_voice FROM organizations WHERE id = $1', [this.organizationId]);
    const brandVoice = orgResult.rows[0]?.brand_voice || {};

    const context: AgentContext = {
      organizationId: this.organizationId,
      agentId: agent.id,
      taskId: task.id,
      brandVoice,
    };

    try {
      // Update agent status
      await query("UPDATE agents SET status = 'running' WHERE id = $1", [agent.id]);

      // Route to appropriate agent
      const result = await this.routeTask(agent.type, task.type, task.input, context);

      // Update task with results
      await transaction(async (client) => {
        await client.query(
          `UPDATE agent_tasks SET status = 'completed', output = $1, completed_at = NOW() WHERE id = $2`,
          [JSON.stringify(result.output), taskId]
        );

        // Update agent metrics
        await client.query(
          `UPDATE agents SET
            status = 'idle',
            metrics = jsonb_set(
              jsonb_set(
                jsonb_set(metrics, '{tasksCompleted}', to_jsonb((metrics->>'tasksCompleted')::int + 1)),
                '{tokensUsed}', to_jsonb((metrics->>'tokensUsed')::int + $1)
              ),
              '{lastRunAt}', to_jsonb(NOW()::text)
            )
          WHERE id = $2`,
          [result.tokensUsed || 0, agent.id]
        );
      });

      logger.info({ taskId, agentType: agent.type }, 'Task completed successfully');
    } catch (error) {
      const retries = task.retries + 1;
      const maxRetries = 3;

      if (retries < maxRetries) {
        await query(
          `UPDATE agent_tasks SET status = 'queued', retries = $1, error = $2 WHERE id = $3`,
          [retries, String(error), taskId]
        );
        // Re-queue with exponential backoff
        setTimeout(() => this.executeTask(taskId), Math.pow(2, retries) * 1000);
      } else {
        await transaction(async (client) => {
          await client.query(
            `UPDATE agent_tasks SET status = 'failed', error = $1, completed_at = NOW() WHERE id = $2`,
            [String(error), taskId]
          );
          await client.query(
            `UPDATE agents SET
              status = 'idle',
              metrics = jsonb_set(metrics, '{tasksErrored}', to_jsonb((metrics->>'tasksErrored')::int + 1))
            WHERE id = $1`,
            [agent.id]
          );
        });
      }

      logger.error({ taskId, error, retries }, 'Task execution failed');
    }
  }

  private async routeTask(
    agentType: string,
    taskType: string,
    input: Record<string, unknown>,
    context: AgentContext
  ): Promise<AgentResult> {
    switch (agentType) {
      case 'content_writer': {
        const agent = new ContentWriterAgent(context);
        return agent.execute(taskType, input);
      }
      case 'campaign_manager': {
        const agent = new CampaignManagerAgent(context);
        return agent.execute(taskType, input);
      }
      case 'analytics_analyst': {
        const agent = new AnalyticsAnalystAgent(context);
        return agent.execute(taskType, input);
      }
      case 'seo_optimizer': {
        const agent = new SEOOptimizerAgent(context);
        return agent.execute(taskType, input);
      }
      default:
        throw new Error(`Unknown agent type: ${agentType}`);
    }
  }
}
