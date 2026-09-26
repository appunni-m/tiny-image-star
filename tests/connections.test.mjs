import assert from "node:assert/strict";
import { test } from "node:test";
import { affectedSlides, clone, resolveSlide, validateProject } from "../src/project/model.js";
import { applyProjectCommand, ProjectHistory } from "../src/project/history.js";
import { createPhotoStory, moveStorySlide, slidePhotos, storyLayoutCommand } from "../src/story/recipes.js";
import { canMoveStorySlide, connectedSlideGroup, createConnectedCutout, moveConnectedCutout, positionConnectedCutout, removeConnectedCutout, reviewConnections } from "../src/story/connections.js";
import { storyMaskCommand } from "../src/story/masks.js";
import { storyDepthCommand } from "../src/story/depth.js";
import { planScene } from "../src/compositor/scene-spec.js";
import { curatedStyles, styleCompatibility, storyStyleCommand, captureStoryStyle, serializeStyle } from "../src/styles/model.js";

const assets = Array.from({ length: 6 }, (_, index) => ({ id: `photo-${index}`, kind: "image", name: `Photo ${index}`, type: "image/png", width: 600, height: 800, orientation: "upright", sha256: "a".repeat(64), byteLength: 100 }));
const mask = { ...assets[0], id: "mask", kind: "mask", sha256: "b".repeat(64) };
const apply = (project, command) => applyProjectCommand(project, command).project;
function fixture() {
  let project = createPhotoStory(assets); const photo = slidePhotos(project, project.slides[0].id)[0];
  project = apply(project, storyMaskCommand(project, photo.id, mask));
  const created = createConnectedCutout(project, photo.id, project.slides[0].id);
  return { original: project, project: apply(project, created.command), id: created.id, photoId: photo.id, command: created.command };
}

test("connected copy preserves its source, shares the mask, and spans the same join in both shapes", () => {
  const { original, project, id, photoId } = fixture();
  assert.deepEqual(project.nodes[photoId], original.nodes[photoId]); assert.equal(project.nodes[id].maskId, mask.id);
  assert.deepEqual(project.assets, original.assets); assert.deepEqual(reviewConnections(project, "portrait"), []);
  for (const variant of project.variants) {
    const left = resolveSlide(project, project.slides[0].id, variant.id).nodes.find((node) => node.id === id);
    const right = resolveSlide(project, project.slides[1].id, variant.id).nodes.find((node) => node.id === id);
    assert.ok(Math.abs(left.viewport.x - right.viewport.x - variant.width) < 1e-8);
    assert.equal(left.viewport.width, right.viewport.width); assert.equal(left.viewport.height, right.viewport.height);
    assert.ok(Math.abs(left.viewport.width / left.viewport.height - .75) < 1e-8);
  }
  assert.deepEqual(affectedSlides(original, project), project.slides.slice(0, 2).map((slide) => slide.id));
});

test("create, position, mask edit and remove are atomic and reversible, with no shared-mask deletion", () => {
  const { original, id, command, photoId } = fixture(), history = new ProjectHistory(original);
  history.preview(command); history.preview(positionConnectedCutout(history.document, id, "portrait", { x: .9, y: .45, scale: 1.1 })); history.commit("Connect subject");
  assert.equal(history.past.length, 1); const portrait = clone(history.document.nodes[id].variantFrames.portrait), tall = clone(history.document.nodes[id].variantFrames.tall);
  history.undo(); assert.equal(history.document.nodes[id], undefined); history.redo(); assert.deepEqual(history.document.nodes[id].variantFrames.portrait, portrait);
  history.apply(storyMaskCommand(history.document, id, { ...mask, id: "copy-mask" }), "Repair copy");
  assert.equal(history.document.nodes[photoId].maskId, mask.id); assert.ok(history.document.assets.mask);
  history.apply(removeConnectedCutout(history.document, id), "Remove copy"); assert.equal(history.document.assets["copy-mask"], undefined); assert.ok(history.document.assets.mask);
  history.undo(); assert.deepEqual(history.document.nodes[id].variantFrames.tall, tall); assert.equal(history.document.nodes[id].maskId, "copy-mask");
});

