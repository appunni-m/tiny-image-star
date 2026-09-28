import test from "node:test";
import assert from "node:assert/strict";
import { createDesignPageProject, renameLayerCommand, reorderLayerCommand, setLayerLockedCommand, setLayerVisibilityCommand,
  snapshotPageSelection, updatePageSelection } from "../src/project/design-page.js";
import { ProjectHistory } from "../src/project/history.js";
import { planScene } from "../src/compositor/scene-spec.js";

const images = (count = 3) => Array.from({ length: count }, (_, index) => ({ id: `asset-${index}`, kind: "image", name: `Photo ${index}.png`,
  type: "image/png", byteLength: 120, sha256: index.toString(16).padStart(64, "0"), width: index % 2 ? 400 : 600, height: index % 2 ? 600 : 400,
  orientation: "upright" }));

test("design page creates independent image layers in bounded non-overlapping canvas slots", () => {
  const project = createDesignPageProject({ images: images(7), id: "design", slideId: "page-one" });
  const page = project.slides[0];
  assert.equal(project.variants[0].width, 1920);
  assert.equal(project.variants[0].height, 1080);
  assert.equal(page.name, "Page 1");
  assert.equal(page.nodeIds.length, 7);
  assert.equal(new Set(page.nodeIds).size, 7);
  for (const nodeId of page.nodeIds) {
    const node = project.nodes[nodeId];
    assert.equal(node.kind, "image");
    assert.equal(node.visible, true);
    assert.equal(node.locked, false);
    assert.ok(node.frame.x >= 0 && node.frame.y >= 0);
    assert.ok(node.frame.x + node.frame.width <= 1 && node.frame.y + node.frame.height <= 1);
    assert.equal(project.assets[node.assetId].kind, "image");
  }
  const frames = page.nodeIds.map((nodeId) => project.nodes[nodeId].frame);
  for (let left = 0; left < frames.length; left++) for (let right = left + 1; right < frames.length; right++) {
    const a = frames[left], b = frames[right];
    assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y,
      "image layers have separate selection targets on the initial canvas");
  }
  assert.equal(planScene(project, page.id, "page").nodes.length, 7);
});

test("layer metadata, visibility, locking and order are reversible page-history commands", () => {
  const project = createDesignPageProject({ images: images(3), id: "design", slideId: "page-one" });
  const [first, second, third] = project.slides[0].nodeIds, history = new ProjectHistory(project);
  history.apply(renameLayerCommand(history.document, first, "Cover photo"), "Rename layer");
  history.apply(setLayerLockedCommand(history.document, second, true), "Lock layer");
  history.apply(setLayerVisibilityCommand(history.document, third, false), "Hide layer");
  history.apply(reorderLayerCommand(history.document, "page-one", third, 0), "Reorder layer");
  assert.equal(history.document.nodes[first].name, "Cover photo");
  assert.equal(history.document.nodes[second].locked, true);
  assert.equal(history.document.nodes[third].visible, false);
  assert.deepEqual(history.document.slides[0].nodeIds, [third, first, second]);
  assert.deepEqual(planScene(history.document, "page-one", "page").nodes.map((node) => node.id), [first, second]);
  history.undo();
  assert.deepEqual(history.document.slides[0].nodeIds, [first, second, third]);
  history.undo();
  assert.equal(history.document.nodes[third].visible, true);
});

test("page selection supports range and toggle gestures and freezes targets in page order", () => {
  const page = createDesignPageProject({ images: images(5), id: "design", slideId: "page-one" }).slides[0];
  const [a, b, c, d, e] = page.nodeIds;
  let selection = updatePageSelection(null, page.nodeIds, b);
  selection = updatePageSelection(selection, page.nodeIds, d, { extend: true });
  assert.deepEqual(selection.ids, [b, c, d]);
  selection = updatePageSelection(selection, page.nodeIds, c, { toggle: true });
  assert.deepEqual(selection.ids, [b, d]);
  selection = updatePageSelection(selection, page.nodeIds, e, { extend: true, toggle: true });
  assert.deepEqual(selection.ids, [b, c, d, e]);
  assert.deepEqual(snapshotPageSelection(selection, page), [b, c, d, e]);
  assert.deepEqual(updatePageSelection(selection, page.nodeIds, "stale-id"), { ids: [b, c, d, e], anchorId: c });
  assert.equal(selection.ids.includes(a), false);
});

test("page creation rejects malformed, duplicate or excessive image metadata", () => {
  assert.throws(() => createDesignPageProject({ images: [{ ...images(1)[0], sha256: "bad" }] }), /verified local/);
  assert.throws(() => createDesignPageProject({ images: [{ ...images(1)[0], id: "__proto__" }] }), /verified local/);
  assert.throws(() => createDesignPageProject({ images: [images(1)[0], images(1)[0]] }), /unique source/);
  assert.throws(() => createDesignPageProject({ images: images(201) }), /up to 200/);
  assert.throws(() => createDesignPageProject({ width: 0 }), /page size/);
});
