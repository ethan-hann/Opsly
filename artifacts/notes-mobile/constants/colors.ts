/**
 * Precision Terminal design tokens — synced from the web artifact's index.css.
 *
 * Light theme: Slate & Teal (HSL source)
 *   background  210 40% 98%  → #F7FAFC
 *   foreground  222 47% 11%  → #0F1729
 *   primary     175 75% 35%  → #0E9B8A
 *   card        0   0%  100% → #FFFFFF
 *   border      214 32% 91%  → #D9E4EF
 *
 * Dark theme: Deep Slate & Bright Teal (HSL source)
 *   background  222 47%  6%  → #0D1117
 *   foreground  210 40% 98%  → #F4F8FF
 *   primary     175 75% 45%  → #1CC9B8
 *   card        222 47%  9%  → #131D2E
 *   border      217 32% 17%  → #1E2D42
 */

const colors = {
  light: {
    text: '#0F1729',
    tint: '#0E9B8A',
    background: '#F7FAFC',
    foreground: '#0F1729',
    card: '#FFFFFF',
    cardForeground: '#0F1729',
    primary: '#0E9B8A',
    primaryForeground: '#FFFFFF',
    secondary: '#D9E4EF',
    secondaryForeground: '#0F1729',
    muted: '#EEF3F9',
    mutedForeground: '#64748B',
    accent: '#EEF3F9',
    accentForeground: '#0F1729',
    destructive: '#EF4444',
    destructiveForeground: '#FFFFFF',
    border: '#D9E4EF',
    input: '#D9E4EF',
  },

  dark: {
    text: '#F4F8FF',
    tint: '#1CC9B8',
    background: '#0D1117',
    foreground: '#F4F8FF',
    card: '#131D2E',
    cardForeground: '#F4F8FF',
    primary: '#1CC9B8',
    primaryForeground: '#0F1729',
    secondary: '#1B2B40',
    secondaryForeground: '#F4F8FF',
    muted: '#1B2B40',
    mutedForeground: '#94A3B8',
    accent: '#1B2B40',
    accentForeground: '#F4F8FF',
    destructive: '#C0392B',
    destructiveForeground: '#F4F8FF',
    border: '#1E2D42',
    input: '#1E2D42',
  },

  radius: 8,
};

export default colors;
