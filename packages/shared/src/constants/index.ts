export const AGENT_TYPES = [
  'content_writer',
  'campaign_manager',
  'analytics_analyst',
  'seo_optimizer',
  'audience_segmenter',
  'ab_test_optimizer',
  'email_deliverer',
  'social_scheduler',
  'orchestrator',
] as const;

export const CONTENT_TYPES = [
  'blog_post',
  'email',
  'social_post',
  'ad_copy',
  'landing_page',
  'sms',
  'push_notification',
] as const;

export const CHANNELS = ['email', 'social', 'sms', 'push', 'web'] as const;

export const DEFAULT_AGENT_CONFIG = {
  temperature: 0.7,
  maxTokens: 4096,
  maxRetries: 3,
  timeout: 60000,
} as const;

export const RATE_LIMITS = {
  api: { windowMs: 60000, max: 100 },
  auth: { windowMs: 900000, max: 10 },
  tracking: { windowMs: 1000, max: 50 },
} as const;

export const PAGINATION_DEFAULTS = {
  page: 1,
  pageSize: 25,
  maxPageSize: 100,
} as const;
