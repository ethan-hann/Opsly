import { enUS, es, fr, de, pt, ja, zhCN, ar, type Locale } from "date-fns/locale";
import { useTranslation } from "react-i18next";

/**
 * Shared date-fns locale map keyed by i18n language code.
 * Import this constant wherever formatDistanceToNow / formatRelative / etc.
 * need a date-fns Locale object.
 */
export const DATE_FNS_LOCALE_MAP: Record<string, Locale> = {
  en: enUS,
  es,
  fr,
  de,
  pt,
  ja,
  zh: zhCN,
  ar,
};

/**
 * Returns the date-fns Locale that matches the currently active i18n language.
 * Falls back to the language root (e.g. "zh-TW" → "zh") and then to enUS.
 */
export function useDateLocale(): Locale {
  const { i18n } = useTranslation();
  return (
    DATE_FNS_LOCALE_MAP[i18n.language] ??
    DATE_FNS_LOCALE_MAP[i18n.language?.split("-")[0]] ??
    enUS
  );
}
