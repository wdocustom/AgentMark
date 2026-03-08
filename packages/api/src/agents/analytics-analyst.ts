import { query } from '../db/pool.js';
import { BaseAgent } from './base-agent.js';
import type { AgentResult } from './orchestrator.js';

export class AnalyticsAnalystAgent extends BaseAgent {
  protected registerTools(): void {
    this.registerTool({
      name: 'run_query',
      description: 'Run an analytics query',
      execute: async (params) => {
        const sql = params.sql as string;
        // Only allow SELECT queries for safety
        if (!sql.trim().toUpperCase().startsWith('SELECT')) {
          throw new Error('Only SELECT queries are allowed');
        }
        const { rows } = await query(sql, params.params as unknown[]);
        return rows;
      },
    });

    this.registerTool({
      name: 'create_funnel',
      description: 'Create a conversion funnel',
      execute: async (params) => {
        const { rows } = await query(
          `INSERT INTO funnels (organization_id, name, steps, created_by)
           VALUES ($1, $2, $3, NULL) RETURNING id`,
          [this.context.organizationId, params.name, JSON.stringify(params.steps)]
        );
        return { funnelId: rows[0].id };
      },
    });

    this.registerTool({
      name: 'save_dashboard',
      description: 'Save a dashboard configuration',
      execute: async (params) => {
        const { rows } = await query(
          `INSERT INTO dashboards (organization_id, name, widgets)
           VALUES ($1, $2, $3) RETURNING id`,
          [this.context.organizationId, params.name, JSON.stringify(params.widgets)]
        );
        return { dashboardId: rows[0].id };
      },
    });
  }

  async execute(taskType: string, input: Record<string, unknown>): Promise<AgentResult> {
    switch (taskType) {
      case 'traffic_analysis':
        return this.analyzeTraffic(input);
      case 'conversion_analysis':
        return this.analyzeConversions(input);
      case 'audience_insights':
        return this.audienceInsights(input);
      case 'predict_trends':
        return this.predictTrends(input);
      case 'create_report':
        return this.createReport(input);
      default:
        throw new Error(`Unknown task type: ${taskType}`);
    }
  }

  private async analyzeTraffic(input: Record<string, unknown>): Promise<AgentResult> {
    const period = (input.period as string) || '30d';
    const periodMap: Record<string, string> = { '7d': '7 days', '30d': '30 days', '90d': '90 days' };
    const interval = periodMap[period] || '30 days';

    const [overview, sources, devices, topPages] = await Promise.all([
      query(
        `SELECT
          COUNT(*) as total_events,
          COUNT(DISTINCT visitor_id) as unique_visitors,
          COUNT(DISTINCT session_id) as total_sessions,
          COUNT(*) FILTER (WHERE event = 'page_view') as page_views
         FROM analytics_events
         WHERE organization_id = $1 AND timestamp >= NOW() - $2::interval`,
        [this.context.organizationId, interval]
      ),
      query(
        `SELECT
          COALESCE(SPLIT_PART(referrer, '/', 3), 'direct') as source,
          COUNT(DISTINCT visitor_id) as visitors,
          COUNT(*) as events
         FROM analytics_events
         WHERE organization_id = $1 AND timestamp >= NOW() - $2::interval
         GROUP BY source ORDER BY visitors DESC LIMIT 10`,
        [this.context.organizationId, interval]
      ),
      query(
        `SELECT
          CASE
            WHEN user_agent ILIKE '%mobile%' OR user_agent ILIKE '%android%' OR user_agent ILIKE '%iphone%' THEN 'mobile'
            WHEN user_agent ILIKE '%tablet%' OR user_agent ILIKE '%ipad%' THEN 'tablet'
            ELSE 'desktop'
          END as device_type,
          COUNT(DISTINCT visitor_id) as visitors
         FROM analytics_events
         WHERE organization_id = $1 AND timestamp >= NOW() - $2::interval AND user_agent IS NOT NULL
         GROUP BY device_type`,
        [this.context.organizationId, interval]
      ),
      query(
        `SELECT page, COUNT(*) as views, COUNT(DISTINCT visitor_id) as unique_views
         FROM analytics_events
         WHERE organization_id = $1 AND timestamp >= NOW() - $2::interval AND page IS NOT NULL
         GROUP BY page ORDER BY views DESC LIMIT 20`,
        [this.context.organizationId, interval]
      ),
    ]);

    return {
      success: true,
      output: {
        overview: overview.rows[0],
        topSources: sources.rows,
        deviceBreakdown: devices.rows,
        topPages: topPages.rows,
        period,
      },
    };
  }

