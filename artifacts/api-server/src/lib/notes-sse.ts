/**
 * In-process SSE registry for real-time note change notifications.
 *
 * Each connected client is stored by orgId so broadcasts are scoped — one
 * org's changes never wake another org's clients.
 */

import type { Response } from "express";

interface SseClient {
  orgId: string;
  res: Response;
}

const clients = new Set<SseClient>();

/**
 * Register a new SSE client.  Returns a cleanup function that removes the
 * client from the registry; call it when the request closes.
 */
export function addSseClient(orgId: string, res: Response): () => void {
  const client: SseClient = { orgId, res };
  clients.add(client);
  return () => clients.delete(client);
}

/**
 * Broadcast a `notes-changed` event to every client in the given org.
 * Silently drops stale connections that can no longer be written to.
 */
export function broadcastNoteChange(orgId: string): void {
  const payload = `data: ${JSON.stringify({ type: "notes-changed" })}\n\n`;
  for (const client of clients) {
    if (client.orgId !== orgId) continue;
    try {
      client.res.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}
