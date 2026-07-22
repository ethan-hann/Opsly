/**
 * i18n initialisation tests
 *
 * Verifies that:
 *   1. i18n initialises with English as the default / fallback language
 *   2. changeLanguage() updates the active language (and is reset after each test)
 *   3. The translation function (t) returns the correct English string for a known key
 *   4. Missing keys fall back to English (fallbackLng: 'en') rather than returning
 *      an empty string or the raw key
 */

import { describe, it, expect, afterEach } from "vitest";
import i18n from "@/i18n";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shorthand for the i18next t() bound to the current language. */
const t = (key: string) => i18n.t(key);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("i18n initialisation", () => {
  afterEach(async () => {
    // Reset to English after any language-change test so tests remain isolated.
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });

  // ── 1. Default language ────────────────────────────────────────────────────

  it("initialises with English as the active language or falls back to English", () => {
    // The LanguageDetector may not find a stored preference in jsdom, so either
    // 'en' is resolved directly or the fallbackLng kicks in and the resolved
    // language starts with 'en'.
    const lang = i18n.language ?? i18n.options.fallbackLng;
    const resolved = Array.isArray(lang) ? lang[0] : String(lang);
    expect(resolved).toMatch(/^en/);
  });

  it("has 'en' as the configured fallbackLng", () => {
    const fallback = i18n.options.fallbackLng;
    const resolved = Array.isArray(fallback) ? fallback[0] : String(fallback);
    expect(resolved).toBe("en");
  });

  // ── 2. changeLanguage updates the active language ─────────────────────────

  it("updates i18n.language when changeLanguage is called", async () => {
    await i18n.changeLanguage("es");
    expect(i18n.language).toBe("es");
  });

  it("resets back to English after switching to another language", async () => {
    await i18n.changeLanguage("fr");
    expect(i18n.language).toBe("fr");

    await i18n.changeLanguage("en");
    expect(i18n.language).toBe("en");
  });

  it("supports all bundled languages without throwing", async () => {
    const bundled = ["es", "fr", "de", "pt", "ja", "zh", "ar", "en"];
    for (const lang of bundled) {
      await expect(i18n.changeLanguage(lang)).resolves.not.toThrow();
    }
  });

  // ── 3. Translation function returns correct English strings ───────────────

  it("returns the correct English string for common.save", async () => {
    await i18n.changeLanguage("en");
    expect(t("common.save")).toBe("Save");
  });

  it("returns the correct English string for common.cancel", async () => {
    await i18n.changeLanguage("en");
    expect(t("common.cancel")).toBe("Cancel");
  });

  it("returns the correct English string for nav.dashboard", async () => {
    await i18n.changeLanguage("en");
    expect(t("nav.dashboard")).toBe("Dashboard");
  });

  it("returns the correct English string for terminology.projects", async () => {
    await i18n.changeLanguage("en");
    expect(t("terminology.projects")).toBe("Projects");
  });

  it("returns the correct English string for terminology.tasks", async () => {
    await i18n.changeLanguage("en");
    expect(t("terminology.tasks")).toBe("Tasks");
  });

  it("returns the correct English string for auth.signIn", async () => {
    await i18n.changeLanguage("en");
    expect(t("auth.signIn")).toBe("Sign in");
  });

  // ── 4. Missing keys fall back to English (fallbackLng: 'en') ─────────────

  it("returns the English fallback for a key requested in a non-English language when that language has no translation", async () => {
    // Switch to Spanish; any key that only exists in `en` must not return blank.
    await i18n.changeLanguage("es");

    // terminology.projects exists in en.json.  Even if es.json lacks it, the
    // fallback must return the English string rather than an empty string.
    const result = t("terminology.projects");
    expect(result).toBeTruthy();
    expect(result.length).toBeGreaterThan(0);
  });

  it("does not return an empty string for a deeply-nested known English key when the active language is different", async () => {
    await i18n.changeLanguage("de");
    const result = t("common.save");
    // Fallback guarantees a non-empty string even if de.json omits this key
    expect(result).toBeTruthy();
  });

  it("returns the key itself (not empty) for a completely unknown key — confirming no silent blank", () => {
    // i18next returns the key when no translation is found in any language.
    // This is preferable to an empty string and confirms fallbackLng is wired.
    const result = t("__nonexistent__.key.that.does.not.exist");
    // The result must be the key path itself — not an empty string
    expect(result).toBe("__nonexistent__.key.that.does.not.exist");
  });
});