test("connected pairs move together past neighboring blocks and retain local geometry", () => {
  const { project, id } = fixture(), [a, b, c, d] = project.slides.map((slide) => slide.id);
  const moved = apply(project, moveStorySlide(project, b, 1)); assert.deepEqual(moved.slides.map((slide) => slide.id), [c, a, b, d]);
  assert.deepEqual(moved.nodes[id], project.nodes[id]); assert.equal(canMoveStorySlide(project, b, -1), false);
  for (const slideId of [a, b]) {
    const before = planScene(project, slideId).nodes.find((node) => node.id === id), after = planScene(moved, slideId).nodes.find((node) => node.id === id);
    assert.deepEqual(after.canonicalViewport, before.canonicalViewport); assert.equal(after.originX, before.originX, "moving slides must not move the object's raster grid");
  }
  const restored = apply(moved, moveStorySlide(moved, a, -1)); assert.deepEqual(restored.slides.map((slide) => slide.id), [a, b, c, d]);
  const cloneSource = slidePhotos(project, c)[0]; let second = apply(project, storyMaskCommand(project, cloneSource.id, mask));
  const created = createConnectedCutout(second, cloneSource.id, c); second = apply(second, created.command);
  const exchanged = apply(second, moveStorySlide(second, b, 1)); assert.deepEqual(exchanged.slides.map((slide) => slide.id), [c, d, a, b]);
  const chain = apply(second, moveConnectedCutout(second, created.id, b)); assert.deepEqual(connectedSlideGroup(chain, b).ids, [a, b, c]);
  assert.deepEqual(apply(chain, moveStorySlide(chain, b, 1)).slides.map((slide) => slide.id), [d, a, b, c]);
});

test("changing the joined pair carries depth text and removing the copy leaves originals intact", () => {
  const { project, id, photoId } = fixture(), depth = apply(project, storyDepthCommand(project, id)), titleId = depth.nodes[id].depthTextId;
  const next = apply(depth, moveConnectedCutout(depth, id, depth.slides[2].id));
  assert.equal(next.nodes[titleId].anchorSlideId, next.slides[2].id);
  assert.ok(!next.slides[0].nodeIds.includes(id)); assert.ok(next.slides[2].nodeIds.includes(titleId));
  const removed = apply(next, removeConnectedCutout(next, id)); assert.equal(removed.nodes[titleId], undefined); assert.deepEqual(removed.nodes[photoId], project.nodes[photoId]);
  assert.throws(() => moveConnectedCutout(next, id, next.slides.at(-1).id), /neighboring/);
});

test("connection validation rejects split pairs, unilateral overrides and unknown connection schemas", () => {
  const { project, id } = fixture();
  for (const corrupt of [
    (p) => { p.nodes[id].connection.schema = 2; }, (p) => { p.nodes[id].connection.extra = true; },
    (p) => { p.nodes[id].space = "slide"; }, (p) => { p.nodes[id].connection.rightSlideId = p.slides[2].id; },
    (p) => { p.slides[1].nodeIds = p.slides[1].nodeIds.filter((node) => node !== id); },
    (p) => { p.slides[2].nodeIds.push(id); }, (p) => { p.slides[1].overrides[id] = { opacity: .5 }; },
    (p) => { [p.slides[1], p.slides[2]] = [p.slides[2], p.slides[1]]; },
  ]) { const next = clone(project); corrupt(next); assert.throws(() => validateProject(next)); }
  const depth = apply(project, storyDepthCommand(project, id)); depth.slides[0].overrides[depth.nodes[id].depthTextId] = { text: "one half" };
  assert.throws(() => validateProject(depth), /both slides/);
});

test("variant positioning, layout and styles preserve connections without counting decorative copies as sources", () => {
  let { project, id, photoId } = fixture(); const before = clone(project.nodes[id]);
  project = apply(project, positionConnectedCutout(project, id, "tall", { x: .1, y: .5, scale: .25 }));
  assert.deepEqual(project.nodes[id].variantFrames.portrait, before.variantFrames.portrait);
  assert.equal(reviewConnections(project, "tall")[0].code, "CONNECTION_OFF_JOIN");
  assert.deepEqual(reviewConnections(project, "portrait"), []);
  const connected = clone(project.nodes[id]); project = apply(project, storyLayoutCommand(project, project.slides[0].id, "straight"));
  assert.deepEqual(project.nodes[id], connected);
  for (let i = 0; i < 4; i++) project = apply(project, createConnectedCutout(project, photoId, project.slides[0].id).command);
  const style = curatedStyles()[0]; assert.equal(styleCompatibility(style, project), "");
  project = apply(project, storyStyleCommand(project, style)); assert.deepEqual(project.nodes[id], connected);
  const shared = serializeStyle(captureStoryStyle(project, project.slides[0].id, "Reusable", { look: true, text: true, layout: true, output: true }));
  assert.doesNotMatch(shared, /rightSlideId|connected-cutout|maskId/);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))), project);
});
