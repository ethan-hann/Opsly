import { useCallback, useEffect, useState } from 'react';

/**
 * Authenticated user.  Mirrors the AuthUser shape generated in
 * @workspace/api-client-react so consumers can use either import.
 * Defined here to avoid a build-time dependency on the generated client.
 */
export interface AuthUser {
  /** Unique user ID from the configured auth provider. */
  id: string;
  /** User's email address. May be null when not supplied by the provider. */
  email: string | null;
  /** User's given name. Null if not provided. */
  firstName: string | null;
  /** User's family name. Null if not provided. */
  lastName: string | null;
  /** URL of the user's profile picture. Null if not provided. */
  profileImageUrl: string | null;
}

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  authMode: 'replit_oidc' | 'oidc' | 'local';
  loginMethod: 'oidc' | 'password';
  login: (returnTo?: string) => void;
  loginWithPassword: (
    email: string,
    password: string,
    returnTo?: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  logout: () => void;
}

function getBasePath() {
  return import.meta.env.BASE_URL.replace(/\/+$/, '') || '/';
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authMode, setAuthMode] = useState<'replit_oidc' | 'oidc' | 'local'>(
    'replit_oidc',
  );
  const [loginMethod, setLoginMethod] = useState<'oidc' | 'password'>('oidc');

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch('/api/auth/config', { credentials: 'include' }).then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{
          mode: 'replit_oidc' | 'oidc' | 'local';
          loginMethod: 'oidc' | 'password';
        }>;
      }),
      fetch('/api/auth/user', { credentials: 'include' }).then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ user: AuthUser | null }>;
      }),
    ])
      .then(([config, data]) => {
        if (!cancelled) {
          setAuthMode(config.mode);
          setLoginMethod(config.loginMethod);
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

  const login = useCallback((returnTo?: string) => {
    const destination = returnTo ?? getBasePath();
    if (loginMethod === 'password') {
      window.location.href =
        destination === '/'
          ? '/'
          : `/?returnTo=${encodeURIComponent(destination)}`;
      return;
    }

    const base = getBasePath();
    window.location.href = `/api/login?returnTo=${encodeURIComponent(returnTo ?? base)}`;
  }, [loginMethod]);

  const loginWithPassword = useCallback(
    async (email: string, password: string, returnTo?: string) => {
      if (loginMethod !== 'password') {
        return { ok: false as const, error: 'Password login is not enabled.' };
      }

      const response = await fetch('/api/auth/local/login', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ email, password, returnTo }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        return {
          ok: false as const,
          error: payload.error ?? `Login failed (HTTP ${response.status})`,
        };
      }

      const payload = (await response.json()) as { user: AuthUser | null };
      setUser(payload.user ?? null);
      return { ok: true as const };
    },
    [loginMethod],
  );

  const logout = useCallback(() => {
    const base = getBasePath();
    window.location.href = `/api/logout?returnTo=${encodeURIComponent(base)}`;
  }, []);

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    authMode,
    loginMethod,
    login,
    loginWithPassword,
    logout,
  };
}
