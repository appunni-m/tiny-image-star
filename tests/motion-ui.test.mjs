import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const renderer = await readFile(new URL('../src/renderer.js', import.meta.url), 'utf8');
const timeline = await readFile(new URL('../src/motion-timeline.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('Motion is a keyboard-accessible inspector tab with a duration, playhead, and track editor', () => {
  assert.match(html, /id="inspector-tab-motion"[^>]*data-inspector-tab="motion"[^>]*role="tab"[^>]*aria-controls="inspector-content"/);
  assert.match(main, /if \(state\.inspectorTab === 'motion'\) \{ refreshMotionPreview\(\); content\.innerHTML = motionInspector\(\); return; \}/);
  assert.match(main, /id="motion-playhead" type="range"[^>]*aria-label="Motion timeline playhead"/);
  assert.match(main, /id="motion-duration" type="number"[^>]*aria-label="Motion duration in milliseconds"/);
  assert.match(main, /data-motion-action="add-track"/);
  assert.match(main, /data-motion-action="add-keyframe"/);
  assert.match(main, /width: 'Width', height: 'Height'/);
  assert.match(main, /fillColor: 'Solid fill color', fillOpacity: 'Solid fill opacity'/);
  assert.match(main, /type="color" value="\$\{escapeHtml\(frame\.value\)\}" data-motion-field="value"/);
  assert.match(main, /data-motion-field="easing"/);
});

test('motion playback samples transient renderer overrides without mutating authored layer geometry', () => {
  assert.match(main, /motionSampler\(state\.motionPlayheadMs\)/);
  assert.match(main, /state\.motionPreview = preview\.size \? preview : null/);
  assert.match(renderer, /\.\.\.\(!resolvedMotion \? getNodeGeometry\(document, node\) : \{\}\),\s*\.\.\.\(!resolvedMotion && node\.textPath \? \{ textPath: getNodeTextPath\(document, node\) \} : \{\}\),\s*\.\.\.\(!resolvedMotion \? motionValues \|\| \{\} : \{\}\)/,
    'linked text geometry refreshes before motion values, while isolated paint re-entry retains its resolved root');
  assert.match(renderer, /state\.motionPreview\?\.get\(node\.id\)/);
  assert.match(main, /includeSlices: false, ignoreMotionPreview: true/);
  assert.match(main, /Motion preview is read-only\. Select a layer from the Layers panel/);
  assert.match(main, /Track values preview on the canvas; the saved layer values stay unchanged\./);
});

test('motion controls remain usable on phone widths and follow the selected color theme', () => {
  assert.match(css, /\.motion-playback-controls input\[type="range"\] \{[^}]*accent-color: var\(--blue\)/);
  const phoneInspectorLayout = css.slice(css.lastIndexOf('/* Keep the edited artwork visible above the phone properties sheet. */'));
  assert.match(phoneInspectorLayout, /\.right-panel\s*\{[^}]*height:\s*min\(50dvh,\s*500px\)/);
  assert.match(phoneInspectorLayout, /\.mobile-scrim\.is-visible\s*\{[^}]*bottom:\s*min\(50dvh,\s*500px\)/);
  assert.match(css, /@media \(max-width: 820px\) and \(pointer: coarse\)[\s\S]*?\.motion-keyframe-row label input, \.motion-keyframe-row label select \{[^}]*min-height: 44px/);
  assert.match(css, /:root\[data-theme="dark"\] \.motion-keyframe-row label input,[\s\S]*background: #30333a; color: #e0e4eb/);
});

test('Motion keyframes drag with pointer capture while click and keyboard activation still jump the playhead', () => {
  assert.match(main, /data-motion-action="jump-keyframe" data-track-id="\$\{escapeHtml\(track\.id\)\}" data-keyframe-id="\$\{escapeHtml\(frame\.id\)\}"/);
  assert.match(main, /activate to move the playhead here/);
  assert.match(main, /Drag a marker to change its time; click or tap to move the playhead\./);
  assert.match(main, /if \(action === 'jump-keyframe'\) \{ setMotionPlayhead\(button\.dataset\.timeMs\); return; \}/);
  assert.match(main, /marker\.setPointerCapture\(event\.pointerId\)/);
  assert.match(main, /addEventListener\('pointerdown', beginMotionKeyframeDrag\)/);
  assert.match(main, /addEventListener\('pointermove', updateMotionKeyframeDrag\)/);
  assert.match(main, /addEventListener\('pointerup', finishMotionKeyframeDrag\)/);
  assert.match(main, /addEventListener\('pointercancel', cancelMotionKeyframeDrag\)/);

  const pointerMove = main.match(/function updateMotionKeyframeDrag\(event\) \{([\s\S]*?)\n\}\nfunction releaseMotionKeyframePointer/)?.[1];
  assert.ok(pointerMove, 'pointer move handler should exist');
  assert.doesNotMatch(pointerMove, /\b(?:checkpoint|queueSave|mutateMotion)\s*\(/,
    'pointer movement updates preview only and never writes history or storage');
  const pointerEnd = main.match(/function finishMotionKeyframeDrag\(event\) \{([\s\S]*?)\n\}\nfunction cancelMotionKeyframeDrag/)?.[1];
  assert.ok(pointerEnd, 'pointer end handler should exist');
  assert.equal(pointerEnd.match(/mutateMotion\('Move motion keyframe'/g)?.length, 1,
    'one final motion mutation provides the single undo checkpoint and save');
  const pointerCancel = main.match(/function cancelMotionKeyframeDrag\(event\) \{([\s\S]*?)\n\}\nfunction updateMotionDuration/)?.[1];
  assert.ok(pointerCancel, 'pointer cancellation should restore the preview');
  assert.doesNotMatch(pointerCancel, /\b(?:checkpoint|queueSave|mutateMotion)\s*\(/,
    'cancelled gestures leave motion history and storage untouched');

  assert.match(timeline, /Math\.max\(0, Math\.min\(durationMs, Math\.round\(requestedTimeMs\)\)\)/,
    'pointer time is clamped into the motion duration');
  assert.match(timeline, /occupied\.has\(target\)/,
    'a dragged marker cannot collide with an existing time');
  assert.match(css, /\.motion-keyframe-marker \{[^}]*cursor: grab;[^}]*touch-action: pan-y;/);
});
