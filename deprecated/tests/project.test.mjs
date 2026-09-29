import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createLegacyProject, createSceneProject, validateProject, canonicalJSON, resolveSlide, affectedSlides, LEGACY_ORDER, ENGINE_IDENTITY, LEGACY_ENGINE_IDENTITY, upgradeProjectRenderer, assertEngineCompatibility } from "../src/project/model.js";
import { planScene, imagePlacement } from "../src/compositor/scene-spec.js";
import { createPhotoStory, storyLookCommand, storyLayoutCommand, slidePhotos, moveStorySlide } from "../src/story/recipes.js";
import { ProjectHistory, applyProjectCommand, MAX_HISTORY_COMMANDS } from "../src/project/history.js";
import * as pillow from "../wasm/pillow_rs_js.js";
import { renderWithApi, runtimeCapabilities } from "../src/engine/pillow.js";

const fixture = () => createLegacyProject({ id: "project-test", files: [{ name: "source.jpg", size: 12, width: 300, height: 200,
  assetId: "source", nodeId: "image", slideId: "one" }], operations: [{ rotation: 90, crop: { x: 3.25, y: 1.75, width: 121.5, height: 80.25 }, brightness: 1, contrast: 1, format: "png" }] });
const edit = (history, brightness) => ({ type: "node", id: "image", value: { ...history.document.nodes.image, operations: { ...history.document.nodes.image.operations, brightness } } });

