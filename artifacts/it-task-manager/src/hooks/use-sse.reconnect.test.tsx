import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { SseProvider } from "./use-sse";

// We need to mock import.meta.env.BASE_URL before importing the module.
// Vitest handles this via the globals set in test-setup.

/**
 * Minimal mock EventSource that records construction calls and exposes
 * the onerror handler so we can simulate connection failures.
 */
class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;
  withCredentials: boolean;
  onerror: ((e: Event) => void) | null = null;
  closed = false;

  constructor(url: string, init?: EventSourceInit) {
    this.url = url;
    this.withCredentials = init?.withCredentials ?? false;
    MockEventSource.instances.push(this);
  }

  addEventListener(_type: string, _listener: EventListenerOrEventListenerObject) {}

  close() {
    this.closed = true;
  }
}

describe("SseProvider — reconnect on online event", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("constructs a new EventSource immediately when the online event fires without waiting for the 5s retry timer", async () => {
    vi.useFakeTimers();

    render(
      <SseProvider>
        <div />
      </SseProvider>,
    );

    // Initial connection
    expect(MockEventSource.instances.length).toBe(1);

    // Simulate a connection error — this would normally schedule a 5 s retry.
    const firstInstance = MockEventSource.instances[0];
    act(() => {
      firstInstance.onerror?.(new Event("error"));
    });

    // At this point there's a pending 5 s timer; do NOT advance it.
    expect(MockEventSource.instances.length).toBe(1); // no new connection yet

    // Fire the online event — should bypass the timer and reconnect immediately.
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    // A fresh EventSource should have been created immediately.
    expect(MockEventSource.instances.length).toBeGreaterThanOrEqual(2);
  });

  it("connects immediately on mount (baseline)", () => {
    render(
      <SseProvider>
        <div />
      </SseProvider>,
    );

    expect(MockEventSource.instances.length).toBe(1);
    expect(MockEventSource.instances[0].url).toContain("/api/events");
  });
});