  private async analyzeConversions(input: Record<string, unknown>): Promise<AgentResult> {
    const goalEvent = (input.goalEvent as string) || 'conversion';
    const interval = '30 days';

    const [conversionData, conversionBySource, timeline] = await Promise.all([
      query(
        `SELECT
          COUNT(DISTINCT visitor_id) FILTER (WHERE event = $2) as conversions,
          COUNT(DISTINCT visitor_id) as total_visitors
         FROM analytics_events
         WHERE organization_id = $1 AND timestamp >= NOW() - $3::interval`,
        [this.context.organizationId, goalEvent, interval]
      ),
      query(
        `WITH visitors AS (
          SELECT visitor_id, MIN(referrer) as first_referrer
          FROM analytics_events
          WHERE organization_id = $1 AND timestamp >= NOW() - $3::interval
          GROUP BY visitor_id
        ),
        converters AS (
          SELECT DISTINCT visitor_id
          FROM analytics_events
          WHERE organization_id = $1 AND event = $2 AND timestamp >= NOW() - $3::interval
        )
        SELECT
          COALESCE(SPLIT_PART(v.first_referrer, '/', 3), 'direct') as source,
          COUNT(*) as visitors,
          COUNT(c.visitor_id) as conversions
        FROM visitors v
        LEFT JOIN converters c ON v.visitor_id = c.visitor_id
        GROUP BY source ORDER BY conversions DESC LIMIT 10`,
        [this.context.organizationId, goalEvent, interval]
      ),
      query(
        `SELECT
          DATE_TRUNC('day', timestamp) as date,
          COUNT(DISTINCT visitor_id) FILTER (WHERE event = $2) as conversions,
          COUNT(DISTINCT visitor_id) as visitors
         FROM analytics_events
         WHERE organization_id = $1 AND timestamp >= NOW() - $3::interval
         GROUP BY date ORDER BY date`,
        [this.context.organizationId, goalEvent, interval]
      ),
    ]);

    const totalVisitors = parseInt(conversionData.rows[0].total_visitors);
    const conversions = parseInt(conversionData.rows[0].conversions);

    return {
      success: true,
      output: {
        conversionRate: totalVisitors > 0 ? Math.round((conversions / totalVisitors) * 10000) / 100 : 0,
        totalConversions: conversions,
        totalVisitors,
        bySource: conversionBySource.rows,
        timeline: timeline.rows,
      },
    };
  }

  private async audienceInsights(input: Record<string, unknown>): Promise<AgentResult> {
    const interval = '30 days';

    const [engagement, retention, geography] = await Promise.all([
      query(
        `SELECT
          visitor_id,
          COUNT(*) as events,
          COUNT(DISTINCT session_id) as sessions,
          MIN(timestamp) as first_seen,
          MAX(timestamp) as last_seen
         FROM analytics_events
         WHERE organization_id = $1 AND timestamp >= NOW() - $2::interval
         GROUP BY visitor_id
         ORDER BY events DESC LIMIT 100`,
        [this.context.organizationId, interval]
      ),
      query(
        `SELECT
          DATE_TRUNC('week', first_visit) as cohort_week,
          COUNT(DISTINCT visitor_id) as cohort_size,
          COUNT(DISTINCT visitor_id) FILTER (WHERE return_visits > 0) as returned
         FROM (
           SELECT
             visitor_id,
             MIN(timestamp) as first_visit,
             COUNT(DISTINCT DATE_TRUNC('day', timestamp)) - 1 as return_visits
           FROM analytics_events
           WHERE organization_id = $1 AND timestamp >= NOW() - $2::interval
           GROUP BY visitor_id
         ) cohorts
         GROUP BY cohort_week ORDER BY cohort_week`,
        [this.context.organizationId, interval]
      ),
      query(
        `SELECT
          geo->>'country' as country,
          COUNT(DISTINCT visitor_id) as visitors
         FROM analytics_events
         WHERE organization_id = $1 AND timestamp >= NOW() - $2::interval AND geo IS NOT NULL
         GROUP BY country ORDER BY visitors DESC LIMIT 20`,
        [this.context.organizationId, interval]
      ),
    ]);

    // Calculate engagement tiers
    const visitors = engagement.rows;
    const tiers = {
      power_users: visitors.filter((v: any) => parseInt(v.events) > 50).length,
      regular: visitors.filter((v: any) => parseInt(v.events) >= 10 && parseInt(v.events) <= 50).length,
      casual: visitors.filter((v: any) => parseInt(v.events) < 10).length,
    };

    return {
      success: true,
      output: {
        engagementTiers: tiers,
        topVisitors: visitors.slice(0, 10),
        retentionCohorts: retention.rows,
        geography: geography.rows,
      },
    };
  }

