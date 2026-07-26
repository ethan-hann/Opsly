/**
 * Lightweight SSE (Server-Sent Events) connection registry.
 *
 * Each authenticated user can hold one open SSE connection. When a server-side
 * action needs to notify a specific user instantly (e.g. ownership transfer),
 * it calls pushEvent() with the target userId.
 *
 * This is an in-memory registry — fine for a single-instance server. If the
 * app ever scales horizontally, replace with a pub/sub broker (Redis, etc.).
 */

import type { Response } from 'express';

type SseConnection = {
  res: Response;
  orgId: string;
};

const connections = new Map<string, SseConnection>();

export function registerSSE(userId: string, orgId: string, res: Response): void {
  // Close any stale connection for this user (e.g. page refresh without clean close)
  const existing = connections.get(userId);
  if (existing) {
    try { existing.res.end(); } catch { /* already closed */ }
  }
  connections.set(userId, { res, orgId });
}

export function unregisterSSE(userId: string): void {
  connections.delete(userId);
}

/**
 * Push an SSE event to a specific user.
 * Silently drops if the user has no open connection.
 */
export function pushEvent(userId: string, event: string, data: unknown = {}): void {
  const connection = connections.get(userId);
  if (!connection) return;
  try {
    connection.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    // Connection died - clean up so the stale entry doesn't linger
    connections.delete(userId);
  }
}

export function broadcastToOrg(orgId: string, event: string, data: unknown = {}): void {
  for (const [userId, connection] of connections.entries()) {
    if (connection.orgId !== orgId) continue;

    try {
      connection.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      // Connection died - clean up so the stale entry doesn't linger
      connections.delete(userId);
    }
  }
}
