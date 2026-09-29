import assert from "node:assert/strict";
import { test } from "node:test";
import { dilateDisk, decorateDepthPixels } from "../src/compositor/cutout-effects.js";
import { validateCutoutEffects, cutoutEffectMetrics } from "../src/compositor/cutout-effects-spec.js";
import { createPhotoStory, slidePhotos } from "../src/story/recipes.js";
import { storyMaskCommand } from "../src/story/masks.js";
import { createConnectedCutout } from "../src/story/connections.js";
import { ProjectHistory, applyProjectCommand } from "../src/project/history.js";
import { clone, validateProject, canonicalJSON } from "../src/project/model.js";
import { planScene } from "../src/compositor/scene-spec.js";
import { sceneWork } from "../src/processing/policy.js";
import { captureStoryStyle, parseStyle, serializeStyle, storyStyleCommand, styleCompatibility, validateStyle } from "../src/styles/model.js";

const effects = { schema: 1, outline: { color: "#ffffff", width: .01 }, shadow: { color: "#142436", opacity: .4, blur: .015, x: -.02, y: .03 } };
const assets = Array.from({ length: 6 }, (_, i) => ({ id: `photo-${i}`, kind: "image", name: `Photo ${i}`, width: 100, height: 120, orientation: "upright", type: "image/png", byteLength: 100, sha256: "a".repeat(64) }));
const mask = { ...assets[0], id: "mask", kind: "mask", byteLength: 40, sha256: "b".repeat(64) };
const apply = (project, command) => applyProjectCommand(project, command).project;
function fixture() { let project = createPhotoStory(assets); const photoId = slidePhotos(project, project.slides[0].id)[0].id;
  project = apply(project, storyMaskCommand(project, photoId, mask)); return { project, photoId }; }

test("disk dilation agrees with an independent neighborhood oracle for soft masks, thin edges and transparent borders", () => {
  for (const [width, height] of [[1, 1], [1, 13], [17, 1], [13, 17]]) for (const radius of [0, 1, 2, 4, 8]) {
    const input = Uint8Array.from({ length: width * height }, (_, i) => i % 7 ? (i * 53 + 11) % 256 : 0), expected = new Uint8Array(input.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      for (let sy = 0; sy < height; sy++) for (let sx = 0; sx < width; sx++) if ((x - sx) ** 2 + (y - sy) ** 2 <= radius ** 2)
        expected[y * width + x] = Math.max(expected[y * width + x], input[sy * width + sx]);
    }
    assert.deepEqual(dilateDisk(input, width, height, radius), expected, `${width}×${height}, radius ${radius}`);
  }
  assert.deepEqual(dilateDisk(new Uint8Array(81), 9, 9, 4), new Uint8Array(81));
  const faint = new Uint8Array(81); faint[40] = 1;
  assert.equal(dilateDisk(faint, 9, 9, 2)[42], 1, "one-level soft coverage is preserved, not thresholded away");
});

test("depth decoration agrees with an independent three-layer composition and protects opaque subjects", () => {
  const rgba = (color, alpha) => [...color.map((c) => c * alpha), alpha];
  const over = (front, back) => front.map((value, index) => value + back[index] * (1 - front[3]));
  const straight = (value) => [...value.slice(0, 3).map((c) => value[3] ? Math.round(c / value[3]) : 0), Math.round(value[3] * 255)];
  for (const a of [0, 64, 128, 255]) for (const coverage of [0, 64, 192, 255]) for (const e of [0, 128, 255]) {
    const color = [40, 120, 210], ink = [200, 70, 30], f = Math.floor(a * coverage / 255), p = Uint8Array.from([...color, a]), s = Uint8Array.from([...color, f]);
    const decorated = decorateDepthPixels(p, s, Uint8Array.from([...ink, e]));
    const foreground = rgba(color, f / 255), effect = rgba(ink, e / 255), background = rgba(color, f === 255 ? 0 : (a - f) / (255 - f));
    const expectedPhoto = e ? straight(over(foreground, over(effect, background))) : [...color, a];
    const expectedSubject = e ? straight(over(foreground, effect)) : [...color, f];
    assert.deepEqual([...decorated.photo], expectedPhoto); assert.deepEqual([...decorated.subject], expectedSubject);
  }
});

