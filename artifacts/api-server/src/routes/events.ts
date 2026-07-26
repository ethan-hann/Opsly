/**
 * GET /events — SSE stream for real-time push notifications.
 *
 * Authenticated clients connect here and receive named events (e.g.
 * `role-changed`) pushed by server-side actions without polling.
 */

import { Router, type IRouter } from 'express';
import { requireOrg } from '../middlewares/requireOrgMiddleware';
import { registerSSE, unregisterSSE } from '../lib/sse';

const router: IRouter = Router();

router.get('/events', requireOrg, (req, res) => {
  const userId = req.user!.id;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // Disable response buffering so events are flushed immediately
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  registerSSE(userId, req.orgId!, res);

  // Send a comment-style heartbeat every 25 s to keep proxies from timing out
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unregisterSSE(userId);
  });
});

export default router;
