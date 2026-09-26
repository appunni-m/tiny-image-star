import { getProcessingScheduler } from "./client.js";

export function attachProcessingControls() {
  const pool = getProcessingScheduler();
  const controls = [...document.querySelectorAll("#processing-mode-select, #folder-job-performance")];
  const status = document.querySelector("#processing-resource-status");
  for (const control of controls) control.addEventListener("change", () => {
    pool.configure({ mode: control.value });
    for (const other of controls) other.value = pool.mode;
  });
  pool.subscribe((snapshot) => {
    if (!status) return;
    const waiting = snapshot.coordination.waiting ? snapshot.coordination.reason === "memory in other tabs"
      ? " · waiting for memory in another tab" : snapshot.coordination.reason === "CPU in other tabs"
        ? " · sharing capacity with another tab" : " · waiting for processing capacity"
      : snapshot.limitingReason === "memory budget" ? " · waiting for memory" : "";
    status.textContent = snapshot.active || snapshot.queued
      ? `Processing ${snapshot.active} · ${snapshot.queued} waiting${waiting}`
      : "Ready for your next edit";
  });
  // Long tasks are an observed pressure signal, not a thermal/RAM reading.
  // Browsers without this API still enforce the same admission budget.
  if (typeof PerformanceObserver === "function" && PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
    let lastPressure = 0;
    const observer = new PerformanceObserver((list) => {
      if (document.hidden || performance.now() - lastPressure < 5000) return;
      if (list.getEntries().some((entry) => entry.duration > 200)) {
        lastPressure = performance.now();
        pool.pressure();
      }
    });
    observer.observe({ type: "longtask", buffered: false });
  }
}
