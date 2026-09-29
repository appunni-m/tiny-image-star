import { setTimeout } from "node:timers/promises";

// Playwright's waitForFunction polls the predicate's immediate truthiness;
// returning a Promise can finish with false without polling again.
export async function waitForAsync(page, predicate, argument, { timeout = 10_000, label = "asynchronous browser condition" } = {}) {
  const deadline = Date.now() + timeout;
  do {
    if (await page.evaluate(predicate, argument)) return;
    await setTimeout(25);
  } while (Date.now() < deadline);
  throw new Error(`Timed out after ${timeout} ms waiting for ${label}.`);
}
