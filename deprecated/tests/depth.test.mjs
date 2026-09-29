import assert from "node:assert/strict";
import { test } from "node:test";
import { compositeDepthPixels } from "../src/compositor/depth.js";
import { createPhotoStory, slidePhotos, storyLookCommand } from "../src/story/recipes.js";
import { storyDepthCommand } from "../src/story/depth.js";
import { storyMaskCommand } from "../src/story/masks.js";
import { applyProjectCommand, ProjectHistory } from "../src/project/history.js";
import { clone, validateProject, resolveSlide, canonicalJSON } from "../src/project/model.js";
import { planScene } from "../src/compositor/scene-spec.js";
import { sceneWork } from "../src/processing/policy.js";
import { captureStoryStyle, serializeStyle } from "../src/styles/model.js";

const assets = Array.from({ length: 6 }, (_, i) => ({ id: `photo-${i}`, kind: "image", name: `Photo ${i}`, width: 400, height: 600, orientation: "upright", type: "image/png", byteLength: 120, sha256: "a".repeat(64) }));
const mask = { id: "subject", kind: "mask", name: "Subject", width: 400, height: 600, orientation: "upright", type: "image/png", byteLength: 40, sha256: "b".repeat(64) };
const apply = (project, command) => applyProjectCommand(project, command).project;
function fixture() {
  let project = createPhotoStory(assets), photo = slidePhotos(project, project.slides[0].id)[0];
  project = apply(project, storyMaskCommand(project, photo.id, mask));
  return { project, photoId: photo.id, slideId: project.slides[0].id };
}
const rgba = (color, alpha) => [...color.map((c) => c * alpha), alpha];
const over = (top, back) => top.map((c, i) => c + back[i] * (1 - top[3]));

test("depth preserves source alpha and matches an independently split layer stack", () => {
  const color = [40, 120, 210], ink = [230, 60, 30];
  for (const alpha of [0, 31, 128, 255]) for (const mask of [0, 64, 192, 255]) for (const textAlpha of [0, 43, 128, 255]) {
    const foreground = Math.floor(alpha * mask / 255), a = alpha / 255, f = foreground / 255;
    const backgroundAlpha = f === 1 ? 0 : (a - f) / (1 - f);
    const expected = over(rgba(color, f), over(rgba(ink, textAlpha / 255), rgba(color, backgroundAlpha)));
    const rendered = compositeDepthPixels(Uint8Array.from([...color, alpha]), Uint8Array.from([...color, foreground]), Uint8Array.from([...ink, textAlpha]));
    assert.equal(rendered[3], Math.round(expected[3] * 255));
    if (rendered[3]) for (let c = 0; c < 3; c++) assert.ok(Math.abs(rendered[c] - Math.round(expected[c] / expected[3])) <= 1);
    if (!textAlpha) assert.deepEqual([...rendered], [...color, alpha], "no words means the exact original, including transparent RGB");
  }
});

test("page background composites the extracted subject once over the title", () => {
  const photo = Uint8Array.from([10, 20, 30, 200]), subject = Uint8Array.from([10, 20, 30, 64]), words = Uint8Array.from([220, 30, 180, 128]);
  const expected = over(rgba([10, 20, 30], 64 / 255), rgba([220, 30, 180], 128 / 255));
  const actual = compositeDepthPixels(photo, subject, words, false);
  assert.deepEqual([...actual], [...expected.slice(0, 3).map((v) => Math.round(v / expected[3])), Math.round(expected[3] * 255)]);
  assert.throws(() => compositeDepthPixels(new Uint8Array(4), new Uint8Array(3), new Uint8Array(4)), /matching/);
});

test("depth title creation and edits form one undoable project operation", () => {
  const { project, photoId, slideId } = fixture(), history = new ProjectHistory(project);
  history.preview(storyDepthCommand(history.document, photoId));
  const titleId = history.document.nodes[photoId].depthTextId;
  history.preview({ type: "node", id: titleId, value: { ...history.document.nodes[titleId], text: "My weekend" } });
  history.commit("Depth title");
  assert.equal(history.past.length, 1); assert.equal(history.document.nodes[titleId].text, "My weekend");
  const index = history.document.slides[0].nodeIds.indexOf(photoId); assert.equal(history.document.slides[0].nodeIds[index + 1], titleId);
  history.undo(); assert.equal(history.document.nodes[titleId], undefined); assert.equal(history.document.nodes[photoId].maskId, mask.id);
  history.redo(); assert.equal(history.document.nodes[titleId].text, "My weekend");
  const restored = validateProject(JSON.parse(canonicalJSON(history.document)));
  assert.deepEqual(resolveSlide(restored, slideId), resolveSlide(history.document, slideId));
});

