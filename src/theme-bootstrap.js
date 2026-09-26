// Loaded before the stylesheet to apply a saved preference without a flash.
(() => {
  const key = "tiny-image-star.appearance.v1";
  const choices = new Set(["system", "light", "dark"]);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  let preference = "system";
  try { const saved = localStorage.getItem(key); if (choices.has(saved)) preference = saved; } catch { /* Storage is optional. */ }
  function apply() {
    const theme = preference === "system" ? media.matches ? "dark" : "light" : preference;
    document.documentElement.dataset.appearance = preference;
    document.documentElement.dataset.theme = theme;
    const select = document.getElementById("appearance-select");
    if (select) select.value = preference;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#19181c" : "#f7f5f1");
  }
  apply();
  document.addEventListener("DOMContentLoaded", apply, { once: true });
  media.addEventListener("change", () => { if (preference === "system") apply(); });
  document.addEventListener("change", (event) => {
    if (event.target?.id !== "appearance-select" || !choices.has(event.target.value)) return;
    preference = event.target.value;
    try { localStorage.setItem(key, preference); } catch { /* Keep the current tab usable. */ }
    apply();
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== key && event.key !== null) return;
    preference = choices.has(event.newValue) ? event.newValue : "system";
    apply();
  });
})();
