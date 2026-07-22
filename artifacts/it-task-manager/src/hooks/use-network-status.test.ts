import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useNetworkStatus } from "./use-network-status";

describe("useNetworkStatus", () => {
  beforeEach(() => {
    // Default to online
    Object.defineProperty(navigator, "onLine", {
      writable: true,
      value: true,
    });
  });

  it("returns isOnline: true initially when navigator.onLine is true", () => {
    Object.defineProperty(navigator, "onLine", { writable: true, value: true });
    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current.isOnline).toBe(true);
    expect(result.current.isOffline).toBe(false);
  });

  it("returns isOffline: true when navigator.onLine starts false", () => {
    Object.defineProperty(navigator, "onLine", { writable: true, value: false });
    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current.isOnline).toBe(false);
    expect(result.current.isOffline).toBe(true);
  });

  it("flips to isOffline: true when the offline event fires", () => {
    Object.defineProperty(navigator, "onLine", { writable: true, value: true });
    const { result } = renderHook(() => useNetworkStatus());

    expect(result.current.isOnline).toBe(true);

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    expect(result.current.isOnline).toBe(false);
    expect(result.current.isOffline).toBe(true);
  });

  it("recovers to isOnline: true when the online event fires", () => {
    Object.defineProperty(navigator, "onLine", { writable: true, value: false });
    const { result } = renderHook(() => useNetworkStatus());

    expect(result.current.isOffline).toBe(true);

    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    expect(result.current.isOnline).toBe(true);
    expect(result.current.isOffline).toBe(false);
  });

  it("removes event listeners on unmount", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(() => useNetworkStatus());
    unmount();

    expect(addSpy).toHaveBeenCalledWith("online", expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith("offline", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("online", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("offline", expect.any(Function));
  });
});
