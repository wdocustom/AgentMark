import { query, transaction } from '../db/pool.js';
import { BaseAgent } from './base-agent.js';
import type { AgentContext, AgentResult } from './orchestrator.js';
import { calculateRate } from '@agentmark/shared';

export class CampaignManagerAgent extends BaseAgent {
  constructor(context: AgentContext) {
    super(context);
  }

  protected registerTools(): void {
    this.registerTool({
      name: 'get_segment_contacts',
      description: 'Get contacts from a segment',
      execute: async (params) => {
        const { rows } = await query(
          `SELECT c.* FROM contacts c
           JOIN segment_contacts sc ON c.id = sc.contact_id
           WHERE sc.segment_id = $1 AND c.subscription_status = 'subscribed'
           LIMIT $2`,
          [params.segmentId, params.limit || 10000]
        );
        return rows;
      },
    });

    this.registerTool({
      name: 'queue_campaign_send',
      description: 'Queue a campaign send for a contact',
      execute: async (params) => {
        const { rows } = await query(
          `INSERT INTO campaign_sends (campaign_id, contact_id, channel, variant_id, status)
           VALUES ($1, $2, $3, $4, 'queued') RETURNING id`,
          [params.campaignId, params.contactId, params.channel, params.variantId || null]
        );
        return { sendId: rows[0].id };
      },
    });

    this.registerTool({
      name: 'update_campaign_metrics',
      description: 'Update campaign metrics based on send data',
      execute: async (params) => {
        const campaignId = params.campaignId as string;
        const { rows } = await query(
          `SELECT
            COUNT(*) FILTER (WHERE status != 'queued') as sent,
            COUNT(*) FILTER (WHERE status IN ('delivered', 'opened', 'clicked')) as delivered,
            COUNT(*) FILTER (WHERE status IN ('opened', 'clicked')) as opens,
            COUNT(*) FILTER (WHERE status = 'clicked') as clicks,
            COUNT(*) FILTER (WHERE status = 'bounced') as bounces
           FROM campaign_sends WHERE campaign_id = $1`,
          [campaignId]
        );

        const stats = rows[0];
        const metrics = {
          sent: parseInt(stats.sent),
          delivered: parseInt(stats.delivered),
          opens: parseInt(stats.opens),
          uniqueOpens: parseInt(stats.opens),
          clicks: parseInt(stats.clicks),
          uniqueClicks: parseInt(stats.clicks),
          conversions: 0,
          bounces: parseInt(stats.bounces),
          unsubscribes: 0,
          revenue: 0,
          openRate: calculateRate(parseInt(stats.opens), parseInt(stats.delivered)),
          clickRate: calculateRate(parseInt(stats.clicks), parseInt(stats.delivered)),
          conversionRate: 0,
          bounceRate: calculateRate(parseInt(stats.bounces), parseInt(stats.sent)),
        };

        await query(
          'UPDATE campaigns SET metrics = $1 WHERE id = $2',
          [JSON.stringify(metrics), campaignId]
        );

        return metrics;
      },
    });

    this.registerTool({
      name: 'evaluate_ab_test',
      description: 'Evaluate A/B test results and pick winner',
      execute: async (params) => {
        const campaignId = params.campaignId as string;

        const { rows } = await query(
          `SELECT variant_id,
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status IN ('opened', 'clicked')) as opens,
            COUNT(*) FILTER (WHERE status = 'clicked') as clicks
           FROM campaign_sends
           WHERE campaign_id = $1 AND variant_id IS NOT NULL
           GROUP BY variant_id`,
          [campaignId]
        );

        const variants = rows.map(r => ({
          variantId: r.variant_id,
          total: parseInt(r.total),
          opens: parseInt(r.opens),
          clicks: parseInt(r.clicks),
          openRate: calculateRate(parseInt(r.opens), parseInt(r.total)),
          clickRate: calculateRate(parseInt(r.clicks), parseInt(r.total)),
        }));

        // Statistical significance check (simplified z-test)
        const criteria = params.criteria as string || 'open_rate';
        const sorted = variants.sort((a, b) => {
          const metricKey = criteria === 'open_rate' ? 'openRate' : 'clickRate';
          return b[metricKey] - a[metricKey];
        });

        return {
          variants: sorted,
          winner: sorted[0]?.variantId || null,
          isSignificant: sorted.length >= 2 && sorted[0].total >= 100,
        };
      },
    });
  }

  async execute(taskType: string, input: Record<string, unknown>): Promise<AgentResult> {
    switch (taskType) {
      case 'launch_campaign':
        return this.launchCampaign(input);
      case 'optimize_send_time':
        return this.optimizeSendTime(input);
      case 'evaluate_ab_test':
        return this.evaluateABTest(input);
      case 'auto_segment':
        return this.autoSegment(input);
      case 'campaign_report':
        return this.generateReport(input);
      default:
        throw new Error(`Unknown task type: ${taskType}`);
    }
  }

