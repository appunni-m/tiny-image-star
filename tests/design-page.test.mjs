import test from "node:test";
import assert from "node:assert/strict";
import { addFrameAroundSelectionCommand, addShapeLayerCommand, addTextLayerCommand, appendDesignImagesCommand, createDesignPageProject,
  deleteLayerCommand, deleteLayersCommand, renameLayerCommand, reorderLayerCommand, resizeFrameChildren, setLayerLockedCommand,
  setLayerVisibilityCommand, snapshotPageSelection, updatePageSelection } from "../src/project/design-page.js";
import { ProjectHistory } from "../src/project/history.js";
import { ENGINE_IDENTITY, resolveLayerFrames, resolveSlide } from "../src/project/model.js";
import { planScene } from "../src/compositor/scene-spec.js";
import { designRecipePatch, designRecipeProblem } from "../src/design/recipes.js";

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

test("page layer add and delete commands are atomic, and image sources stay shared by reference", () => {
  const project = createDesignPageProject({ images: images(1), id: "design", slideId: "page-one" });
  const page = project.slides[0], original = page.nodeIds[0], source = project.nodes[original].assetId;
  const additions = images(2).map((asset, index) => ({ ...asset, id: `extra-${index}` }));
  const history = new ProjectHistory(project);
  history.apply(appendDesignImagesCommand(history.document, page.id, additions), "Add images");
  assert.equal(history.document.slides[0].nodeIds.length, 3);
  assert.equal(history.document.assets[source].sha256, project.assets[source].sha256);
  const textCommand = addTextLayerCommand(history.document, page.id, "Page title");
  history.apply(textCommand, "Add text");
  const shapeCommand = addShapeLayerCommand(history.document, page.id, "ellipse");
  history.apply(shapeCommand, "Add shape");
  assert.deepEqual(history.document.slides[0].nodeIds.map((id) => history.document.nodes[id].kind), ["image", "image", "image", "text", "shape"]);
  assert.equal(history.document.nodes[history.document.slides[0].nodeIds[3]].text, "Page title");
  const lastImage = history.document.slides[0].nodeIds[2];
  history.apply(deleteLayerCommand(history.document, lastImage), "Delete image");
  assert.equal(history.document.slides[0].nodeIds.length, 4);
  assert.equal(Object.hasOwn(history.document.assets, "extra-1"), false, "unreferenced source asset is released with its last layer");
  history.undo();
  assert.equal(Object.hasOwn(history.document.assets, "extra-1"), true);
});

test("deleting a full multi-selection removes every layer in one reversible command", () => {
  const project = createDesignPageProject({ images: images(200), id: "large-design", slideId: "page-one" });
  const targets = [...project.slides[0].nodeIds], history = new ProjectHistory(project);
  history.apply(deleteLayersCommand(history.document, targets), "Delete selection");
  assert.deepEqual(history.document.slides[0].nodeIds, []);
  assert.deepEqual(Object.keys(history.document.nodes), []);
  assert.deepEqual(Object.keys(history.document.assets), []);
  history.undo();
  assert.equal(history.document.slides[0].nodeIds.length, 200);
  assert.equal(Object.keys(history.document.assets).length, 200);
});

test("frames wrap sibling layers without changing their positions and preserve nested stack groups", () => {
  const project = createDesignPageProject({ images: [], id: "frame-design", slideId: "page-one" }), history = new ProjectHistory(project);
  const text = addTextLayerCommand(history.document, "page-one", "Inside"); history.apply(text, "Text");
  const shape = addShapeLayerCommand(history.document, "page-one", "ellipse"); history.apply(shape, "Shape");
  const sibling = shape.commands[0].id, original = resolveSlide(history.document, "page-one").nodes;
  const framed = addFrameAroundSelectionCommand(history.document, "page-one", [text.commands[0].id, sibling]);
  history.apply(framed.command, "Frame selection");
  const firstFrame = resolveLayerFrames(history.document, "page-one").get(framed.id);
  assert.deepEqual(history.document.slides[0].nodeIds, [framed.id, text.commands[0].id, sibling]);
  for (const id of [text.commands[0].id, sibling]) {
    const before = original.find((node) => node.id === id).viewport, after = resolveSlide(history.document, "page-one").nodes.find((node) => node.id === id).viewport;
    for (const key of ["x", "y", "width", "height"]) assert.ok(Math.abs(before[key] - after[key]) < 1e-8, `${id} ${key} stays in place`);
  }
  assert.equal(firstFrame.frame.width > 0, true);
  const extra = addShapeLayerCommand(history.document, "page-one"); history.apply(extra, "Shape");
  const outer = addFrameAroundSelectionCommand(history.document, "page-one", [framed.id, extra.commands[0].id]);
  history.apply(outer.command, "Nested frame");
  assert.equal(history.document.nodes[framed.id].parentId, outer.id);
  const nested = resolveLayerFrames(history.document, "page-one").get(sibling);
  assert.equal(nested.clipFrames.length, 2);
  assert.equal(resolveSlide(history.document, "page-one").nodes.find((node) => node.id === sibling).clipFrames.length, 2);
  const hidden = structuredClone(history.document); hidden.nodes[outer.id].visible = false; hidden.nodes[outer.id].locked = true;
  assert.equal(resolveSlide(hidden, "page-one").nodes.find((node) => node.id === sibling).visible, false,
    "hidden parent frames hide their descendants during render resolution");
  assert.equal(resolveLayerFrames(hidden, "page-one").get(sibling).locked, true,
    "locked parent frames lock their descendants in the editing geometry");
  history.undo(); assert.equal(history.document.nodes[framed.id].parentId, undefined);
  history.undo(); assert.equal(history.document.nodes[sibling].parentId, framed.id);
  history.undo(); assert.equal(history.document.nodes[sibling].parentId, undefined);
});

