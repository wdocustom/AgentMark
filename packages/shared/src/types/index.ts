// ============================================================
// AgentMark - Core Type Definitions
// ============================================================

// --- Auth & Users ---
export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  organizationId: string;
  avatarUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type UserRole = 'owner' | 'admin' | 'editor' | 'viewer';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: PlanTier;
  brandVoice?: BrandVoice;
  createdAt: Date;
  updatedAt: Date;
}

export type PlanTier = 'starter' | 'growth' | 'enterprise';

export interface BrandVoice {
  tone: string[];
  personality: string;
  guidelines: string;
  keywords: string[];
  avoidWords: string[];
  examples: string[];
}

// --- Content ---
export interface Content {
  id: string;
  organizationId: string;
  type: ContentType;
  title: string;
  body: string;
  status: ContentStatus;
  metadata: ContentMetadata;
  createdBy: string;
  agentId?: string;
  campaignId?: string;
  versions: ContentVersion[];
  createdAt: Date;
  updatedAt: Date;
}

export type ContentType =
  | 'blog_post'
  | 'email'
  | 'social_post'
  | 'ad_copy'
  | 'landing_page'
  | 'sms'
  | 'push_notification';

export type ContentStatus = 'draft' | 'review' | 'approved' | 'published' | 'archived';

export interface ContentMetadata {
  seoTitle?: string;
  seoDescription?: string;
  keywords?: string[];
  targetAudience?: string;
  channel?: string;
  estimatedReadTime?: number;
  wordCount?: number;
  sentiment?: SentimentScore;
}

export interface ContentVersion {
  id: string;
  contentId: string;
  version: number;
  body: string;
  diff?: string;
  createdBy: string;
  createdAt: Date;
}

export interface SentimentScore {
  positive: number;
  negative: number;
  neutral: number;
  overall: 'positive' | 'negative' | 'neutral';
}

// --- Campaigns ---
export interface Campaign {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  status: CampaignStatus;
  type: CampaignType;
  channels: ChannelConfig[];
  audience: AudienceSegment;
  schedule: CampaignSchedule;
  budget?: BudgetConfig;
  abTest?: ABTestConfig;
  metrics: CampaignMetrics;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CampaignStatus = 'draft' | 'scheduled' | 'active' | 'paused' | 'completed' | 'cancelled';
export type CampaignType = 'email' | 'social' | 'multi_channel' | 'drip' | 'triggered';

export interface ChannelConfig {
  channel: 'email' | 'social' | 'sms' | 'push' | 'web';
  enabled: boolean;
  contentId?: string;
  settings: Record<string, unknown>;
}

export interface AudienceSegment {
  id: string;
  name: string;
  filters: SegmentFilter[];
  estimatedSize: number;
  tags: string[];
}

export interface SegmentFilter {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'not_contains' | 'in' | 'not_in';
  value: string | number | boolean | string[];
}

export interface CampaignSchedule {
  startDate: Date;
  endDate?: Date;
  timezone: string;
  frequency?: 'once' | 'daily' | 'weekly' | 'monthly';
  sendTimes?: string[];
  dripSteps?: DripStep[];
}

export interface DripStep {
  id: string;
  order: number;
  delayDays: number;
  contentId: string;
  condition?: TriggerCondition;
}

export interface TriggerCondition {
  event: string;
  operator: string;
  value: string;
}

export interface BudgetConfig {
  total: number;
  daily?: number;
  currency: string;
  spent: number;
}

export interface ABTestConfig {
  enabled: boolean;
  variants: ABVariant[];
  winnerCriteria: 'open_rate' | 'click_rate' | 'conversion_rate';
  testDurationHours: number;
  trafficSplit: number[];
}

export interface ABVariant {
  id: string;
  name: string;
  contentId: string;
  weight: number;
  metrics: VariantMetrics;
}

export interface VariantMetrics {
  sent: number;
  opens: number;
  clicks: number;
  conversions: number;
}

export interface CampaignMetrics {
  sent: number;
  delivered: number;
  opens: number;
  uniqueOpens: number;
  clicks: number;
  uniqueClicks: number;
  conversions: number;
  bounces: number;
  unsubscribes: number;
  revenue: number;
  openRate: number;
  clickRate: number;
  conversionRate: number;
  bounceRate: number;
}

// --- Analytics ---
export interface AnalyticsEvent {
  id: string;
  organizationId: string;
  sessionId: string;
  visitorId: string;
  event: string;
  properties: Record<string, unknown>;
  page?: string;
  referrer?: string;
  userAgent?: string;
  ip?: string;
  geo?: GeoData;
  timestamp: Date;
}

export interface GeoData {
  country?: string;
  region?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
}

export interface Funnel {
  id: string;
  organizationId: string;
  name: string;
  steps: FunnelStep[];
  createdAt: Date;
}

export interface FunnelStep {
  order: number;
  name: string;
  event: string;
  filters?: SegmentFilter[];
}

export interface FunnelResult {
  funnelId: string;
  steps: FunnelStepResult[];
  overallConversion: number;
  period: { start: Date; end: Date };
}

export interface FunnelStepResult {
  step: FunnelStep;
  entered: number;
  completed: number;
  dropoff: number;
  conversionRate: number;
  avgTimeToNext?: number;
}

export interface DashboardWidget {
  id: string;
  type: 'metric' | 'chart' | 'table' | 'funnel' | 'heatmap';
  title: string;
  query: AnalyticsQuery;
  position: { x: number; y: number; w: number; h: number };
}

export interface AnalyticsQuery {
  event?: string;
  metrics: string[];
  dimensions?: string[];
  filters?: SegmentFilter[];
  period: 'today' | '7d' | '30d' | '90d' | 'custom';
  startDate?: Date;
  endDate?: Date;
  granularity?: 'hour' | 'day' | 'week' | 'month';
}

// --- Agents ---
export interface Agent {
  id: string;
  type: AgentType;
  name: string;
  status: AgentStatus;
  config: AgentConfig;
  capabilities: string[];
  memory: AgentMemory;
  metrics: AgentMetrics;
}

export type AgentType =
  | 'content_writer'
  | 'campaign_manager'
  | 'analytics_analyst'
  | 'seo_optimizer'
  | 'audience_segmenter'
  | 'ab_test_optimizer'
  | 'email_deliverer'
  | 'social_scheduler'
  | 'orchestrator';

export type AgentStatus = 'idle' | 'running' | 'waiting' | 'error' | 'completed';

export interface AgentConfig {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  tools: AgentTool[];
  maxRetries: number;
  timeout: number;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: string;
}

export interface AgentMemory {
  shortTerm: Record<string, unknown>[];
  longTerm: { key: string; value: unknown; relevance: number }[];
  context: string[];
}

export interface AgentMetrics {
  tasksCompleted: number;
  tasksErrored: number;
  avgExecutionTime: number;
  tokensUsed: number;
  lastRunAt?: Date;
}

export interface AgentTask {
  id: string;
  agentId: string;
  type: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  priority: number;
  retries: number;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}

// --- Contacts ---
export interface Contact {
  id: string;
  organizationId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  tags: string[];
  segments: string[];
  properties: Record<string, unknown>;
  subscriptionStatus: 'subscribed' | 'unsubscribed' | 'bounced';
  leadScore: number;
  lastActivityAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// --- API Response ---
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
  pagination?: Pagination;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
