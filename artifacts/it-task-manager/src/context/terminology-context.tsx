import { createContext, useContext } from "react";
import { useGetMyOrg } from "@workspace/api-client-react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TermKey = "projects" | "tasks" | "members" | "workflows" | "stages";

/**
 * Get terminology defaults from i18n translations so the default entity
 * labels ("Projects", "Tasks", etc.) are also translated when no org override
 * is set.
 */
function getTermDefaults(): Record<TermKey, string> {
  return {
    projects: i18n.t("terminology.projects"),
    tasks: i18n.t("terminology.tasks"),
    members: i18n.t("terminology.members"),
    workflows: i18n.t("terminology.workflows"),
    stages: i18n.t("terminology.stages"),
  };
}

/** Fallback English defaults (used as static reference for key shape). */
export const TERM_DEFAULTS: Record<TermKey, string> = {
  projects: "Projects",
  tasks: "Tasks",
  members: "Members",
  workflows: "Workflows",
  stages: "Stages",
};

/**
 * Derive a singular form from a plural label.
 * Only applies for English (where auto-singularization rules are safe).
 * For other locales, returns the plural form unchanged unless an explicit
 * singular override is configured by the org admin.
 *
 * Rules (English-oriented, covers the most common org domain aliases):
 *   "…ies" → "…y"   (Factories → Factory)
 *   "…ses" / "…zes" / "…ches" / "…shes" → strip "es"
 *   "…s"   → strip "s"
 *   otherwise → return as-is  (handles "Staff", "Work Item", etc.)
 */
export function singularize(label: string): string {
  const lang = (i18n.language ?? "en").split("-")[0];
  // Only auto-singularize for English; other locales need explicit overrides
  if (lang !== "en") return label;

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
  // Subscribe to language changes so terminology defaults re-translate when the
  // user switches language. useTranslation triggers a re-render on language change.
  useTranslation();

  // useGetMyOrg is already called by OrgGuard — React Query returns cached data
  // instantly here so there is no extra network round-trip.
  const { data } = useGetMyOrg();

  // Start with i18n-translated defaults
  const terminology: Record<TermKey, string> = { ...getTermDefaults() };

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