test("effects persist through grouped history, connected copies, mask removal and reattachment", () => {
  const { project, photoId } = fixture(), history = new ProjectHistory(project);
  history.preview({ type: "node", id: photoId, value: { ...history.document.nodes[photoId], cutoutEffects: clone(effects) } });
  history.commit("Finish cutout"); const serialized = canonicalJSON({ ...history.document, revision: 0 }), revision = history.document.revision;
  history.undo(); assert.equal(history.document.nodes[photoId].cutoutEffects, undefined); history.redo();
  assert.ok(history.document.revision > revision); assert.equal(canonicalJSON({ ...history.document, revision: 0 }), serialized);
  const created = createConnectedCutout(history.document, photoId, history.document.slides[0].id);
  history.apply(created.command, "Connect"); assert.deepEqual(history.document.nodes[created.id].cutoutEffects, effects);
  history.apply(storyMaskCommand(history.document, created.id, null), "Remove mask");
  assert.deepEqual(history.document.nodes[created.id].cutoutEffects, effects);
  assert.equal(cutoutEffectMetrics(history.document.nodes[created.id], 1350).padding, 0);
  history.undo(); assert.ok(cutoutEffectMetrics(history.document.nodes[created.id], 1350).padding > 0);
  assert.deepEqual(history.document.nodes[photoId].cutoutEffects, effects);
});

test("schema rejects unsupported fields, non-image effects and unbounded or invalid parameters", () => {
  validateCutoutEffects(effects);
  for (const change of [(e) => e.schema = 2, (e) => e.outline.width = .021, (e) => e.outline.color = "red", (e) => e.shadow.blur = NaN,
    (e) => e.shadow.opacity = 1.1, (e) => e.shadow.x = -.051, (e) => e.shadow.y = Infinity, (e) => e.shadow.extra = true]) {
    const value = clone(effects); change(value); assert.throws(() => validateCutoutEffects(value), /Invalid cutout/);
  }
  const { project } = fixture(), shape = Object.values(project.nodes).find((node) => node.kind === "shape"); shape.cutoutEffects = effects;
  assert.throws(() => validateProject(project), /Only scene photos/);
});

test("planning includes off-page effect support and reserves padded rendering before admission", () => {
  const { project, photoId } = fixture(), slideId = project.slides[0].id, photo = project.nodes[photoId];
  project.variants = [{ id: "portrait", width: 100, height: 1000 }]; project.nodes = { [photoId]: photo };
  for (const slide of project.slides) slide.nodeIds = slide.id === slideId ? [photoId] : [];
  delete photo.variantFrames; photo.frame = { x: -.2, y: .2, width: .1, height: .2 }; photo.rotation = 0;
  const plain = planScene(project, slideId); assert.equal(plain.nodes.length, 0);
  photo.cutoutEffects = clone(effects); const decorated = planScene(project, slideId), cost = sceneWork(decorated);
  assert.equal(decorated.nodes.length, 1); assert.equal(decorated.assets.length, 2);
  assert.ok(cost.heap > sceneWork(plain).heap && cost.transient > sceneWork(plain).transient);
  const zero = clone(project); zero.nodes[photoId].cutoutEffects = { schema: 1, outline: { color: "#ffffff", width: 0 } };
  assert.equal(planScene(zero, slideId).nodes.length, 0);
});

test("reusable finishes share only effect parameters and apply to existing subject selections in scope", () => {
  const { project, photoId } = fixture(), first = project.slides[0].id, second = project.slides[1].id;
  project.nodes[photoId].cutoutEffects = clone(effects);
  const style = parseStyle(serializeStyle(captureStoryStyle(project, first, "My subject finish", { cutoutEffects: true, effectPhotoId: photoId })));
  assert.deepEqual(style.components, { cutoutEffects: effects }); assert.deepEqual(style.assets, []); assert.ok(style.requires.includes("cutout-effects-v1"));
  assert.ok(!serializeStyle(style).includes(photoId)); assert.ok(!serializeStyle(style).includes(mask.sha256));
  const other = slidePhotos(project, second)[0].id;
  const target = apply(project, storyMaskCommand(project, other, mask)); delete target.nodes[photoId].cutoutEffects;
  const local = apply(target, storyStyleCommand(target, style, { slideId: second }));
  assert.equal(local.nodes[photoId].cutoutEffects, undefined); assert.deepEqual(local.nodes[other].cutoutEffects, effects);
  assert.deepEqual(local.nodes[other].crop, target.nodes[other].crop); assert.equal(local.nodes[other].maskId, target.nodes[other].maskId);
  const all = apply(target, storyStyleCommand(target, style));
  assert.deepEqual(all.nodes[photoId].cutoutEffects, effects); assert.deepEqual(all.nodes[other].cutoutEffects, effects);
  for (const node of Object.values(all.nodes).filter((node) => node.kind === "image" && !node.maskId)) assert.equal(node.cutoutEffects, undefined);
  const missing = clone(style); missing.requires = missing.requires.filter((capability) => capability !== "cutout-effects-v1"); assert.throws(() => validateStyle(missing), /required capability/);
  const bare = createPhotoStory(assets); assert.match(styleCompatibility(style, bare), /Choose a subject/);
  assert.throws(() => storyStyleCommand(target, style, { slideId: target.slides[3].id }), /this slide/);
});
