import { useState, useEffect } from "react";

export interface NetworkStatus {
  isOnline: boolean;
  isOffline: boolean;
}

/**
 * Tracks the browser's network connectivity state.
 *
 * Returns `{ isOnline, isOffline }` that update immediately when the
 * `online` / `offline` window events fire.
 */
export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
    }
    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return { isOnline, isOffline: !isOnline };
}
