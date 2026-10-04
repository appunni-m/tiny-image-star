import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const smokeSource = readFileSync(new URL('./canvas-interaction-smoke.mjs', import.meta.url), 'utf8');

test('canvas interaction smoke waits for a design switch before direct star-handle input', () => {
  assert.match(mainSource, /function onCanvasPointerDown\(event\) \{\s*if \(state\.documentTransitioning\) return;/,
    'canvas pointer-down is intentionally ignored during a design transition');

  const readyWait = smokeSource.indexOf("app.querySelector('.workspace')?.inert === false, 'local design open and editable'");
  const starPointerDown = smokeSource.indexOf("pointer(app, 'pointerdown', pointStart, 104);");
  assert.ok(readyWait >= 0, 'the opened-design wait observes when canvas editing is unblocked');
  assert.ok(starPointerDown > readyWait, 'the direct star point-count gesture starts after the readiness gate');
});
