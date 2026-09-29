import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode, createDocument, createExportSetting, createNode, parseDocument,
  serializeDocument, validateDocument
} from '../src/model.js';

function documentWith(settings) {
  const document = createDocument();
  addNode(document, createNode('rectangle', { exportSettings: structuredClone(settings) }));
  return document;
}

test('export settings default to an editable PNG 1x preset and survive local document round trips', () => {
  const setting = createExportSetting();
  assert.deepEqual({ format: setting.format, scale: setting.scale, suffix: setting.suffix, quality: setting.quality }, {
    format: 'png', scale: 1, suffix: '', quality: 90
  });
  const document = documentWith([createExportSetting({ id: 'retina-webp', format: 'webp', scale: 2, suffix: '@2x', quality: 82 })]);
  const roundTrip = parseDocument(serializeDocument(document));
  assert.deepEqual(roundTrip.pages[0].children[0].exportSettings, document.pages[0].children[0].exportSettings);
});

test('export settings reject malformed format, scale, suffix, quality, duplicate IDs, and excess entries', () => {
  const invalidSettings = [
    [createExportSetting({ format: 'bmp' })],
    [createExportSetting({ scale: 1.25 })],
    [createExportSetting({ suffix: 'x'.repeat(25) })],
    [createExportSetting({ quality: 100.5 })],
    [createExportSetting({ id: 'same' }), createExportSetting({ id: 'same' })],
    Array.from({ length: 9 }, (_, index) => createExportSetting({ id: `export-${index}` }))
  ];
  for (const settings of invalidSettings) assert.throws(() => validateDocument(documentWith(settings)), /Invalid export settings/);
});
