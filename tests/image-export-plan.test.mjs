import test from 'node:test';
import assert from 'node:assert/strict';
import { assertImageArchiveFits, planImageArchive } from '../src/image-export-plan.js';

test('image archive plan applies each layer format and quality', () => {
  assert.deepEqual(planImageArchive([
    { id: 'one', type: 'image', name: 'Portrait', outputFormat: 'jpeg', outputQuality: 82 },
    { id: 'two', type: 'image', name: 'Banner', outputFormat: 'webp', outputQuality: 67 },
    { id: 'three', type: 'image', name: 'Icon' }
  ]), [
    { id: 'one', format: 'jpeg', quality: 82, filename: 'Portrait.jpg' },
    { id: 'two', format: 'webp', quality: 67, filename: 'Banner.webp' },
    { id: 'three', format: 'png', quality: 90, filename: 'Icon.png' }
  ]);
});

test('image archive filenames are sanitized, unique without regard to case, and extension-aware', () => {
  assert.deepEqual(planImageArchive([
    { id: 'one', type: 'image', name: 'Cover/Photo', outputFormat: 'png' },
    { id: 'two', type: 'image', name: 'cover-photo', outputFormat: 'png' },
    { id: 'three', type: 'image', name: 'Cover/Photo', outputFormat: 'jpeg' }
  ]).map(item => item.filename), ['Cover-Photo.png', 'cover-photo-2.png', 'Cover-Photo.jpg']);
});

test('image archive planning rejects mixed layers, duplicate IDs, and invalid saved settings', () => {
  assert.throws(() => planImageArchive([
    { id: 'one', type: 'image', name: 'One' },
    { id: 'shape', type: 'rectangle', name: 'Shape' }
  ]), /not a valid image layer/);
  assert.throws(() => planImageArchive([
    { id: 'one', type: 'image', name: 'One' },
    { id: 'one', type: 'image', name: 'One copy' }
  ]), /duplicate layer/);
  assert.throws(() => planImageArchive([
    { id: 'one', type: 'image', name: 'One', outputFormat: 'avif' },
    { id: 'two', type: 'image', name: 'Two' }
  ]), /unsupported output format/);
  assert.throws(() => planImageArchive([
    { id: 'one', type: 'image', name: 'One', outputQuality: 0 },
    { id: 'two', type: 'image', name: 'Two' }
  ]), /invalid output quality/);
});

test('incremental ZIP size guard accounts for exact header overhead at, below, and above the limit without reading blobs', () => {
  const plan = planImageArchive([
    { id: 'one', type: 'image', name: 'Café' },
    { id: 'two', type: 'image', name: 'Second' }
  ]);
  const probe = assertImageArchiveFits(plan, 0, 4096);
  const maxArchiveBytes = probe.headerBytes + 100;
  const unreadableBlob = new Blob([new Uint8Array(99)]);
  unreadableBlob.stream = () => { throw new Error('size guard must not read encoded image data'); };
  assert.deepEqual(assertImageArchiveFits(plan, unreadableBlob.size, maxArchiveBytes), {
    headerBytes: probe.headerBytes,
    outputBytes: 99,
    archiveBytes: maxArchiveBytes - 1
  });
  assert.equal(assertImageArchiveFits(plan, 100, maxArchiveBytes).archiveBytes, maxArchiveBytes);
  assert.throws(() => assertImageArchiveFits(plan, 101, maxArchiveBytes), {
    name: 'RangeError', message: /exceed the .* local limit.*Export fewer images or use smaller source images/
  });
});
