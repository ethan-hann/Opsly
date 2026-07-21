import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { useGetMyOrg } from '@workspace/api-client-react';
import { useOrgContext } from '@/hooks/use-org-context';

// ─── Color math ───────────────────────────────────────────────────────────────

interface HSL { h: number; s: number; l: number }

/** Parse a 6-digit hex string to HSL components (0-360, 0-100, 0-100). */
function hexToHsl(hex: string): HSL {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;

  let h = 0, s = 0;
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r: h = ((g - b) / delta + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / delta + 2) / 6; break;
      case b: h = ((r - g) / delta + 4) / 6; break;
    }
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/** Format HSL for use as a CSS custom property value (no wrapper). */
function hsl(h: number, s: number, l: number) {
  return `${h} ${s}% ${l}%`;
}

/**
 * Derive a full Material-Design-style palette from one hex color for both
 * light and dark modes. We keep the hue (and roughly the saturation) from the
 * user's pick but assign each semantic slot an appropriate lightness so that
 * every surface stays readable in both themes.
 */
export function derivePalette(hex: string) {
  const { h, s } = hexToHsl(hex);

  // Clamp saturation: desaturated colours look washed-out; hyper-saturated
  // neons bleed. Keep between 55 % and 95 %.
  const sat = Math.max(55, Math.min(s, 95));
  // Softer saturation for accent/hover surfaces
  const satMuted = Math.round(sat * 0.55);

  // ── Light mode ──────────────────────────────────────────────────────────────
  // Primary: keep lightness in 38-52 % so it's readable on white.
  const lightPrimaryL = Math.max(38, Math.min(52, hexToHsl(hex).l));
  // On a ~45 % L primary the W3C contrast against white is good with white fg.
  const lightPrimaryFg = hsl(0, 0, 100);      // white
  const lightAccentL   = 93;                   // very light tint for hover/active bg
  const lightAccentFgL = 11;                   // near-black text on light accent

  // ── Dark mode ───────────────────────────────────────────────────────────────
  // Primary: boost to 58-68 % so it pops on a near-black canvas.
  const darkPrimaryL  = Math.max(58, Math.min(68, hexToHsl(hex).l + 12));
  // A bright primary (L≥55) sits comfortably with dark text.
  const darkPrimaryFg = hsl(220, 14, 10);      // near-black
  const darkAccentL   = 20;                    // dark tint for hover/active bg
  const darkAccentFgL = 96;                    // near-white text on dark accent

  return {
    light: {
      primary:                   hsl(h, sat, lightPrimaryL),
      primaryForeground:         lightPrimaryFg,
      accent:                    hsl(h, satMuted, lightAccentL),
      accentForeground:          hsl(20, 14, lightAccentFgL),
      ring:                      hsl(h, sat, lightPrimaryL),
      sidebarPrimary:            hsl(h, sat, lightPrimaryL),
      sidebarPrimaryForeground:  lightPrimaryFg,
      sidebarAccent:             hsl(h, satMuted, lightAccentL),
      sidebarAccentForeground:   hsl(20, 14, lightAccentFgL),
      sidebarRing:               hsl(h, sat, lightPrimaryL),
    },
    dark: {
      primary:                   hsl(h, sat, darkPrimaryL),
      primaryForeground:         darkPrimaryFg,
      accent:                    hsl(h, satMuted, darkAccentL),
      accentForeground:          hsl(60, 9, darkAccentFgL),
      ring:                      hsl(h, sat, darkPrimaryL),
      sidebarPrimary:            hsl(h, sat, darkPrimaryL),
      sidebarPrimaryForeground:  darkPrimaryFg,
      sidebarAccent:             hsl(h, satMuted, darkAccentL),
      sidebarAccentForeground:   hsl(60, 9, darkAccentFgL),
      sidebarRing:               hsl(h, sat, darkPrimaryL),
    },
  };
}

/** Build a complete CSS block that overrides all brand-colour tokens for
 *  both `:root` (light) and `.dark`. */
function buildStyleSheet(hex: string): string {
  const p = derivePalette(hex);
  const { light: L, dark: D } = p;

  return `
:root {
  --primary:                   ${L.primary};
  --primary-foreground:        ${L.primaryForeground};
  --accent:                    ${L.accent};
  --accent-foreground:         ${L.accentForeground};
  --ring:                      ${L.ring};
  --sidebar-primary:           ${L.sidebarPrimary};
  --sidebar-primary-foreground:${L.sidebarPrimaryForeground};
  --sidebar-accent:            ${L.sidebarAccent};
  --sidebar-accent-foreground: ${L.sidebarAccentForeground};
  --sidebar-ring:              ${L.sidebarRing};
}
.dark {
  --primary:                   ${D.primary};
  --primary-foreground:        ${D.primaryForeground};
  --accent:                    ${D.accent};
  --accent-foreground:         ${D.accentForeground};
  --ring:                      ${D.ring};
  --sidebar-primary:           ${D.sidebarPrimary};
  --sidebar-primary-foreground:${D.sidebarPrimaryForeground};
  --sidebar-accent:            ${D.sidebarAccent};
  --sidebar-accent-foreground: ${D.sidebarAccentForeground};
  --sidebar-ring:              ${D.sidebarRing};
}
`.trim();
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface BrandingContextValue {
  primaryColor: string | null;
  logoUrl: string | null;
}

const BrandingContext = createContext<BrandingContextValue>({
  primaryColor: null,
  logoUrl: null,
});

// ─── Provider ─────────────────────────────────────────────────────────────────

const STYLE_TAG_ID = 'opsly-branding-overrides';

export function BrandingProvider({ children }: { children: ReactNode }) {
  const { data } = useGetMyOrg();
  const { isFeatureEnabled } = useOrgContext();
  const brandingEnabled = isFeatureEnabled('branding');

  const primaryColor = data?.org?.primaryColor ?? null;
  const logoUrl = data?.org?.logoUrl ?? null;

  const styleRef = useRef<HTMLStyleElement | null>(null);

  useEffect(() => {
    // Remove any previously injected style tag
    const existing = document.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null;

    if (!brandingEnabled || !primaryColor || !/^#[0-9a-fA-F]{6}$/.test(primaryColor)) {
      // Clear branding — remove tag if it exists
      if (existing) existing.remove();
      styleRef.current = null;
      return;
    }

    // Build the full palette CSS
    const css = buildStyleSheet(primaryColor);

    if (existing) {
      // Update in-place to avoid FOUC
      existing.textContent = css;
      styleRef.current = existing;
    } else {
      const tag = document.createElement('style');
      tag.id = STYLE_TAG_ID;
      tag.textContent = css;
      document.head.appendChild(tag);
      styleRef.current = tag;
    }

    return () => {
      // Cleanup on unmount (org switch or logout)
      styleRef.current?.remove();
      styleRef.current = null;
    };
  }, [primaryColor, brandingEnabled]);

  return (
    <BrandingContext.Provider value={{ primaryColor: brandingEnabled ? primaryColor : null, logoUrl: brandingEnabled ? logoUrl : null }}>
      {children}
    </BrandingContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

// eslint-disable-next-line react-refresh/only-export-components
export function useBranding(): BrandingContextValue {
  return useContext(BrandingContext);
}
