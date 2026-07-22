/**
 * Tests for the offline-queue interception built into customFetch.
 *
 * customFetch catches TypeError ("Failed to fetch") on non-GET/HEAD requests
 * and routes them to the registered offline queue handler instead of throwing,
 * so React Query mutations do not surface an error while the device is offline.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  customFetch,
  setOfflineQueueHandler,
  setBaseUrl,
} from "@workspace/api-client-react";
import type { OfflineQueueEntry } from "@workspace/api-client-react";

describe("customFetch offline interception", () => {
  const addToQueue = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    // Register the offline queue handler.
    setOfflineQueueHandler(addToQueue);
    // Ensure no base URL interferes with the URL assertions.
    setBaseUrl(null);
  });

  afterEach(() => {
    // Clean up: remove handler and fetch stub.
    setOfflineQueueHandler(null);
    vi.restoreAllMocks();
  });

  it("a POST that throws TypeError calls addToQueue with the correct method/URL/body and does not rethrow", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const body = JSON.stringify({ title: "New Task" });
    const result = await customFetch("/api/tasks", {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
    });

    expect(addToQueue).toHaveBeenCalledWith(
      expect.objectContaining<Partial<OfflineQueueEntry>>({
        method: "POST",
        url: "/api/tasks",
        body,
      }),
    );
    // Returns undefined (sentinel) instead of throwing.
    expect(result).toBeUndefined();
  });

  it("a GET that throws TypeError is NOT queued and rethrows", async () => {
    const err = new TypeError("Failed to fetch");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(err));

    await expect(customFetch("/api/tasks", { method: "GET" })).rejects.toThrow(TypeError);
    expect(addToQueue).not.toHaveBeenCalled();
  });

  it("a HEAD that throws TypeError is NOT queued", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(customFetch("/api/health", { method: "HEAD" })).rejects.toThrow(TypeError);
    expect(addToQueue).not.toHaveBeenCalled();
  });

  it("a non-network error (non-TypeError, e.g. a custom error with status 422) is NOT queued and rethrows", async () => {
    class ApiLikeError extends Error {
      status = 422;
      constructor() {
        super("Unprocessable Entity");
        this.name = "ApiLikeError";
      }
    }
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new ApiLikeError()));

    await expect(
      customFetch("/api/tasks", { method: "POST", body: "{}" }),
    ).rejects.toThrow("Unprocessable Entity");
    expect(addToQueue).not.toHaveBeenCalled();
  });

  it("a successful POST passes through without queuing", async () => {
    const payload = { id: "1", title: "Task" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const result = await customFetch("/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "Task" }),
    });

    expect(result).toEqual(payload);
    expect(addToQueue).not.toHaveBeenCalled();
  });

  it("a PATCH that throws TypeError calls addToQueue and does not rethrow", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const result = await customFetch("/api/tasks/42", {
      method: "PATCH",
      body: '{"status":"closed"}',
    });

    expect(addToQueue).toHaveBeenCalledWith(
      expect.objectContaining({ method: "PATCH", url: "/api/tasks/42" }),
    );
    expect(result).toBeUndefined();
  });

  it("with no handler registered, TypeError is rethrown even for POST", async () => {
    setOfflineQueueHandler(null);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(
      customFetch("/api/tasks", { method: "POST", body: "{}" }),
    ).rejects.toThrow(TypeError);
  });
});
