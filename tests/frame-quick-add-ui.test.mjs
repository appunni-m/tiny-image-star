import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const phoneQuickAddStyles = styles.slice(styles.indexOf('@media (max-width: 820px)'));

test('Frame-tool quick-add exposes touch-sized, named duplicate and blank-frame actions on every side', () => {
  assert.match(html, /id="frame-quick-add-controls"[^>]*role="group"[^>]*hidden/);
  for (const direction of ['top', 'right', 'bottom', 'left']) {
    assert.match(html, new RegExp(`data-frame-quick-add-side="${direction}"`));
    assert.match(html, new RegExp(`data-frame-quick-add-mode="duplicate" data-frame-quick-add-direction="${direction}"`));
    assert.match(html, new RegExp(`data-frame-quick-add-mode="blank" data-frame-quick-add-direction="${direction}"`));
  }
  assert.match(styles, /\.frame-quick-add-controls\[hidden\]\s*\{\s*display:\s*none;/);
  assert.match(phoneQuickAddStyles, /\.frame-quick-add-side button\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/s);
});

test('quick-add is available by frame hover and touch selection and preserves duplicate versus blank behavior', () => {
  assert.match(source, /import \{ planFrameQuickAdd \} from '\.\/frame-quick-add\.js'/);
  assert.match(source, /function syncFrameQuickAddAtPointer\(event\)[\s\S]*?revealFrameQuickAddControls\(entry\)/);
  assert.match(source, /state\.tool === 'frame' && event\.pointerType !== 'mouse'[\s\S]*?revealFrameQuickAddControls\(frameEntry\)/,
    'touch users should be able to tap a frame to reveal the quick-add buttons');
  assert.match(source, /frameQuickAddControls\.addEventListener\('click', event => \{[\s\S]*?event\.target\.closest\('\[data-frame-quick-add-mode\]\[data-frame-quick-add-direction\]'\)/,
    'one delegated handler must own all four sides and both actions');
  assert.match(source, /addFrameBeside\(frameQuickAddControls\.dataset\.frameId, mode, button\.dataset\.frameQuickAddDirection\)/);
  assert.match(source, /planFrameQuickAdd\(sourceGeometry, siblings, \{ mode, direction \}\)/);
  assert.ok(source.includes('controls.querySelector(`[data-frame-quick-add-side="${side.name}"]`)'),
    'each visible control group should be positioned using the transformed frame edge');
  assert.doesNotMatch(source, /#frame-quick-add-duplicate|#frame-quick-add-blank/,
    'startup must not bind the removed single-button IDs');
  assert.match(source, /added = duplicateNode\(state\.document, source\.id, page\.id\)/);
  assert.match(source, /addNode\(state\.document, added, \{[\s\S]*?parentId: sourceEntry\.parent\?\.id \|\| null/);
  assert.match(source, /entry\.parent\?\.autoLayout/,
    'frames controlled by auto layout should not expose absolute-position quick-add');
});
