import { useCallback, useEffect, useState } from 'react';

/**
 * Authenticated user.  Mirrors the AuthUser shape generated in
 * @workspace/api-client-react so consumers can use either import.
 * Defined here to avoid a build-time dependency on the generated client.
 */
export interface AuthUser {
  /** Unique user ID from the OIDC provider (`sub` claim). */
  id: string;
  /** User's email address. May be null if the provider did not supply one. */
  email: string | null;
  /** User's given name. Null if not provided by the OIDC provider. */
  firstName: string | null;
  /** User's family name. Null if not provided by the OIDC provider. */
  lastName: string | null;
  /** URL of the user's profile picture. Null if not provided. */
  profileImageUrl: string | null;
}

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: () => void;
  logout: () => void;
}

function getBasePath() {
  return import.meta.env.BASE_URL.replace(/\/+$/, '') || '/';
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/auth/user', { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ user: AuthUser | null }>;
      })
      .then((data) => {
        if (!cancelled) {
          setUser(data.user ?? null);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null);
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(() => {
    const base = getBasePath();
    window.location.href = `/api/login?returnTo=${encodeURIComponent(base)}`;
  }, []);

  const logout = useCallback(() => {
    const base = getBasePath();
    window.location.href = `/api/logout?returnTo=${encodeURIComponent(base)}`;
  }, []);

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    logout,
  };
}
