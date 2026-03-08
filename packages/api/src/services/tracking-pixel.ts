import { Router, Request, Response } from 'express';
import { query } from '../db/pool.js';

const router = Router();

// 1x1 transparent GIF
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/**
 * Email open tracking pixel
 * GET /t/o/:sendId
 */
router.get('/o/:sendId', async (req: Request, res: Response) => {
  const { sendId } = req.params;

  // Fire and forget - don't block the pixel response
  query(
    `UPDATE campaign_sends SET status = 'opened', opened_at = COALESCE(opened_at, NOW())
     WHERE id = $1 AND status IN ('sent', 'delivered')`,
    [sendId]
  ).catch(() => {});

  res.writeHead(200, {
    'Content-Type': 'image/gif',
    'Content-Length': PIXEL.length,
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    'Pragma': 'no-cache',
    'Expires': '0',
  });
  res.end(PIXEL);
});

/**
 * Click tracking redirect
 * GET /t/c/:sendId?url=...
 */
router.get('/c/:sendId', async (req: Request, res: Response) => {
  const { sendId } = req.params;
  const targetUrl = req.query.url as string;

  if (!targetUrl) {
    res.status(400).send('Missing URL');
    return;
  }

  // Update click status
  query(
    `UPDATE campaign_sends SET status = 'clicked', clicked_at = COALESCE(clicked_at, NOW())
     WHERE id = $1`,
    [sendId]
  ).catch(() => {});

  // Track as analytics event too
  const sendResult = await query(
    'SELECT campaign_id, contact_id FROM campaign_sends WHERE id = $1',
    [sendId]
  );

  if (sendResult.rows.length > 0) {
    const send = sendResult.rows[0];
    query(
      `INSERT INTO analytics_events (organization_id, session_id, visitor_id, event, properties, page)
       SELECT c.organization_id, $2, co.email, 'email_click', $3, $4
       FROM campaigns c JOIN contacts co ON co.id = $5
       WHERE c.id = $6`,
      [
        sendId,
        `email_${sendId}`,
        JSON.stringify({ campaignId: send.campaign_id, url: targetUrl }),
        targetUrl,
        send.contact_id,
        send.campaign_id,
      ]
    ).catch(() => {});
  }

  res.redirect(302, targetUrl);
});

/**
 * Unsubscribe handler
 * GET /t/u/:sendId
 */
router.get('/u/:sendId', async (req: Request, res: Response) => {
  const { sendId } = req.params;

  const sendResult = await query(
    'SELECT contact_id FROM campaign_sends WHERE id = $1',
    [sendId]
  );

  if (sendResult.rows.length > 0) {
    await query(
      "UPDATE contacts SET subscription_status = 'unsubscribed' WHERE id = $1",
      [sendResult.rows[0].contact_id]
    );
  }

  res.send(`
    <html>
      <body style="font-family: sans-serif; text-align: center; padding: 50px;">
        <h2>You've been unsubscribed</h2>
        <p>You will no longer receive marketing emails from us.</p>
      </body>
    </html>
  `);
});

export default router;
