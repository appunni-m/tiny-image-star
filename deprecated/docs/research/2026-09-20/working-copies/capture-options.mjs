// Run from a Tiny Image Star checkout with npm dependencies installed.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.cwd();
const { chromium } = await import(pathToFileURL(resolve(root, 'node_modules/playwright/index.mjs')));
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(root + '/')) throw new Error('outside root');
    const body = await readFile(path);
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' })[extname(path)] ?? 'application/octet-stream');
    res.end(body);
  } catch { res.statusCode = 404; res.end('missing'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
const out = resolve(root, 'docs/research/2026-09-20/working-copies');
try {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator('#empty-story-button').click();
  await page.locator('#story-intro .story-import-options summary').click();
  await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
  await page.locator('#story-intro .story-import-options').evaluate(details => details.scrollIntoView({ block: 'start' }));
  const measurements = await page.locator('#story-intro .story-import-options').evaluate(details => ({
    introOverflow: details.closest('#story-intro').scrollWidth > details.closest('#story-intro').clientWidth,
    width: details.getBoundingClientRect().width,
    targets: [...details.querySelectorAll('summary, label, a')].map(el => ({ text: el.textContent, height: el.getBoundingClientRect().height }))
  }));
  assert.equal(measurements.introOverflow, false);
  assert.ok(measurements.targets.every(target => target.height >= 44));
  await page.screenshot({ path: resolve(out, 'import-options-200-phone.png') });
  await writeFile(resolve(out, 'import-options-phone.json'), JSON.stringify(measurements, null, 2) + '\n');
  console.log(JSON.stringify(measurements));
  await context.close();
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
