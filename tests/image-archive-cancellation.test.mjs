import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

test('Escape removes a queued Pillow render from the active image archive export', () => {
  const start = main.indexOf('async function exportImageSelectionArchive(');
  const end = main.indexOf('\nfunction updateLayoutGuide(', start);
  assert.ok(start >= 0 && end > start, 'expected the image archive export implementation');
  const archiveExport = main.slice(start, end);

  assert.match(archiveExport, /const queueKey = `image-archive:\$\{generation\}:\$\{createId\('image-export'\)\}`/,
    'each archive run should own a distinct queue key');
  assert.match(archiveExport, /controller\.signal\.addEventListener\('abort',\s*\(\) => imageEngine\.cancelQueuedByKey\(queueKey\),\s*\{ once: true \}\)/,
    'aborting an archive should remove its not-yet-started Pillow render');
  assert.match(archiveExport, /refreshImages: false,[\s\S]*?replaceKey: queueKey/,
    'the serialized archive render must be registered under the same cancellable key');
});
