export const THEME_PREFERENCE_KEY = 'tiny-image-star:theme';
export const THEME_PREFERENCES = Object.freeze(['system', 'light', 'dark']);

export function normalizeThemePreference(value) {
  return THEME_PREFERENCES.includes(value) ? value : 'system';
}

export function resolveTheme(preference, systemPrefersDark = false) {
  const normalized = normalizeThemePreference(preference);
  return normalized === 'system' ? (systemPrefersDark ? 'dark' : 'light') : normalized;
}

export function readThemePreference(storage = safeLocalStorage()) {
  try { return normalizeThemePreference(storage?.getItem(THEME_PREFERENCE_KEY)); }
  catch { return 'system'; }
}

function safeLocalStorage() {
  try { return globalThis.localStorage; }
  catch { return null; }
}

export function createThemePreferenceController({
  document = globalThis.document,
  storage = safeLocalStorage(),
  matchMedia = globalThis.matchMedia?.bind(globalThis),
  window = globalThis.window
} = {}) {
  let preference = readThemePreference(storage);
  let mediaQuery = null;
  try { mediaQuery = matchMedia?.('(prefers-color-scheme: dark)') || null; }
  catch { mediaQuery = null; }

  const apply = () => {
    const theme = resolveTheme(preference, Boolean(mediaQuery?.matches));
    const root = document?.documentElement;
    if (root) {
      root.dataset.theme = theme;
      root.style.colorScheme = theme;
    }
    const themeColor = document?.querySelector?.('meta[name="theme-color"]');
    if (themeColor) themeColor.content = theme === 'dark' ? '#1b1d22' : '#ffffff';
    return theme;
  };

  const onMediaChange = () => { if (preference === 'system') apply(); };
  const onStorage = event => {
    if (event?.key !== THEME_PREFERENCE_KEY) return;
    preference = normalizeThemePreference(event.newValue);
    apply();
  };
  mediaQuery?.addEventListener?.('change', onMediaChange);
  if (!mediaQuery?.addEventListener) mediaQuery?.addListener?.(onMediaChange);
  window?.addEventListener?.('storage', onStorage);
  apply();

  return Object.freeze({
    getPreference: () => preference,
    getTheme: () => resolveTheme(preference, Boolean(mediaQuery?.matches)),
    setPreference(value) {
      preference = normalizeThemePreference(value);
      try { storage?.setItem(THEME_PREFERENCE_KEY, preference); } catch { /* Keep the choice for this tab when storage is unavailable. */ }
      apply();
      return preference;
    },
    dispose() {
      mediaQuery?.removeEventListener?.('change', onMediaChange);
      if (!mediaQuery?.removeEventListener) mediaQuery?.removeListener?.(onMediaChange);
      window?.removeEventListener?.('storage', onStorage);
    }
  });
}
