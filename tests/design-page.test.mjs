import test from "node:test";
import assert from "node:assert/strict";
import { addFrameAroundSelectionCommand, addShapeLayerCommand, addTextLayerCommand, addVectorLayerCommand, appendDesignImagesCommand, createDesignPageProject,
  deleteLayerCommand, deleteLayersCommand, renameLayerCommand, reorderLayerCommand, resizeFrameChildren, setLayerLockedCommand,
  addGridTrackCommand, deleteGridTrackCommand, gridTrackGroupBounds, moveGridTrackCommand, reorderGridTrackCommand, resizeGridTrackCountCommand, setFrameLayoutCommand, setGridAlignmentCommand,
  setGridPlacementCommand, setLayerVisibilityCommand, snapshotPageSelection, updatePageSelection } from "../src/project/design-page.js";
import { ProjectHistory } from "../src/project/history.js";
import { createSceneProject, ENGINE_IDENTITY, resolveGridTrackGeometry, resolveLayerFrames, resolveSlide, validateProject } from "../src/project/model.js";
import { planScene } from "../src/compositor/scene-spec.js";
import { designRecipePatch, designRecipeProblem } from "../src/design/recipes.js";
import { createVectorShape } from "../src/design/vector-shapes.js";

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

test("pen vector layers persist closed paths and Bezier handles as one undoable page command", () => {
  const project = createDesignPageProject({ images: [], id: "vector-design", slideId: "vector-page" }), history = new ProjectHistory(project);
  const command = addVectorLayerCommand(history.document, "vector-page", {
    frame: { x: .1, y: .2, width: .4, height: .5 },
    path: { closed: true, points: [{ x: .1, y: .2 }, { x: .8, y: .25, handleIn: { x: .75, y: .2 }, handleOut: { x: 1.3, y: .3 } }, { x: .5, y: .9 }] },
  });
  history.apply(command, "Draw vector");
  const id = command.commands[0].id, node = history.document.nodes[id];
  assert.equal(node.kind, "shape"); assert.equal(node.style.shape, "path");
  assert.equal(node.style.path.closed, true); assert.deepEqual(node.style.path.points[1].handleOut, { x: 1.3, y: .3 });
  const [planned] = planScene(history.document, "vector-page", "page").nodes;
  assert.equal(planned.id, id); assert.ok(planned.bounds.x < planned.viewport.x - 100, "raster bounds include Bézier handles extending outside the frame");
  assert.doesNotThrow(() => validateProject(history.document));
  history.undo(); assert.equal(history.document.slides[0].nodeIds.length, 0);
  history.redo(); assert.deepEqual(history.document.nodes[id].style.path, node.style.path);
  const invalid = structuredClone(history.document); invalid.nodes[id].style.path.points[0].x = 2;
  assert.throws(() => validateProject(invalid), /vector point position/);
});

