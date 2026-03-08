import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { logger } from './utils/logger.js';
import { rateLimit } from './middleware/rateLimit.js';
import { healthCheck } from './db/pool.js';
import { createDefaultScheduler } from './services/scheduler.js';
import { RATE_LIMITS } from '@agentmark/shared';

// Routes
import authRoutes from './routes/auth.js';
import contentRoutes from './routes/content.js';
import campaignRoutes from './routes/campaigns.js';
import analyticsRoutes from './routes/analytics.js';
import contactRoutes from './routes/contacts.js';
import agentRoutes from './routes/agents.js';
import trackingPixel from './services/tracking-pixel.js';

const app = express();
const PORT = parseInt(process.env.PORT || '4000');

// --- Global Middleware ---
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// --- Health Check ---
app.get('/health', async (_req, res) => {
  const dbHealthy = await healthCheck();
  const status = dbHealthy ? 200 : 503;
  res.status(status).json({
    status: dbHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    version: '0.1.0',
    services: { database: dbHealthy ? 'up' : 'down' },
  });
});

// --- Tracking endpoints (no auth, high rate limits) ---
app.use('/t', trackingPixel);

// --- API Routes ---
app.use('/api/auth', rateLimit(RATE_LIMITS.auth), authRoutes);
app.use('/api/content', rateLimit(RATE_LIMITS.api), contentRoutes);
app.use('/api/campaigns', rateLimit(RATE_LIMITS.api), campaignRoutes);
app.use('/api/analytics', rateLimit(RATE_LIMITS.tracking), analyticsRoutes);
app.use('/api/contacts', rateLimit(RATE_LIMITS.api), contactRoutes);
app.use('/api/agents', rateLimit(RATE_LIMITS.api), agentRoutes);

// --- Client-side tracking script ---
app.get('/tracker.js', (_req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(getTrackerScript());
});

// --- Error Handler ---
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  });
});

// --- Start Server (skip in serverless environments) ---
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    logger.info({ port: PORT }, 'AgentMark API server started');

    // Start background scheduler
    const scheduler = createDefaultScheduler();
    scheduler.start();

    // Graceful shutdown
    const shutdown = () => {
      logger.info('Shutting down...');
      scheduler.stop();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  });
}

function getTrackerScript(): string {
  return `
(function(w, d) {
  'use strict';

  var API_URL = w.__AM_URL || '';
  var ORG_ID = w.__AM_ORG || '';

  if (!ORG_ID) { console.warn('AgentMark: Missing organization ID'); return; }

  // Generate visitor/session IDs
  function uid() { return Math.random().toString(36).substring(2) + Date.now().toString(36); }
  function getOrSet(key, gen) {
    var v = null;
    try { v = localStorage.getItem('am_' + key); } catch(e) {}
    if (!v) { v = gen(); try { localStorage.setItem('am_' + key, v); } catch(e) {} }
    return v;
  }

  var visitorId = getOrSet('vid', uid);
  var sessionId = uid();

  // Core tracking function
  function track(event, properties) {
    var data = {
      organizationId: ORG_ID,
      sessionId: sessionId,
      visitorId: visitorId,
      event: event,
      properties: properties || {},
      page: w.location.pathname,
      referrer: d.referrer || null,
      timestamp: new Date().toISOString()
    };

    if (navigator.sendBeacon) {
      navigator.sendBeacon(API_URL + '/api/analytics/track', JSON.stringify(data));
    } else {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', API_URL + '/api/analytics/track', true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify(data));
    }
  }

  // Auto-track page views
  track('page_view', { title: d.title, url: w.location.href });

  // Track SPA navigation
  var pushState = history.pushState;
  history.pushState = function() {
    pushState.apply(history, arguments);
    track('page_view', { title: d.title, url: w.location.href });
  };
  w.addEventListener('popstate', function() {
    track('page_view', { title: d.title, url: w.location.href });
  });

  // Auto-track clicks on links
  d.addEventListener('click', function(e) {
    var target = e.target.closest('a');
    if (target && target.href) {
      track('link_click', { url: target.href, text: (target.textContent || '').substring(0, 100) });
    }
  });

  // Track scroll depth
  var maxScroll = 0;
  var scrollThresholds = [25, 50, 75, 100];
  w.addEventListener('scroll', function() {
    var h = d.documentElement;
    var scrollPct = Math.round((w.scrollY / (h.scrollHeight - h.clientHeight)) * 100);
    if (scrollPct > maxScroll) {
      maxScroll = scrollPct;
      for (var i = 0; i < scrollThresholds.length; i++) {
        if (scrollPct >= scrollThresholds[i] && maxScroll - scrollPct < 5) {
          track('scroll_depth', { depth: scrollThresholds[i] });
          scrollThresholds.splice(i, 1);
          break;
        }
      }
    }
  });

  // Track time on page
  var startTime = Date.now();
  w.addEventListener('beforeunload', function() {
    track('page_exit', { timeOnPage: Math.round((Date.now() - startTime) / 1000) });
  });

  // Expose public API
  w.agentmark = { track: track, visitorId: visitorId, sessionId: sessionId };

})(window, document);
`;
}

export default app;
