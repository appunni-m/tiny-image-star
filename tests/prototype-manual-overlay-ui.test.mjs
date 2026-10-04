import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('prototype composer exposes manual overlay placement relative to the trigger', () => {
  assert.match(main, /\['manual', 'Manual'\]/);
  assert.match(main, /\['center', 'Center'\], \['top-left', 'Top left'\], \['top-center', 'Top center'\], \['top-right', 'Top right'\]/);
  assert.match(main, /\['bottom-left', 'Bottom left'\], \['bottom-center', 'Bottom center'\], \['bottom-right', 'Bottom right'\]/);
  assert.match(main, /Legacy · /,
    'previously saved non-Figma side-center positions should remain editable without appearing for new overlays');
  assert.match(main, /Offset from trigger \(px\)/);
  assert.match(main, /id="prototype-overlay-offset-x"/);
  assert.match(main, /id="prototype-overlay-offset-y"/);
  assert.match(main, /Position is relative to the layer that opens this overlay/);
  assert.match(main, /overlayRelativePosition: \{ \.\.\.state\.prototypeOverlayRelativePosition \}/);
  assert.match(main, /event\.target\.id === 'prototype-overlay-offset-x'/);
  assert.match(main, /event\.target\.id === 'prototype-overlay-offset-y'/);
  assert.match(styles, /\.prototype-overlay-manual-position input \{ min-height: 44px; \}/,
    'manual offset controls should remain touch-sized on phones');
});

test('presentation positions manual overlays from their trigger origin and current scroll state', () => {
  assert.match(main, /presentationNodePageOrigin\(screenEntry\.page, overlayState\.anchorId, runtimeDocument, presentRenderState\.presentationScrollOffsets\)/);
  assert.match(main, /Object\.assign\(displayOverlay, prototypeOverlayPositionInFrame\(/,
    'presentation should use the shared overlay placement helper');
  assert.match(main, /manualAnchorPoint, overlayState\.relativePosition/,
    'manual placement should use the computed trigger origin and its saved offset');
  assert.match(main, /applyPrototypeInteraction\(runtimeDocument, state\.presenting, interaction, \{ sourceNodeId: sourceNode\?\.id \|\| null \}\)/);
});
