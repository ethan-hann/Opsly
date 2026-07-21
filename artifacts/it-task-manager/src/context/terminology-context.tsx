import { createContext, useContext } from "react";
import { useGetMyOrg } from "@workspace/api-client-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TermKey = "projects" | "tasks" | "members" | "workflows" | "stages";

/** Default English labels used when no custom term is configured. */
export const TERM_DEFAULTS: Record<TermKey, string> = {
  projects: "Projects",
  tasks: "Tasks",
  members: "Members",
  workflows: "Workflows",
  stages: "Stages",
};

/**
 * Derive a singular form from a plural label.
 * Rules (English-oriented, covers the most common org domain aliases):
 *   "…ies" → "…y"   (Factories → Factory)
 *   "…ses" / "…zes" / "…ches" / "…shes" → strip "es"
 *   "…s"   → strip "s"
 *   otherwise → return as-is  (handles "Staff", "Work Item", etc.)
 */
export function singularize(label: string): string {
  if (label.endsWith("ies")) return label.slice(0, -3) + "y";
  if (/(?:s|z|ch|sh)es$/.test(label)) return label.slice(0, -2);
  if (label.endsWith("s")) return label.slice(0, -1);
  return label;
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface TerminologyContextValue {
  /** Resolve a terminology key to its current plural label (custom or default). */
  t: (key: TermKey) => string;
  /**
   * Resolve a terminology key to a singular label.
   * Uses the admin-set singular override when available; falls back to
   * auto-deriving the singular from the plural via `singularize()`.
   */
  ts: (key: TermKey) => string;
  /**
   * @deprecated Use `ts()` instead.
   * Kept for backward compatibility — resolves to the same value as `ts()`.
   */
  tSingular: (key: TermKey) => string;
  /** The full resolved map of all five keys. */
  terminology: Record<TermKey, string>;
}

const TerminologyContext = createContext<TerminologyContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function TerminologyProvider({ children }: { children: React.ReactNode }) {
  // useGetMyOrg is already called by OrgGuard — React Query returns cached data
  // instantly here so there is no extra network round-trip.
  const { data } = useGetMyOrg();

  const terminology: Record<TermKey, string> = { ...TERM_DEFAULTS };

  const raw = data?.terminology;
  if (raw) {
    (Object.keys(TERM_DEFAULTS) as TermKey[]).forEach((key) => {
      const val = raw[key];
      if (val) terminology[key] = val;
    });
  }

  const t = (key: TermKey): string => terminology[key];

  /**
   * Returns the admin-set singular override for a key when present,
   * falling back to auto-deriving from the plural label via singularize().
   */
  const ts = (key: TermKey): string => {
    const singularKey = `${key}Singular` as keyof typeof raw;
    const override = raw?.[singularKey] as string | undefined;
    return override || singularize(terminology[key]);
  };

  return (
    <TerminologyContext.Provider value={{ t, ts, tSingular: ts, terminology }}>
      {children}
    </TerminologyContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTerminology(): TerminologyContextValue {
  const ctx = useContext(TerminologyContext);
  if (!ctx) throw new Error("useTerminology must be used within TerminologyProvider");
  return ctx;
}