test("frame constraints preserve anchored margins and resize stretch-constrained children", () => {
  const project = createDesignPageProject({ images: [], id: "constraint-design", slideId: "page-one" }), history = new ProjectHistory(project);
  const text = addTextLayerCommand(history.document, "page-one", "Inside"); history.apply(text, "Text");
  const shape = addShapeLayerCommand(history.document, "page-one"); history.apply(shape, "Shape");
  const frameCommand = addFrameAroundSelectionCommand(history.document, "page-one", [text.commands[0].id, shape.commands[0].id]);
  history.apply(frameCommand.command, "Frame selection");
  const childId = shape.commands[0].id;
  const child = { ...history.document.nodes[childId], constraints: { horizontal: "right", vertical: "top-bottom" } };
  history.apply({ type: "node", id: childId, value: child }, "Constraints");
  const currentParent = history.document.nodes[frameCommand.id], currentChild = history.document.nodes[childId];
  const nextFrame = { ...currentParent.frame, width: currentParent.frame.width * 1.5, height: currentParent.frame.height * 1.5 };
  const rightGap = currentParent.frame.width - (currentChild.frame.x + currentChild.frame.width) * currentParent.frame.width;
  const topGap = currentChild.frame.y * currentParent.frame.height;
  const bottomGap = (1 - currentChild.frame.y - currentChild.frame.height) * currentParent.frame.height;
  const commands = [{ type: "node", id: frameCommand.id, value: { ...currentParent, frame: nextFrame } },
    ...resizeFrameChildren(history.document, "page-one", frameCommand.id, nextFrame)];
  history.apply({ type: "group", commands }, "Resize frame");
  const after = history.document.nodes[childId];
  assert.ok(Math.abs((after.frame.x + after.frame.width) * nextFrame.width - (nextFrame.width - rightGap)) < 1e-8);
  assert.ok(Math.abs(after.frame.y * nextFrame.height - topGap) < 1e-8);
  assert.ok(Math.abs((1 - after.frame.y - after.frame.height) * nextFrame.height - bottomGap) < 1e-8,
    "top-bottom constraints stretch to preserve both vertical margins");
});

test("design image recipes keep visual edits non-destructive and reject export-only settings", () => {
  const project = createDesignPageProject({ images: images(1), id: "recipe-design", slideId: "page-one" });
  const node = project.nodes[project.slides[0].nodeIds[0]], asset = project.assets[node.assetId];
  const recipe = { id: "warm-look", name: "Warm look", operations: { brightness: 1.1, photoLook: {
    version: 1, definition: { id: "look:warm", revision: 1, name: "Warm", engine: { name: ENGINE_IDENTITY.name,
      versions: [ENGINE_IDENTITY.version], compositors: [ENGINE_IDENTITY.compositor] },
      appearance: { brightness: 1.05, contrast: .95, saturation: .8, grayscaleMix: 0 } }, strength: 1,
  }, cropRelative: { x: .1, y: .2, width: .7, height: .6 }, rotation: 90 } };
  assert.equal(designRecipeProblem(recipe), "");
  assert.deepEqual(designRecipePatch(node, asset, recipe), { appearance: { brightness: 1.1 * 1.05, contrast: .95, saturation: .8, grayscaleMix: 0 },
    crop: recipe.operations.cropRelative, rotation: 90 });
  assert.match(designRecipeProblem({ id: "resize", name: "Resize", operations: { format: "png", resizeWidth: 1024 } }), /only changes exported/);
  assert.match(designRecipeProblem({ id: "caption", name: "Caption", operations: { textLayers: [{ text: "Hi" }] } }), /editable page layer/);
});