test("depth relationships reject dangling, reordered, shared or incompatible titles", () => {
  const { project, photoId, slideId } = fixture(), document = apply(project, storyDepthCommand(project, photoId)), titleId = document.nodes[photoId].depthTextId;
  for (const corrupt of [
    (p) => { p.nodes[photoId].maskId = p.nodes[photoId].assetId; },
    (p) => { p.nodes[photoId].depthTextId = "missing"; },
    (p) => { p.nodes[titleId].style.fontBasis = "height"; },
    (p) => { p.nodes[titleId].kind = "image"; },
    (p) => { p.slides[0].nodeIds.reverse(); },
    (p) => { p.slides[1].nodeIds.push(titleId); },
    (p) => { p.nodes[titleId].space = "story"; p.nodes[titleId].anchorSlideId = slideId; },
  ]) { const broken = clone(document); corrupt(broken); assert.throws(() => validateProject(broken)); }
});

test("depth geometry follows photo frame, rotation and both output variants", () => {
  const { project, photoId, slideId } = fixture(), document = apply(project, storyDepthCommand(project, photoId)), titleId = document.nodes[photoId].depthTextId;
  for (const variant of document.variants) {
    const scene = resolveSlide(document, slideId, variant.id), photo = scene.nodes.find((n) => n.id === photoId), title = scene.nodes.find((n) => n.id === titleId);
    assert.ok(Math.abs(title.viewport.width - photo.viewport.width * .92) < 1e-8);
    assert.ok(Math.abs(title.viewport.height - photo.viewport.height * .3) < 1e-8);
    assert.equal(title.rotation, photo.rotation);
    assert.equal(title.style.fontSize, .18 * photo.frame.width);
    const plan = planScene(document, slideId, variant.id), group = plan.nodes.find((n) => n.id === photoId);
    assert.equal(group.depthText.id, titleId); assert.ok(!plan.nodes.some((n) => n.id === titleId), "title renders exactly once inside its photo group");
    assert.ok(sceneWork(plan).transient > sceneWork(planScene(project, slideId, variant.id)).transient);
  }
});

test("looks and missing-mask fallback preserve title edits, while styles exclude private links", () => {
  const { project, photoId, slideId } = fixture(), document = apply(project, storyDepthCommand(project, photoId)), titleId = document.nodes[photoId].depthTextId;
  const looked = apply(document, storyLookCommand(document, "film-diary"));
  assert.equal(looked.nodes[photoId].depthTextId, titleId); assert.deepEqual(looked.nodes[titleId], document.nodes[titleId]);
  const removed = apply(document, storyMaskCommand(document, photoId, null));
  assert.equal(removed.nodes[photoId].maskId, undefined); assert.equal(removed.nodes[photoId].depthTextId, titleId); assert.deepEqual(removed.nodes[titleId], document.nodes[titleId]);
  const pending = planScene(removed, slideId).nodes.find((node) => node.id === photoId); assert.equal(pending.mask, undefined); assert.equal(pending.depthText.id, titleId);
  const repaired = apply(removed, storyMaskCommand(removed, photoId, mask)); assert.deepEqual(repaired.nodes[titleId], document.nodes[titleId]);
  const disabled = apply(document, storyDepthCommand(document, photoId, { enabled: false }));
  assert.equal(disabled.nodes[titleId], undefined); assert.equal(disabled.nodes[photoId].maskId, mask.id); assert.ok(disabled.nodes[`${slideId}:caption`]);
  const shared = serializeStyle(captureStoryStyle(document, slideId, "Colors", { look: true, text: true, layout: true, output: true }));
  assert.doesNotMatch(shared, /depthTextId|subject|photo-0|sha256/);
});