  private async predictTrends(input: Record<string, unknown>): Promise<AgentResult> {
    // Simple trend prediction using moving averages
    const { rows: dailyData } = await query(
      `SELECT
        DATE_TRUNC('day', timestamp) as date,
        COUNT(*) as events,
        COUNT(DISTINCT visitor_id) as visitors
       FROM analytics_events
       WHERE organization_id = $1 AND timestamp >= NOW() - INTERVAL '90 days'
       GROUP BY date ORDER BY date`,
      [this.context.organizationId]
    );

    // Calculate 7-day moving average and trend direction
    const data = dailyData.map(r => ({
      date: r.date,
      events: parseInt(r.events),
      visitors: parseInt(r.visitors),
    }));

    const predictions = [];
    if (data.length >= 14) {
      const recent7 = data.slice(-7);
      const previous7 = data.slice(-14, -7);

      const recentAvg = recent7.reduce((s, d) => s + d.visitors, 0) / 7;
      const previousAvg = previous7.reduce((s, d) => s + d.visitors, 0) / 7;

      const growthRate = previousAvg > 0 ? (recentAvg - previousAvg) / previousAvg : 0;

      for (let i = 1; i <= 7; i++) {
        predictions.push({
          date: new Date(Date.now() + i * 86400000).toISOString().split('T')[0],
          predictedVisitors: Math.round(recentAvg * (1 + growthRate * (i / 7))),
          confidence: Math.max(0.5, 0.95 - i * 0.05),
        });
      }
    }

    return {
      success: true,
      output: {
        historicalData: data.slice(-30),
        predictions,
        trend: predictions.length > 0
          ? predictions[predictions.length - 1].predictedVisitors > data[data.length - 1]?.visitors
            ? 'growing' : 'declining'
          : 'insufficient_data',
      },
    };
  }

  private async createReport(input: Record<string, unknown>): Promise<AgentResult> {
    const reportType = (input.type as string) || 'overview';

    const [traffic, conversions, audience] = await Promise.all([
      this.analyzeTraffic({ period: '30d' }),
      this.analyzeConversions({ goalEvent: input.goalEvent || 'conversion' }),
      this.audienceInsights({}),
    ]);

    // Create dashboard with widgets
    const widgets = [
      { id: 'w1', type: 'metric', title: 'Total Visitors', query: { metrics: ['unique_visitors'], period: '30d' }, position: { x: 0, y: 0, w: 3, h: 1 } },
      { id: 'w2', type: 'metric', title: 'Conversion Rate', query: { metrics: ['conversion_rate'], period: '30d' }, position: { x: 3, y: 0, w: 3, h: 1 } },
      { id: 'w3', type: 'chart', title: 'Traffic Over Time', query: { metrics: ['visitors'], period: '30d', granularity: 'day' }, position: { x: 0, y: 1, w: 6, h: 2 } },
      { id: 'w4', type: 'table', title: 'Top Pages', query: { metrics: ['page_views'], dimensions: ['page'], period: '30d' }, position: { x: 0, y: 3, w: 3, h: 2 } },
      { id: 'w5', type: 'chart', title: 'Traffic Sources', query: { metrics: ['visitors'], dimensions: ['source'], period: '30d' }, position: { x: 3, y: 3, w: 3, h: 2 } },
    ];

    const dashboard = await this.useTool('save_dashboard', {
      name: `${reportType} Report - ${new Date().toISOString().split('T')[0]}`,
      widgets,
    });

    return {
      success: true,
      output: {
        dashboardId: (dashboard as any).dashboardId,
        traffic: traffic.output,
        conversions: conversions.output,
        audience: audience.output,
      },
    };
  }
}
