import assert from "node:assert/strict";
import test from "node:test";
import { resizeSelection, rotateSelection, selectionBounds, zoomAtPoint } from "../src/design/geometry.js";
import { deleteVectorPoint, insertVectorPoint, vectorSegmentPoint } from "../src/design/vector-path.js";

const size = { width: 1920, height: 1080 };
const nodes = [
  { id: "a", frame: { x: .1, y: .2, width: .2, height: .2 }, rotation: 0 },
  { id: "b", frame: { x: .4, y: .3, width: .1, height: .1 }, rotation: 15 },
];

test("selection bounds convert normalized layer frames to page-space pixels", () => {
  assert.deepEqual(selectionBounds(nodes, size), { x: 192, y: 216, width: 768, height: 216 });
});

test("group resize preserves relative placement and scales every selected frame", () => {
  const bounds = selectionBounds(nodes, size), next = { x: 96, y: 108, width: 1536, height: 432 };
  const [a, b] = resizeSelection(nodes, bounds, next, size);
  assert.deepEqual(a.frame, { x: .05, y: .1, width: .4, height: .4 });
  assert.deepEqual(b.frame, { x: .65, y: .3, width: .2, height: .2 });
  assert.equal(a.rotation, nodes[0].rotation);
  assert.equal(b.rotation, nodes[1].rotation);
});

test("selection rotation moves layer centers and composes normalized layer angles", () => {
  const rotated = rotateSelection(nodes, { x: 576, y: 324 }, 90, size);
  assert.ok(Math.abs(rotated[0].frame.x - .2) < 1e-12);
  assert.ok(Math.abs(rotated[0].frame.y - 24 / 1080) < 1e-12);
  assert.ok(Math.abs(rotated[1].frame.x - 426 / 1920) < 1e-12);
  assert.ok(Math.abs(rotated[1].frame.y - 558 / 1080) < 1e-12);
  assert.equal(rotated[0].rotation, 90);
  assert.equal(rotated[1].rotation, 105);
  const normalized = rotateSelection([{ ...nodes[0], rotation: 350 }], { x: 480, y: 324 }, 20, size);
  assert.equal(normalized[0].rotation, 10);
});

test("zooming at a pointer keeps the same page point under that pointer", () => {
  const geometry = { x: 75, y: 40, scale: .5, width: 1000, height: 600, viewportWidth: 650, viewportHeight: 380 }, pointer = { x: 260, y: 150 };
  const before = { x: (pointer.x - geometry.x) / geometry.scale, y: (pointer.y - geometry.y) / geometry.scale };
  const next = zoomAtPoint({ zoom: 1, nextZoom: 2, panX: 0, panY: 0, point: pointer, geometry });
  const moved = { x: (geometry.viewportWidth - geometry.width * geometry.scale * 2) / 2 + next.panX,
    y: (geometry.viewportHeight - geometry.height * geometry.scale * 2) / 2 + next.panY, scale: geometry.scale * 2 };
  assert.equal((pointer.x - moved.x) / moved.scale, before.x);
  assert.equal((pointer.y - moved.y) / moved.scale, before.y);
});

test("inserting an anchor splits a cubic exactly and deleting respects open and closed path minima", () => {
  const path = { closed: false, points: [
    { x: .08, y: .18, handleOut: { x: .12, y: .94 } },
    { x: .91, y: .82, handleIn: { x: .78, y: .04 } },
    { x: .96, y: .92 },
  ] }, split = .37;
  const inserted = insertVectorPoint(path, 0, split);
  assert.equal(inserted.points.length, 4);
  assert.equal(path.points.length, 3, "splitting is immutable");
  for (const t of [.05, .2, .36, .6, .9]) {
    const originalT = split + (1 - split) * t;
    const original = vectorSegmentPoint(path, 0, originalT), next = vectorSegmentPoint(inserted, 1, t);
    assert.ok(Math.abs(original.x - next.x) < 1e-12 && Math.abs(original.y - next.y) < 1e-12,
      `the second half of the split retains the original curve at ${originalT}`);
  }
  for (const t of [.1, .5, .9]) {
    const original = vectorSegmentPoint(path, 0, split * t), next = vectorSegmentPoint(inserted, 0, t);
    assert.ok(Math.abs(original.x - next.x) < 1e-12 && Math.abs(original.y - next.y) < 1e-12,
      `the first half of the split retains the original curve at ${split * t}`);
  }
  assert.equal(deleteVectorPoint(inserted, 1).points.length, 3);
  assert.throws(() => deleteVectorPoint({ closed: false, points: path.points.slice(0, 2) }, 0), /at least 2 points/);
  assert.throws(() => deleteVectorPoint({ closed: true, points: path.points }, 0), /at least 3 points/);
  assert.throws(() => insertVectorPoint(path, 0, 1), /valid segment/);
});

test("vector anchor insertion handles a closing segment and straight geometry", () => {
  const path = { closed: true, points: [{ x: .15, y: .2 }, { x: .85, y: .2 }, { x: .5, y: .85 }] };
  const inserted = insertVectorPoint(path, 2, .5);
  assert.equal(inserted.points.length, 4);
  const before = vectorSegmentPoint(path, 2, .5), after = inserted.points[3];
  assert.ok(Math.abs(after.x - .325) < 1e-12 && Math.abs(after.y - .525) < 1e-12, "a straight closing edge inserts its midpoint");
  assert.deepEqual(after, before);
  assert.deepEqual(deleteVectorPoint(inserted, 3).points, path.points);
});
