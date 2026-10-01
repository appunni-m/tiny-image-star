// Apply the saved appearance before the stylesheet paints, avoiding a light
// flash when the browser or user's saved choice is dark.
(() => {
  const key = 'tiny-image-star:theme';
  let preference = 'system';
  try {
    const saved = localStorage.getItem(key);
    if (saved === 'light' || saved === 'dark') preference = saved;
  } catch { /* Use the browser preference when local storage is unavailable. */ }

  let systemPrefersDark = false;
  try { systemPrefersDark = Boolean(matchMedia('(prefers-color-scheme: dark)').matches); }
  catch { /* Default to light when the browser does not expose color-scheme preferences. */ }
  const theme = preference === 'system' ? (systemPrefersDark ? 'dark' : 'light') : preference;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = theme === 'dark' ? '#1b1d22' : '#ffffff';
})();