test("line, arrow, polygon and star tools generate bounded editable vector paths", () => {
  const project = createDesignPageProject({ images: [], id: "shape-design", slideId: "shape-page" });
  const history = new ProjectHistory(project);
  for (const kind of ["line", "arrow", "polygon", "star"]) {
    const geometry = createVectorShape(kind);
    const command = addVectorLayerCommand(history.document, "shape-page", geometry);
    history.apply(command, `Add ${kind}`);
    const node = history.document.nodes[command.commands[0].id];
    assert.equal(node.name, geometry.name);
    assert.equal(node.style.shape, "path");
    assert.equal(node.style.path.closed, kind !== "line");
    assert.ok(node.style.path.points.length >= (node.style.path.closed ? 3 : 2));
    assert.ok(node.style.path.points.every(({ x, y }) => x >= 0 && x <= 1 && y >= 0 && y <= 1));
    if (kind === "line") assert.ok(node.style.strokeWidth > 0 && node.style.strokeColor);
    assert.doesNotThrow(() => validateProject(history.document));
  }
  assert.equal(createVectorShape("polygon", { sides: 9 }).path.points.length, 9);
  assert.equal(createVectorShape("star", { sides: 7 }).path.points.length, 14);
  assert.throws(() => createVectorShape("polygon", { sides: 2 }), /3 and 24/);
  assert.throws(() => createVectorShape("star", { innerRadius: .05 }), /inner radius/);
  assert.throws(() => createVectorShape("heart"), /supported vector shape/);
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

test("frame Auto Layout resolves horizontal and vertical flow with pixel spacing, padding and alignment", () => {
  const project = createSceneProject({ id: "auto-layout", variants: [{ id: "page", width: 1000, height: 500 }],
    slides: [{ id: "layout-page", nodeIds: ["frame", "first", "second"], overrides: {} }], nodes: {
      frame: { id: "frame", kind: "frame", space: "slide", frame: { x: .1, y: .1, width: .6, height: .4 },
        style: { layout: { direction: "horizontal", gap: 20, padding: { top: 10, right: 10, bottom: 10, left: 10 }, justify: "start", align: "center" } } },
      first: { id: "first", kind: "shape", space: "slide", frame: { x: .9, y: .9, width: .2, height: .25 }, parentId: "frame",
        constraints: { horizontal: "left", vertical: "top" }, style: { shape: "rectangle" } },
      second: { id: "second", kind: "shape", space: "slide", frame: { x: .01, y: .01, width: .2, height: .25 }, parentId: "frame",
        constraints: { horizontal: "left", vertical: "top" }, style: { shape: "rectangle" } },
    } });
  const horizontal = resolveLayerFrames(project, "layout-page");
  const close = (value, expected) => assert.ok(Math.abs(value - expected) < 1e-9, `${value} ≈ ${expected}`);
  close(horizontal.get("first").frame.x, .11);
  close(horizontal.get("first").frame.y, .25);
  close(horizontal.get("first").frame.width, .12);
  close(horizontal.get("second").frame.x, .25); // first child plus the 20px gap
  project.nodes.frame.style.layout.direction = "vertical"; project.nodes.frame.style.layout.gap = 8;
  const vertical = resolveLayerFrames(project, "layout-page");
  close(vertical.get("first").frame.x, .34); // cross-axis center alignment overrides stored X positions
  close(vertical.get("first").frame.y, .12);
  close(vertical.get("second").frame.y, .236); // vertical flow applies padding and the 8px gap
  const invalid = structuredClone(project); invalid.nodes.frame.style.layout.justify = "unknown";
  assert.throws(() => validateProject(invalid), /alignment/);
});

test("Auto Layout distributes children with space-between, space-around, and space-evenly", () => {
  const ids = ["frame", "first", "second", "third"];
  const project = createSceneProject({ id: "layout-distribution", variants: [{ id: "page", width: 1000, height: 500 }],
    slides: [{ id: "page-one", nodeIds: ids, overrides: {} }], nodes: {
      frame: { id: "frame", kind: "frame", space: "slide", frame: { x: 0, y: 0, width: .5, height: .2 },
        style: { layout: { direction: "horizontal", justify: "space-between", align: "start" } } },
      ...Object.fromEntries(ids.slice(1).map((id) => [id, { id, kind: "shape", space: "slide", parentId: "frame",
        constraints: { horizontal: "left", vertical: "top" }, frame: { x: 0, y: 0, width: .1, height: .1 },
        layoutSizing: { width: "fixed", height: "fixed" }, layoutSize: { width: 100, height: 20 }, style: { shape: "rectangle" } }]))
    } });
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);
  const positions = (justify) => {
    project.nodes.frame.style.layout.justify = justify;
    return ids.slice(1).map((id) => resolveLayerFrames(project, "page-one").get(id).frame.x * 1000);
  };
  for (const [justify, expected] of [["space-between", [0, 200, 400]], ["space-around", [100 / 3, 200, 1100 / 3]],
    ["space-evenly", [50, 200, 350]]]) positions(justify).forEach((actual, index) => close(actual, expected[index]));
  const singleChild = createSceneProject({ id: "layout-even-single", variants: [{ id: "page", width: 1000, height: 500 }],
    slides: [{ id: "page-one", nodeIds: ["frame", "child"], overrides: {} }], nodes: {
      frame: { id: "frame", kind: "frame", space: "slide", frame: { x: 0, y: 0, width: .5, height: .2 },
        style: { layout: { direction: "horizontal", justify: "space-evenly", align: "start" } } },
      child: { id: "child", kind: "shape", space: "slide", parentId: "frame", constraints: { horizontal: "left", vertical: "top" },
        frame: { x: 0, y: 0, width: .1, height: .1 }, layoutSizing: { width: "fixed", height: "fixed" },
        layoutSize: { width: 100, height: 20 }, style: { shape: "rectangle" } },
    } });
  close(resolveLayerFrames(singleChild, "page-one").get("child").frame.x, .2,
    "space-evenly centers a single fixed-width child between equal edge gaps");
  const invalid = structuredClone(project); invalid.nodes.frame.style.layout.justify = "space-evenly";
  invalid.nodes.frame.style.layout.direction = "grid"; invalid.nodes.frame.style.layout.columns = 3; invalid.nodes.frame.style.layout.rows = 1;
  assert.throws(() => validateProject(invalid), /alignment/);
});

test("Auto Layout wraps in flow order and distributes Fill sizing on both axes", () => {
  const project = createSceneProject({ id: "layout-wrap", variants: [{ id: "page", width: 400, height: 300 }],
    slides: [{ id: "page-one", nodeIds: ["frame", "first", "second", "third"], overrides: {} }], nodes: {
      frame: { id: "frame", kind: "frame", space: "slide", frame: { x: .1, y: .1, width: .5, height: .4 },
        layoutSizing: { width: "fixed", height: "fixed" }, layoutSize: { width: 200, height: 120 },
        style: { layout: { direction: "horizontal", wrap: true, gap: 10, rowGap: 8,
          padding: { top: 10, right: 10, bottom: 10, left: 10 }, align: "start" } } },
      first: { id: "first", kind: "shape", space: "slide", parentId: "frame", constraints: { horizontal: "left", vertical: "top" },
        frame: { x: 0, y: 0, width: .2, height: .25 }, layoutSizing: { width: "fixed", height: "fixed" }, layoutSize: { width: 80, height: 30 } },
      second: { id: "second", kind: "shape", space: "slide", parentId: "frame", constraints: { horizontal: "left", vertical: "top" },
        frame: { x: 0, y: 0, width: .15, height: .2 }, layoutSizing: { width: "fixed", height: "fixed" }, layoutSize: { width: 60, height: 20 } },
      third: { id: "third", kind: "shape", space: "slide", parentId: "frame", constraints: { horizontal: "left", vertical: "top" },
        frame: { x: 0, y: 0, width: .2, height: .3 }, layoutSizing: { width: "fixed", height: "fixed" }, layoutSize: { width: 80, height: 40 } },
    } });
  const wrapped = resolveLayerFrames(project, "page-one"), close = (value, expected) => assert.ok(Math.abs(value - expected) < 1e-9, `${value} ≈ ${expected}`);
  close(wrapped.get("first").frame.x, .125);
  close(wrapped.get("second").frame.x, .35);
  close(wrapped.get("second").frame.y, .13333333333333333);
  close(wrapped.get("third").frame.y, .26);
  project.nodes.frame.style.layout.direction = "vertical";
  const wrappedVertical = resolveLayerFrames(project, "page-one");
  close(wrappedVertical.get("second").frame.y, .26);
  close(wrappedVertical.get("third").frame.x, .35);

  project.nodes.frame.style.layout.direction = "horizontal";
  project.nodes.frame.style.layout.wrap = false;
  project.slides[0].nodeIds = ["frame", "first", "second"];
  delete project.nodes.third;
  project.nodes.first.layoutSize = { width: 50, height: 30 };
  project.nodes.second.layoutSizing.width = "fill";
  project.nodes.second.layoutSizing.height = "fill";
  project.nodes.second.layoutSize = { width: 20, height: 20 };
  const filled = resolveLayerFrames(project, "page-one");
  close(filled.get("second").frame.width, .3); // 120px fills the 180px inner width after 50px + 10px gap.
  close(filled.get("second").frame.height, 1 / 3); // Fill uses the 100px inner cross-axis of a 300px page.
});

test("grid Auto Layout resolves equal tracks, auto rows, spans, and rejects occupied or missing cells", () => {
  const ids = ["frame", "first", "second", "third", "fourth"];
  const nodes = { frame: { id: "frame", kind: "frame", space: "slide", frame: { x: 0, y: 0, width: 1, height: 1 },
    style: { layout: { direction: "grid", columns: 3, rows: 0, rowGap: 20, columnGap: 10,
      padding: { top: 10, right: 10, bottom: 10, left: 10 }, justify: "stretch", align: "stretch", wrap: false } } } };
  for (const id of ids.slice(1)) nodes[id] = { id, kind: "shape", space: "slide", parentId: "frame",
    constraints: { horizontal: "left", vertical: "top" }, frame: { x: 0, y: 0, width: .2, height: .2 },
    layoutSizing: { width: "fixed", height: "fixed" }, layoutSize: { width: 50, height: 30 }, style: { shape: "rectangle" } };
  const project = createSceneProject({ id: "grid-layout", variants: [{ id: "page", width: 300, height: 200 }],
    slides: [{ id: "grid-page", nodeIds: ids, overrides: {} }], nodes });
  const resolved = resolveLayerFrames(project, "grid-page"), close = (value, expected) => assert.ok(Math.abs(value - expected) < 1e-8, `${value} ≈ ${expected}`);
  close(resolved.get("first").frame.x, 10 / 300);
  close(resolved.get("first").frame.y, 10 / 200);
  close(resolved.get("first").frame.width, (280 - 20) / 3 / 300);
  close(resolved.get("second").frame.x, (10 + (280 - 20) / 3 + 10) / 300);
  close(resolved.get("third").frame.x, (10 + 2 * ((280 - 20) / 3 + 10)) / 300);
  close(resolved.get("fourth").frame.y, 110 / 200, "the fourth child auto-flows to row two");

  const history = new ProjectHistory(project);
  history.apply(setGridPlacementCommand(history.document, "grid-page", "first", { row: 1, column: 1, rowSpan: 2, columnSpan: 2 }), "Span grid item");
  history.apply(setGridPlacementCommand(history.document, "grid-page", "second", { row: 1, column: 3, rowSpan: 1, columnSpan: 1 }), "Place grid item");
  const spanned = resolveLayerFrames(history.document, "grid-page");
  assert.ok(spanned.get("first").frame.width > spanned.get("third").frame.width, "a cell layer spans both selected columns");
  assert.ok(spanned.get("third").frame.x > spanned.get("first").frame.x + spanned.get("first").frame.width,
    "auto-flow skips every cell reserved by a multi-track span");

  const overlap = structuredClone(history.document);
  overlap.nodes.second.gridPlacement.column = 2;
  assert.throws(() => validateProject(overlap), /Grid cells cannot overlap/);
  const full = structuredClone(project);
  full.nodes.frame.style.layout = { ...full.nodes.frame.style.layout, columns: 2, rows: 1 };
  assert.throws(() => validateProject(full), /Grid has no empty cells/);
  const invalidSpan = structuredClone(project);
  invalidSpan.nodes.first.gridPlacement = { row: 1, column: 3, rowSpan: 1, columnSpan: 2 };
  assert.throws(() => validateProject(invalidSpan), /Invalid grid placement/);
});

test("grid tracks support fixed pixels, weighted Fill fractions, and content Hug sizing", () => {
  const ids = ["frame", "fixed", "fill-one", "fill-two", "hug"];
  const nodes = { frame: { id: "frame", kind: "frame", space: "slide", frame: { x: 0, y: 0, width: 1, height: 1 },
    style: { layout: { direction: "grid", columns: 4, rows: 1, rowGap: 0, columnGap: 10,
      padding: { top: 10, right: 10, bottom: 10, left: 10 }, justify: "start", align: "start",
      columnTracks: [{ mode: "fixed", value: 100 }, { mode: "fill", value: 1 }, { mode: "fill", value: 2 }, { mode: "hug" }],
      rowTracks: [{ mode: "hug" }] } } } };
  for (const [index, id] of ids.slice(1).entries()) nodes[id] = { id, kind: "shape", space: "slide", parentId: "frame",
    constraints: { horizontal: "left", vertical: "top" }, frame: { x: 0, y: 0, width: .1, height: .1 },
    layoutSizing: { width: "fill", height: "fixed" }, layoutSize: { width: 30 + index * 10, height: 30 + index * 10 },
    style: { shape: "rectangle" } };
  const project = createSceneProject({ id: "grid-track-sizing", variants: [{ id: "page", width: 600, height: 300 }],
    slides: [{ id: "grid-page", nodeIds: ids, overrides: {} }], nodes });
  const resolved = resolveLayerFrames(project, "grid-page"), close = (value, expected) => assert.ok(Math.abs(value - expected) < 1e-8, `${value} ≈ ${expected}`);
  close(resolved.get("fixed").frame.x, 10 / 600);
  close(resolved.get("fixed").frame.width, 100 / 600);
  close(resolved.get("fill-one").frame.x, 120 / 600);
  close(resolved.get("fill-one").frame.width, 130 / 600);
  close(resolved.get("fill-two").frame.x, 260 / 600);
  close(resolved.get("fill-two").frame.width, 260 / 600);
  close(resolved.get("hug").frame.x, 530 / 600);
  close(resolved.get("hug").frame.width, 60 / 600);
  close(resolved.get("hug").frame.height, 60 / 300, "Hug rows fit the largest cell layer while keeping padding");
  const trackGeometry = resolveGridTrackGeometry(project, "grid-page", "frame", "page");
  assert.deepEqual(trackGeometry.columns.map(({ start, size, end }) => ({ start, size, end })), [
    { start: 10, size: 100, end: 110 }, { start: 120, size: 130, end: 250 },
    { start: 260, size: 260, end: 520 }, { start: 530, size: 60, end: 590 },
  ], "canvas guides share resolved padding, track sizes, and gaps with the renderer");
  assert.deepEqual(trackGeometry.rows.map(({ start, size, end }) => ({ start, size, end })), [{ start: 10, size: 60, end: 70 }]);
  const invalidTrack = structuredClone(project);
  invalidTrack.nodes.frame.style.layout.columnTracks[1].value = 0;
  assert.throws(() => validateProject(invalidTrack), /Invalid grid track fraction/);
});

test("grid children override horizontal and vertical alignment and can return to the parent setting", () => {
  const project = createSceneProject({ id: "grid-child-alignment", variants: [{ id: "page", width: 300, height: 200 }],
    slides: [{ id: "grid-page", nodeIds: ["frame", "child"], overrides: {} }], nodes: {
      frame: { id: "frame", kind: "frame", space: "slide", frame: { x: 0, y: 0, width: 1, height: 1 },
        style: { layout: { direction: "grid", columns: 1, rows: 1, justify: "stretch", align: "stretch" } } },
      child: { id: "child", kind: "shape", space: "slide", parentId: "frame", constraints: { horizontal: "left", vertical: "top" },
        frame: { x: 0, y: 0, width: .2, height: .2 }, layoutSizing: { width: "fixed", height: "fixed" },
        layoutSize: { width: 60, height: 40 }, style: { shape: "rectangle" } },
    } });
  const history = new ProjectHistory(project);
  history.apply(setGridAlignmentCommand(history.document, "grid-page", "child", "horizontal", "center"), "Center grid child");
  history.apply(setGridAlignmentCommand(history.document, "grid-page", "child", "vertical", "end"), "Align grid child bottom");
  const resolved = resolveLayerFrames(history.document, "grid-page").get("child").frame;
  assert.ok(Math.abs(resolved.x - .4) < 1e-8 && Math.abs(resolved.y - .8) < 1e-8);
  assert.ok(Math.abs(resolved.width - .2) < 1e-8 && Math.abs(resolved.height - .2) < 1e-8,
    "an aligned fixed-size layer stays fixed inside its grid cell even when the parent uses Stretch");
  history.apply(setGridAlignmentCommand(history.document, "grid-page", "child", "horizontal", null), "Inherit grid horizontal alignment");
  assert.deepEqual(history.document.nodes.child.gridAlignment, { vertical: "end" });
  history.apply(setGridAlignmentCommand(history.document, "grid-page", "child", "vertical", null), "Inherit grid vertical alignment");
  assert.equal(history.document.nodes.child.gridAlignment, undefined, "clearing both overrides removes the optional alignment record");
  const inherited = resolveLayerFrames(history.document, "grid-page").get("child").frame;
  assert.deepEqual(inherited, { x: 0, y: 0, width: 1, height: 1 }, "Auto restores both parent Stretch settings");
  const invalid = structuredClone(project);
  invalid.nodes.child.gridAlignment = { horizontal: "middle" };
  assert.throws(() => validateProject(invalid), /Invalid grid alignment/);
});

test("grid track add, reorder and delete are reversible and preserve spanning cell geometry", () => {
  const project = createSceneProject({ id: "grid-track-actions", variants: [{ id: "page", width: 600, height: 300 }],
    slides: [{ id: "grid-page", nodeIds: ["frame", "wide", "single"], overrides: {} }], nodes: {
      frame: { id: "frame", kind: "frame", space: "slide", frame: { x: 0, y: 0, width: 1, height: 1 },
        style: { layout: { direction: "grid", columns: 3, rows: 1, columnTracks: [
          { mode: "fixed", value: 100 }, { mode: "fixed", value: 200 }, { mode: "fixed", value: 300 },
        ], rowTracks: [{ mode: "fill", value: 1 }] } } },
      wide: { id: "wide", kind: "shape", space: "slide", parentId: "frame", constraints: { horizontal: "left", vertical: "top" },
        frame: { x: 0, y: 0, width: .5, height: 1 }, gridPlacement: { row: 1, column: 1, rowSpan: 1, columnSpan: 2 },
        style: { shape: "rectangle" } },
      single: { id: "single", kind: "shape", space: "slide", parentId: "frame", constraints: { horizontal: "left", vertical: "top" },
        frame: { x: .5, y: 0, width: .5, height: 1 }, gridPlacement: { row: 1, column: 3, rowSpan: 1, columnSpan: 1 },
        style: { shape: "rectangle" } },
    } });
  const history = new ProjectHistory(project);
  assert.deepEqual(gridTrackGroupBounds(history.document, "grid-page", "frame", "columns", 1), { first: 0, last: 1 },
    "a spanning cell joins its columns into one draggable track group");
  history.apply(moveGridTrackCommand(history.document, "grid-page", "frame", "columns", 0, 1), "Move spanning track group");
  assert.deepEqual(history.document.nodes.frame.style.layout.columnTracks, [
    { mode: "fixed", value: 300 }, { mode: "fixed", value: 100 }, { mode: "fixed", value: 200 },
  ]);
  assert.deepEqual(history.document.nodes.wide.gridPlacement, { row: 1, column: 2, rowSpan: 1, columnSpan: 2 });
  assert.deepEqual(history.document.nodes.single.gridPlacement, { row: 1, column: 1, rowSpan: 1, columnSpan: 1 });
  history.undo();
  assert.deepEqual(history.document.nodes.frame.style.layout.columnTracks[0], { mode: "fixed", value: 100 });

  const fourTracks = structuredClone(project);
  fourTracks.nodes.frame.style.layout.columns = 4;
  fourTracks.nodes.frame.style.layout.columnTracks.push({ mode: "fixed", value: 400 });
  fourTracks.nodes.single.gridPlacement = { row: 1, column: 3, rowSpan: 1, columnSpan: 1 };
  const reorderHistory = new ProjectHistory(validateProject(fourTracks));
  reorderHistory.apply(reorderGridTrackCommand(reorderHistory.document, "grid-page", "frame", "columns", 0, 4), "Move span to end");
  assert.deepEqual(reorderHistory.document.nodes.frame.style.layout.columnTracks.map((track) => track.value), [300, 400, 100, 200]);
  assert.deepEqual(reorderHistory.document.nodes.wide.gridPlacement, { row: 1, column: 3, rowSpan: 1, columnSpan: 2 });
  assert.deepEqual(reorderHistory.document.nodes.single.gridPlacement, { row: 1, column: 1, rowSpan: 1, columnSpan: 1 });
  reorderHistory.undo();
  assert.deepEqual(reorderHistory.document.nodes.frame.style.layout.columnTracks.map((track) => track.value), [100, 200, 300, 400]);
  reorderHistory.redo();
  assert.deepEqual(reorderHistory.document.nodes.frame.style.layout.columnTracks.map((track) => track.value), [300, 400, 100, 200]);

  const wouldSplitSpan = structuredClone(fourTracks);
  wouldSplitSpan.nodes.single.gridPlacement = { row: 1, column: 3, rowSpan: 1, columnSpan: 2 };
  assert.throws(() => reorderGridTrackCommand(validateProject(wouldSplitSpan), "grid-page", "frame", "columns", 0, 3),
    /split a spanning grid object/, "a drag cannot pull apart another cell's spanning tracks");

  history.apply(deleteGridTrackCommand(history.document, "grid-page", "frame", "columns", 0), "Delete first column");
  assert.equal(history.document.nodes.frame.style.layout.columns, 2);
  assert.deepEqual(history.document.nodes.wide.gridPlacement, { row: 1, column: 1, rowSpan: 1, columnSpan: 1 },
    "a cell spanning the deleted track shrinks into the closest remaining cell");
  assert.deepEqual(history.document.nodes.single.gridPlacement, { row: 1, column: 2, rowSpan: 1, columnSpan: 1 });
  history.undo();

  history.apply(deleteGridTrackCommand(history.document, "grid-page", "frame", "columns", 2), "Delete occupied column");
  assert.equal(history.document.nodes.single, undefined, "deleting a track deletes its single-cell contents");
  assert.deepEqual(history.document.slides[0].nodeIds, ["frame", "wide"]);
  history.undo();
  assert.ok(history.document.nodes.single, "undo restores deleted layers and their track membership");

  history.apply(addGridTrackCommand(history.document, "grid-page", "frame", "columns"), "Add column");
  assert.equal(history.document.nodes.frame.style.layout.columns, 4);
  assert.deepEqual(history.document.nodes.frame.style.layout.columnTracks.at(-1), { mode: "fill", value: 1 });
  history.undo();
  history.apply(deleteGridTrackCommand(history.document, "grid-page", "frame", "columns", 2), "Delete to two columns");
  history.apply(deleteGridTrackCommand(history.document, "grid-page", "frame", "columns", 1), "Delete to one column");
  assert.throws(() => deleteGridTrackCommand(history.document, "grid-page", "frame", "columns", 0), /at least one/);

  const automaticRows = structuredClone(project);
  automaticRows.nodes.frame.style.layout.rows = 0;
  delete automaticRows.nodes.frame.style.layout.rowTracks;
  const rowsHistory = new ProjectHistory(validateProject(automaticRows));
  rowsHistory.apply(addGridTrackCommand(rowsHistory.document, "grid-page", "frame", "rows"), "Add row to auto grid");
  assert.equal(rowsHistory.document.nodes.frame.style.layout.rows, 2, "adding a row converts auto rows to an explicit count that includes the new track");

  const autoGrid = structuredClone(project);
  autoGrid.nodes.frame.style.layout.rows = 0;
  const countHistory = new ProjectHistory(validateProject(autoGrid));
  countHistory.apply(resizeGridTrackCountCommand(countHistory.document, "grid-page", "frame", "columns", 2), "Reduce grid columns");
  assert.equal(countHistory.document.nodes.frame.style.layout.columns, 2);
  assert.deepEqual(countHistory.document.nodes.wide.gridPlacement, { row: 1, column: 1, rowSpan: 1, columnSpan: 2 });
  assert.deepEqual(countHistory.document.nodes.single.gridPlacement, { row: 2, column: 2, rowSpan: 1, columnSpan: 1 },
    "the count picker preserves a cell that no longer fits by moving it to the nearest free auto-row cell");
});

test("Auto Layout Hug sizes a frame around fixed children and Fill makes the parent fixed on that axis", () => {
  const project = createSceneProject({ id: "layout-hug", variants: [{ id: "page", width: 400, height: 300 }],
    slides: [{ id: "page-one", nodeIds: ["frame", "first", "second"], overrides: {} }], nodes: {
      frame: { id: "frame", kind: "frame", space: "slide", frame: { x: .1, y: .1, width: .5, height: .4 },
        layoutSizing: { width: "hug", height: "hug" }, layoutSize: { width: 200, height: 120 },
        style: { layout: { direction: "horizontal", gap: 10, padding: { top: 8, right: 10, bottom: 8, left: 10 } } } },
      first: { id: "first", kind: "shape", space: "slide", parentId: "frame", constraints: { horizontal: "left", vertical: "top" },
        frame: { x: 0, y: 0, width: .2, height: .25 }, layoutSizing: { width: "fixed", height: "fixed" }, layoutSize: { width: 80, height: 30 } },
      second: { id: "second", kind: "shape", space: "slide", parentId: "frame", constraints: { horizontal: "left", vertical: "top" },
        frame: { x: 0, y: 0, width: .15, height: .2 }, layoutSizing: { width: "fixed", height: "fixed" }, layoutSize: { width: 60, height: 20 } },
    } });
  const hug = resolveLayerFrames(project, "page-one").get("frame");
  assert.ok(Math.abs(hug.frame.width * 400 - 170) < 1e-8);
  assert.ok(Math.abs(hug.frame.height * 300 - 46) < 1e-8);
  project.nodes.second.layoutSizing.width = "fill";
  const fixedByFill = resolveLayerFrames(project, "page-one").get("frame");
  assert.ok(Math.abs(fixedByFill.frame.width * 400 - 200) < 1e-8,
    "a Fill child keeps its parent fixed on that axis instead of creating a Hug cycle");
  project.nodes.second.visible = false;
  const hiddenFill = resolveLayerFrames(project, "page-one").get("frame");
  assert.ok(Math.abs(hiddenFill.frame.width * 400 - 100) < 1e-8,
    "hidden Fill children no longer reserve Auto Layout space or force the parent to Fixed");
  const invalid = structuredClone(project); invalid.nodes.first.layoutSizing.width = "fill"; invalid.nodes.frame.style.layout = null;
  assert.throws(() => validateProject(invalid), /Auto Layout/);
});

test("a nested Hug frame resolves its content size inside a manually positioned parent", () => {
  const project = createSceneProject({ id: "nested-hug", variants: [{ id: "page", width: 400, height: 300 }],
    slides: [{ id: "page-one", nodeIds: ["outer", "inner", "child"], overrides: {} }], nodes: {
      outer: { id: "outer", kind: "frame", space: "slide", frame: { x: 0, y: 0, width: 1, height: 1 } },
      inner: { id: "inner", kind: "frame", space: "slide", parentId: "outer", constraints: { horizontal: "left", vertical: "top" },
        frame: { x: .1, y: .1, width: .5, height: .3 }, layoutSizing: { width: "hug", height: "hug" }, layoutSize: { width: 200, height: 90 },
        style: { layout: { direction: "vertical", gap: 4, padding: { top: 5, right: 5, bottom: 5, left: 5 } } } },
      child: { id: "child", kind: "shape", space: "slide", parentId: "inner", constraints: { horizontal: "left", vertical: "top" },
        frame: { x: 0, y: 0, width: .25, height: .1 }, layoutSizing: { width: "fixed", height: "fixed" }, layoutSize: { width: 100, height: 20 } },
    } });
  const resolved = resolveLayerFrames(project, "page-one");
  assert.ok(Math.abs(resolved.get("inner").frame.width * 400 - 110) < 1e-8);
  assert.ok(Math.abs(resolved.get("inner").frame.height * 300 - 30) < 1e-8);
});

test("turning Auto Layout off keeps the current child positions and Fill-resolved size", () => {
  const project = createSceneProject({ id: "layout-toggle", variants: [{ id: "page", width: 400, height: 300 }],
    slides: [{ id: "page-one", nodeIds: ["frame", "first", "second"], overrides: {} }], nodes: {
      frame: { id: "frame", kind: "frame", space: "slide", frame: { x: .1, y: .1, width: .5, height: .4 },
        layoutSizing: { width: "fixed", height: "fixed" }, layoutSize: { width: 200, height: 120 },
        style: { layout: { direction: "horizontal", gap: 10, padding: { top: 10, right: 10, bottom: 10, left: 10 } } } },
      first: { id: "first", kind: "shape", space: "slide", parentId: "frame", constraints: { horizontal: "left", vertical: "top" },
        frame: { x: 0, y: 0, width: .125, height: .1 }, layoutSizing: { width: "fixed", height: "fixed" }, layoutSize: { width: 50, height: 30 } },
      second: { id: "second", kind: "shape", space: "slide", parentId: "frame", constraints: { horizontal: "left", vertical: "top" },
        frame: { x: 0, y: 0, width: .05, height: .1 }, layoutSizing: { width: "fill", height: "fixed" }, layoutSize: { width: 20, height: 30 } },
    } });
  const before = resolveLayerFrames(project, "page-one"), history = new ProjectHistory(project);
  history.apply(setFrameLayoutCommand(history.document, "page-one", "frame", "manual"), "Disable Auto Layout");
  const after = resolveLayerFrames(history.document, "page-one");
  for (const id of ["frame", "first", "second"]) for (const key of ["x", "y", "width", "height"])
    assert.ok(Math.abs(after.get(id).frame[key] - before.get(id).frame[key]) < 1e-9, `${id} ${key} survives disabling Auto Layout`);
  assert.equal(history.document.nodes.second.layoutSizing.width, "fixed");
  assert.ok(Math.abs(history.document.nodes.second.layoutSize.width - 120) < 1e-9,
    "Fill becomes Fixed using the current displayed width");
});

test("design image recipes keep visual edits non-destructive and reject export-only settings", () => {
  const project = createDesignPageProject({ images: images(1), id: "recipe-design", slideId: "page-one" });
  const node = project.nodes[project.slides[0].nodeIds[0]], asset = project.assets[node.assetId];
  const recipe = { id: "warm-look", name: "Warm look", operations: { brightness: 1.1, photoLook: {
    version: 1, definition: { id: "look:warm", revision: 1, name: "Warm", engine: { name: ENGINE_IDENTITY.name,
      versions: [ENGINE_IDENTITY.version], compositors: [ENGINE_IDENTITY.compositor] },
      appearance: { brightness: 1.05, contrast: .95, saturation: .8, grayscaleMix: 0 } }, strength: 1,
  }, cropRelative: { x: .1, y: .2, width: .7, height: .6 }, rotation: 90, flipX: true, flipY: false } };
  assert.equal(designRecipeProblem(recipe), "");
  assert.deepEqual(designRecipePatch(node, asset, recipe), { appearance: { brightness: 1.1 * 1.05, contrast: .95, saturation: .8, grayscaleMix: 0 },
    flipX: false, flipY: true, crop: recipe.operations.cropRelative, rotation: 90 });
  assert.equal(designRecipeProblem({ id: "flip", name: "Flip", operations: { flipX: true } }), "",
    "a transform-only flip is a valid image recipe");
  assert.match(designRecipeProblem({ id: "resize", name: "Resize", operations: { format: "png", resizeWidth: 1024 } }), /only changes exported/);
  assert.match(designRecipeProblem({ id: "caption", name: "Caption", operations: { textLayers: [{ text: "Hi" }] } }), /editable page layer/);
});
