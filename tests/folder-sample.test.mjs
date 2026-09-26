import test from "node:test";
import assert from "node:assert/strict";
import { createFolderSampleSelector, durationLabel, processingEstimate, MAX_FOLDER_SAMPLES } from "../src/jobs/sample-plan.js";

test("folder samples cover format maxima, smallest source and discovery positions without modifying entries", () => {
  const extensions = ["jpg", "png", "gif", "bmp", "webp", "tif", "ico"];
  const selector = createFolderSampleSelector(100000), maxima = new Map();
  for (let index = 0; index < 100000; index++) {
    const extension = extensions[index % extensions.length];
    const entry = Object.freeze({ index, sourceBytes: index + 10, relativePath: `photos/${index}.${extension}` });
    selector.add(entry); maxima.set(extension, index);
  }
  const result = selector.finish(), ids = result.map(entry => entry.index);
  assert.ok(result.length <= MAX_FOLDER_SAMPLES);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...ids].sort((a, b) => a - b), ids);
  for (const index of [0, 49999, 99999, ...maxima.values()]) assert.ok(ids.includes(index), `sample ${index}`);
  result[0].sourceBytes = -1;
  assert.equal(selector.finish()[0].sourceBytes, 10, "caller cannot mutate the selected manifest records");
});

test("JPEG/TIFF aliases share format buckets; ties are deterministic and small sets stay bounded", () => {
  const entries = ["a.JPG", "b.jpeg", "c.tif", "d.TIFF"].map((relativePath, index) => ({ relativePath, index, sourceBytes: 10 }));
  const forward = createFolderSampleSelector(entries.length), reverse = createFolderSampleSelector(entries.length);
  entries.forEach(entry => forward.add(entry)); [...entries].reverse().forEach(entry => reverse.add(entry));
  assert.deepEqual(forward.finish(), reverse.finish());
  assert.deepEqual(createFolderSampleSelector(0).finish(), []);
  for (const total of [-1, 1.5, 100001, Infinity]) assert.throws(() => createFolderSampleSelector(total));
  assert.throws(() => forward.add({ index: 4, sourceBytes: 1, relativePath: "outside.png" }));
});

test("processing estimates require observed completions and useful elapsed time", () => {
  for (const value of [{ elapsedMs: 999, completed: 3, remaining: 100 }, { elapsedMs: 2000, completed: 1, remaining: 100 }, { elapsedMs: Infinity, completed: 3, remaining: 100 }, { elapsedMs: 2000, completed: 3, remaining: 0 }]) assert.equal(processingEstimate(value), null);
  assert.equal(processingEstimate({ elapsedMs: 3000, completed: 3, remaining: 12 }), 12);
  assert.equal(processingEstimate({ elapsedMs: 3000, completed: 6, remaining: 12 }), 6);
  assert.equal(durationLabel(12), "12 seconds");
  assert.equal(durationLabel(61), "2 minutes");
  assert.equal(durationLabel(7200), "2.0 hours");
  assert.equal(durationLabel(Infinity), "unavailable");
});