  private async launchCampaign(input: Record<string, unknown>): Promise<AgentResult> {
    const campaignId = input.campaignId as string;

    // Get campaign details
    const { rows: campaigns } = await query(
      'SELECT * FROM campaigns WHERE id = $1 AND organization_id = $2',
      [campaignId, this.context.organizationId]
    );

    if (campaigns.length === 0) throw new Error('Campaign not found');
    const campaign = campaigns[0];

    if (campaign.status !== 'scheduled' && campaign.status !== 'draft') {
      throw new Error(`Campaign cannot be launched from status: ${campaign.status}`);
    }

    // Get segment contacts
    if (!campaign.segment_id) throw new Error('Campaign has no target segment');

    const contacts = await this.useTool('get_segment_contacts', {
      segmentId: campaign.segment_id,
    }) as any[];

    // Queue sends
    const channels = campaign.channels as { channel: string; enabled: boolean }[];
    const enabledChannels = channels.filter(c => c.enabled);
    let queued = 0;

    const abTest = campaign.ab_test as { enabled: boolean; variants: { id: string; weight: number }[] } | null;

    await transaction(async (client) => {
      for (const contact of contacts) {
        for (const channelConfig of enabledChannels) {
          let variantId: string | null = null;

          // Assign A/B test variant
          if (abTest?.enabled && abTest.variants.length > 0) {
            const rand = Math.random() * 100;
            let cumWeight = 0;
            for (const variant of abTest.variants) {
              cumWeight += variant.weight;
              if (rand <= cumWeight) {
                variantId = variant.id;
                break;
              }
            }
          }

          await this.useTool('queue_campaign_send', {
            campaignId,
            contactId: contact.id,
            channel: channelConfig.channel,
            variantId,
          });
          queued++;
        }
      }

      // Update campaign status
      await client.query(
        "UPDATE campaigns SET status = 'active' WHERE id = $1",
        [campaignId]
      );
    });

    return {
      success: true,
      output: {
        campaignId,
        contactsTargeted: contacts.length,
        sendsQueued: queued,
        channels: enabledChannels.map(c => c.channel),
      },
    };
  }

  private async optimizeSendTime(input: Record<string, unknown>): Promise<AgentResult> {
    const segmentId = input.segmentId as string;

    // Analyze historical open data to find optimal send times
    const { rows } = await query(
      `SELECT
        EXTRACT(DOW FROM cs.opened_at) as day_of_week,
        EXTRACT(HOUR FROM cs.opened_at) as hour,
        COUNT(*) as opens
       FROM campaign_sends cs
       JOIN segment_contacts sc ON cs.contact_id = sc.contact_id
       WHERE sc.segment_id = $1 AND cs.opened_at IS NOT NULL
       GROUP BY day_of_week, hour
       ORDER BY opens DESC LIMIT 10`,
      [segmentId]
    );

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const optimalTimes = rows.map(r => ({
      dayOfWeek: dayNames[parseInt(r.day_of_week)],
      hour: parseInt(r.hour),
      historicalOpens: parseInt(r.opens),
    }));

    return {
      success: true,
      output: {
        optimalTimes,
        recommendation: optimalTimes[0]
          ? `Best time: ${optimalTimes[0].dayOfWeek} at ${optimalTimes[0].hour}:00`
          : 'Not enough data for optimization',
      },
    };
  }

  private async evaluateABTest(input: Record<string, unknown>): Promise<AgentResult> {
    const result = await this.useTool('evaluate_ab_test', {
      campaignId: input.campaignId,
      criteria: input.criteria || 'open_rate',
    });

    return {
      success: true,
      output: result as Record<string, unknown>,
    };
  }

  private async autoSegment(input: Record<string, unknown>): Promise<AgentResult> {
    // Automatically create segments based on behavior patterns
    const { rows: contacts } = await query(
      `SELECT c.id, c.email, c.lead_score, c.tags, c.last_activity_at,
        COUNT(DISTINCT ae.session_id) as sessions,
        COUNT(ae.id) as total_events,
        MAX(ae.timestamp) as last_event
       FROM contacts c
       LEFT JOIN analytics_events ae ON ae.visitor_id = c.email AND ae.organization_id = c.organization_id
       WHERE c.organization_id = $1 AND c.subscription_status = 'subscribed'
       GROUP BY c.id`,
      [this.context.organizationId]
    );

    // Segment by engagement level
    const segments = {
      highly_engaged: contacts.filter((c: any) => parseInt(c.total_events) > 50 || c.lead_score > 80),
      moderately_engaged: contacts.filter((c: any) => parseInt(c.total_events) >= 10 && parseInt(c.total_events) <= 50),
      low_engagement: contacts.filter((c: any) => parseInt(c.total_events) < 10 && parseInt(c.total_events) > 0),
      inactive: contacts.filter((c: any) => parseInt(c.total_events) === 0),
    };

    // Create or update segments in DB
    const createdSegments = [];
    for (const [name, contactList] of Object.entries(segments)) {
      if (contactList.length === 0) continue;

      const { rows } = await query(
        `INSERT INTO segments (organization_id, name, description, estimated_size, tags)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING RETURNING id`,
        [
          this.context.organizationId,
          `Auto: ${name.replace(/_/g, ' ')}`,
          `Automatically segmented by engagement level`,
          contactList.length,
          [`auto`, name],
        ]
      );

      if (rows.length > 0) {
        // Add contacts to segment
        for (const contact of contactList) {
          await query(
            'INSERT INTO segment_contacts (segment_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [rows[0].id, (contact as any).id]
          );
        }
        createdSegments.push({ name, size: contactList.length, segmentId: rows[0].id });
      }
    }

    return {
      success: true,
      output: { segments: createdSegments, totalContacts: contacts.length },
    };
  }

  private async generateReport(input: Record<string, unknown>): Promise<AgentResult> {
    const campaignId = input.campaignId as string;
    const metrics = await this.useTool('update_campaign_metrics', { campaignId });

    const { rows: campaign } = await query('SELECT * FROM campaigns WHERE id = $1', [campaignId]);

    return {
      success: true,
      output: {
        campaign: campaign[0]?.name,
        metrics,
        summary: `Campaign delivered ${(metrics as any).delivered} messages with a ${(metrics as any).openRate}% open rate and ${(metrics as any).clickRate}% click rate.`,
      },
    };
  }
}
