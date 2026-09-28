import assert from "node:assert/strict";
import test from "node:test";
import { resizeSelection, rotateSelection, selectionBounds, zoomAtPoint } from "../src/design/geometry.js";

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