test("project renderer identity matches the actual pinned runtime bytes", async () => {
  for (const [filename, expected] of [["pillow_rs_js.js", ENGINE_IDENTITY.javascriptSha256], ["pillow_rs_js_bg.wasm", ENGINE_IDENTITY.wasmSha256]]) {
    const bytes = await readFile(new URL(`../wasm/${filename}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected);
  }
});

test("legacy migration preserves IDs, fractional pixel crops and exact transform order", () => {
  const project = fixture(), resolved = resolveSlide(project, "one");
  assert.deepEqual(resolved.nodes[0].operations.crop, { x: 3.25, y: 1.75, width: 121.5, height: 80.25 });
  assert.deepEqual(resolved.nodes[0].order, LEGACY_ORDER);
  assert.equal(project.assets.source.orientation, "exif-to-upright");
  assert.equal(canonicalJSON(JSON.parse(JSON.stringify(project))), canonicalJSON(project));
});

test("the shared text renderer upgrades only the known old identity and leaves original intent intact", () => {
  const original = fixture(); original.engine = structuredClone(LEGACY_ENGINE_IDENTITY);
  original.nodes.image.operations.textLayers = [{ id: "caption", text: "Keep my caption", fontId: "system-sans" }];
  const before = canonicalJSON(original);
  const upgraded = upgradeProjectRenderer(original);
  assert.equal(canonicalJSON(original), before, "migration never mutates the saved source");
  assert.deepEqual(upgraded.nodes, original.nodes);
  assert.deepEqual(upgraded.assets, original.assets);
  assert.deepEqual(upgraded.engine, ENGINE_IDENTITY);
  assert.equal(upgraded.revision, original.revision + 1);
  assert.deepEqual(upgradeProjectRenderer(upgraded), upgraded, "migration is idempotent");
  assert.throws(() => assertEngineCompatibility(original), /different renderer/);
  original.engine.compositor = "future-unknown";
  assert.throws(() => upgradeProjectRenderer(original), /different renderer/);
});

test("serialized projects preserve exact PNG and JPEG output bytes through the published engine", async () => {
  await pillow.default({ module_or_path: await readFile(new URL("../wasm/pillow_rs_js_bg.wasm", import.meta.url)) });
  const bytes = Buffer.from((await readFile(new URL("fixtures/rgb-small.png.base64", import.meta.url), "utf8")).trim(), "base64");
  const capabilities = runtimeCapabilities(pillow);
  for (const format of ["png", "jpeg"]) {
    const operations = { crop: { x: 1.25, y: .5, width: 4.5, height: 6 }, rotation: 90, flipX: true, flipY: false,
      resizeWidth: 4, resizeHeight: 6, resizeMode: "fit", brightness: 1.2, contrast: .9, grayscale: false, format };
    const source = { id: "image", name: "source.png", bytes };
    const before = await renderWithApi(pillow, source, operations, capabilities);
    const project = createLegacyProject({ files: [{ name: source.name, bytes, width: 8, height: 8 }], operations: [operations] });
    const reopened = JSON.parse(JSON.stringify(project));
    const resolved = resolveSlide(reopened, reopened.slides[0].id).nodes[0].operations;
    const after = await renderWithApi(pillow, source, resolved, capabilities);
    assert.deepEqual(after.bytes, before.bytes, `${format} bytes remain exact across the project boundary`);
    assert.equal(after.width, before.width);
    assert.equal(after.height, before.height);
  }
});

test("many previews commit one reversible action and cancel restores the prior edit", () => {
  const history = new ProjectHistory(fixture());
  for (const value of [1.1, 1.2, 1.4, 1.5]) history.preview(edit(history, value));
  assert.equal(history.past.length, 0);
  history.commit("Look strength");
  assert.equal(history.past.length, 1);
  const revision = history.document.revision;
  history.undo();
  assert.equal(history.document.nodes.image.operations.brightness, 1);
  assert.ok(history.document.revision > revision);
  history.redo();
  assert.equal(history.document.nodes.image.operations.brightness, 1.5);
  history.preview(edit(history, 2));
  history.cancel();
  assert.equal(history.document.nodes.image.operations.brightness, 1.5);
  assert.equal(history.past.length, 1);
});

test("new edits discard redo; command history is bounded and contains no source data", () => {
  const history = new ProjectHistory(fixture());
  history.apply(edit(history, 1.4)); history.undo(); history.apply(edit(history, 1.3));
  assert.equal(history.redo(), false);
  for (let index = 0; index < 125; index++) history.apply(edit(history, index % 2 ? 1.2 : 1.4));
  assert.equal(history.past.length, MAX_HISTORY_COMMANDS);
  assert.equal(JSON.stringify(history.past).includes('"bytes"'), false);
  assert.equal(history.document.assets.source.id, "source");
});

test("shared appearance resolves before node settings and local overrides without removing crops/masks", () => {
  const project = fixture();
  project.assets.mask = { ...project.assets.source, id: "mask", kind: "mask", orientation: "upright" };
  project.nodes.image = { id: "image", kind: "image", assetId: "source", maskId: "mask", space: "slide",
    frame: { x: .1, y: .1, width: .8, height: .8 }, crop: { x: .2, y: .1, width: .5, height: .5 }, appearance: { contrast: 1.2 } };
  project.shared.appearance = { brightness: 1.1, contrast: 1.1 };
  project.slides[0].overrides.image = { appearance: { brightness: 1.3 } };
  const node = resolveSlide(project, "one").nodes[0];
  assert.deepEqual(node.appearance, { brightness: 1.3, contrast: 1.2 });
  assert.deepEqual(node.crop, project.nodes.image.crop);
  assert.equal(node.mask.id, "mask");
});

test("connected geometry resolves per viewport in both ratios and tracks its stable anchor on reorder", () => {
  const project = fixture();
  project.slides.push({ id: "two", name: "Second", nodeIds: ["image"], overrides: {} });
  project.nodes.image = { id: "image", kind: "image", assetId: "source", space: "story", anchorSlideId: "one",
    frame: { x: .8, y: .1, width: .4, height: .5 } };
  project.variants = [{ id: "portrait", width: 1080, height: 1350 }, { id: "tall", width: 1080, height: 1920 }];
  for (const variant of project.variants) {
    const left = resolveSlide(project, "one", variant.id).nodes[0].viewport;
    const right = resolveSlide(project, "two", variant.id).nodes[0].viewport;
    assert.ok(Math.abs(left.x - right.x - 1080) < 1e-9);
    assert.equal(left.width, right.width);
    assert.equal(left.height, variant.height * .5);
  }
  const reordered = applyProjectCommand(project, { type: "slides", value: [...project.slides].reverse() }).project;
  assert.equal(resolveSlide(reordered, "one", "portrait").nodes[0].viewport.x, 864);
  assert.equal(resolveSlide(reordered, "two", "portrait").nodes[0].viewport.x, 1944);
});

test("replacing a source invalidates only dependent slides and preserves unrelated local edits", () => {
  const before = fixture();
  before.assets.other = { ...before.assets.source, id: "other" };
  before.nodes.other = { ...before.nodes.image, id: "other", assetId: "other" };
  before.slides.push({ id: "two", name: "Second", nodeIds: ["other"], overrides: {} });
  const { project: after, inverse } = applyProjectCommand(before, { type: "asset", id: "source", value: { ...before.assets.source, sha256: "a".repeat(64) } });
  assert.deepEqual(affectedSlides(before, after), ["one"]);
  assert.deepEqual(after.nodes.other, before.nodes.other);
  assert.deepEqual(applyProjectCommand(after, inverse).project.assets, before.assets);
});

test("bad references, unknown schemas, code, remote assets and binary payloads are rejected", () => {
  for (const mutate of [
    (p) => { p.version = 99; }, (p) => { p.nodes.image.assetId = "missing"; },
    (p) => { p.nodes.image.operations.fn = () => {}; }, (p) => { p.assets.source.url = "https://example.com/private.png"; },
    (p) => { p.nodes.image.operations.bytes = new Uint8Array(4); },
    (p) => { p.nodes.image.operations.bytes = [1, 2, 3]; },
    (p) => { p.slides[0].nodeIds.push("image"); }, (p) => { p.shared.appearance = { brightness: Infinity }; },
  ]) { const project = fixture(); mutate(project); assert.throws(() => validateProject(project)); }
  const malicious = JSON.parse(JSON.stringify(fixture()));
  malicious.nodes.image.operations = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(() => validateProject(malicious));
  assert.equal({}.polluted, undefined);
});

test("scene styles reject unsupported operations and preview dimensions stay bounded", () => {
  const project = createSceneProject({ nodes: { title: { id: "title", kind: "text", space: "slide", frame: { x: .1, y: .1, width: .8, height: .2 }, text: "A caption", style: { fontSize: .06 } } } });
  const plan = planScene(project, project.slides[0].id, "tall", { preview: true });
  assert.equal(plan.outputHeight, 1280); assert.equal(plan.outputWidth, 720);
  const bad = (change) => { const copy = structuredClone(project); change(copy); assert.throws(() => validateProject(copy)); };
  bad((value) => { value.nodes.title.style.url = "https://example.com/font.ttf"; });
  bad((value) => { value.nodes.title.style.fontSize = Infinity; });
  bad((value) => { value.nodes.title.style.shadow = { blur: 10, x: 0, y: 0, color: "#000000" }; });
  bad((value) => { value.nodes.title.operations = { brightness: 2 }; });
  bad((value) => { value.slides[0].overrides.title = { crop: { x: 0, y: 0, width: 1, height: 1 } }; });
  assert.throws(() => planScene(project, project.slides[0].id, "tall", { previewEdge: 4000 }), /preview size/);
});

test("image placement preserves crop bounds, cover focal edges and clockwise rotation", () => {
  const node = { viewport: { x: 0, y: 0, width: 100, height: 100 }, focal: { x: 1, y: .5 } };
  const placed = imagePlacement(node, 200, 100);
  assert.deepEqual(placed.box, { left: 0, top: 0, right: 200, bottom: 100 });
  assert.deepEqual(placed.matrix, [1, 0, 100, -0, 1, 0], "right focal cover exposes the right square of a wide source");
  const rotated = imagePlacement({ ...node, rotation: 90, crop: { x: .1, y: .1, width: .5, height: .5 } }, 200, 100);
  assert.deepEqual(rotated.box, { left: 20, top: 10, right: 120, bottom: 60 });
  assert.ok(Math.abs(rotated.matrix[1] - .5) < 1e-9 && Math.abs(rotated.matrix[3] + .5) < 1e-9);
});

const storyAssets = (count) => Array.from({ length: count }, (_, index) => ({ id: `photo-${index}`, kind: "image", name: `Photo ${index}.png`, type: "image/png",
  byteLength: 100, sha256: index.toString(16).padStart(64, "0"), width: index % 2 ? 400 : 600, height: index % 2 ? 600 : 400, orientation: "upright" }));

test("the story assembler places every chosen photo exactly once at both count extremes and both ratios", () => {
  for (let count = 6; count <= 12; count++) {
    const assets = storyAssets(count), project = createPhotoStory(assets, { title: "A summer away" });
    assert.ok(project.slides.length >= 4 && project.slides.length <= 8);
    const placed = project.slides.flatMap((slide) => slidePhotos(project, slide.id).map((node) => node.assetId));
    assert.deepEqual(placed, assets.map((asset) => asset.id));
    for (const variant of project.variants) for (const slide of project.slides) assert.ok(planScene(project, slide.id, variant.id).nodes.length >= 5);
    assert.equal(project.recipe.definition.revision, 1); assert.equal(project.recipe.outputVariant, "portrait");
  }
  assert.throws(() => createPhotoStory(storyAssets(5)), /6–12/); assert.throws(() => createPhotoStory(storyAssets(13)), /6–12/);
});

test("story look strength and reversible layout changes preserve captions, sources, focal points and crops", () => {
  const project = createPhotoStory(storyAssets(8)), first = slidePhotos(project, project.slides[0].id)[0];
  first.crop = { x: .1, y: .1, width: .8, height: .8 }; first.focal = { x: .25, y: .75 };
  const history = new ProjectHistory(project), original = cloneForTest(project.nodes[first.id]);
  history.preview(storyLookCommand(history.document, "film-diary", .7));
  history.preview(storyLookCommand(history.document, "scrapbook", 0)); history.commit("Look");
  assert.deepEqual(history.document.shared.appearance, { brightness: 1, contrast: 1, saturation: 1 });
  assert.deepEqual(history.document.nodes[first.id], original); assert.equal(history.past.length, 1);
  history.undo(); assert.deepEqual(history.document.shared.appearance, project.shared.appearance);
  history.preview(storyLayoutCommand(history.document, project.slides[0].id, "straight"));
  assert.equal(history.document.nodes[first.id].rotation, 0); history.cancel();
  assert.deepEqual(history.document.nodes[first.id], original);
});

function cloneForTest(value) { return structuredClone(value); }

test("story reorder moves stable slides and updates numbering as one reversible command", () => {
  const project = createPhotoStory(storyAssets(6)), history = new ProjectHistory(project), first = project.slides[0].id;
  history.apply(moveStorySlide(project, first, 1), "Move slide");
  assert.equal(history.document.slides[1].id, first);
  assert.deepEqual(history.document.slides.map((slide) => history.document.nodes[`${slide.id}:number`].text), ["01", "02", "03", "04"]);
  assert.deepEqual(slidePhotos(history.document, first), slidePhotos(project, first));
  history.undo(); assert.deepEqual(history.document.slides, project.slides); assert.deepEqual(history.document.nodes, project.nodes);
});
