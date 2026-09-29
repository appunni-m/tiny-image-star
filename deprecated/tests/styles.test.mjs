import test from "node:test";
import assert from "node:assert/strict";
import { clone, canonicalJSON, resolveSlide } from "../src/project/model.js";
import { applyProjectCommand, ProjectHistory } from "../src/project/history.js";
import { createPhotoStory, slidePhotos } from "../src/story/recipes.js";
import { adaptStoryLayoutCommand, positionStoryPhotoCommand, withStoryReflow } from "../src/story/layout.js";
import { captureStoryStyle, curatedStyles, parseStyle, serializeStyle, storyStyleCommand, styleCompatibility, styleFromLook, validateStyle } from "../src/styles/model.js";
import { storyDepthCommand } from "../src/story/depth.js";
import { createConnectedCutout } from "../src/story/connections.js";

const fixture = () => createPhotoStory(Array.from({ length: 8 }, (_, index) => ({ id: `private-photo-${index}`, kind: "image", name: `private-name-${index}.png`, type: "image/png",
  sha256: String(index).padStart(64, "a"), byteLength: 100, width: index % 2 ? 600 : 800, height: 800, orientation: "upright" })), { title: "PRIVATE CAPTION" });
const apply = (project, command) => applyProjectCommand(project, command).project;
const renderKey = (project, slide) => canonicalJSON(project.variants.map((variant) => resolveSlide(project, slide, variant.id)));

test("style capture exports only chosen reusable settings, with no photos, masks, captions, crops or node IDs", () => {
  const project = fixture(), slide = project.slides[0], photo = slidePhotos(project, slide.id)[0];
  project.assets["private-mask"] = { ...project.assets[photo.assetId], id: "private-mask", kind: "mask" }; photo.maskId = "private-mask";
  photo.crop = { x: .1, y: .2, width: .5, height: .6 }; photo.focal = { x: .2, y: .3 };
  slide.overrides[photo.id] = { appearance: { brightness: 1.37 } };
  const captured = captureStoryStyle(project, slide.id, "Warm mornings", { look: true, text: true, layout: true, output: true });
  const serialized = serializeStyle(captured), reopened = parseStyle(serialized);
  assert.deepEqual(reopened, captured);
  for (const secret of ["PRIVATE CAPTION", "private-photo", "private-name", "private-mask", slide.id, photo.id, "photoOrder", '"crop"', '"focal"', '"variantFrames"']) assert.equal(serialized.includes(secret), false, secret);
  assert.deepEqual(captured.assets, []); assert.equal(captured.components.look.appearance.brightness, 1.37);
  const outputOnly = captureStoryStyle(project, slide.id, "Tall exports", { output: true });
  assert.deepEqual(Object.keys(outputOnly.components), ["output"]);
  assert.throws(() => captureStoryStyle(project, slide.id, "Empty", {}), /at least one/);
});

test("single-slide layout styles cannot alter another slide's present or future reflow", () => {
  const project = fixture(), first = project.slides[0].id, other = project.slides[1].id;
  const style = captureStoryStyle(project, first, "Narrow borders", { look: true, text: true, layout: true });
  style.components.layout.margin = .1; style.components.layout.border = .006; style.components.layout.arrangement = "stack";
  style.components.text.caption.style.fontSize = .08;
  const before = renderKey(project, other), next = apply(project, storyStyleCommand(project, style, { slideId: first }));
  assert.notEqual(renderKey(next, first), renderKey(project, first));
  assert.equal(renderKey(next, other), before);
  const reflowedBefore = apply(project, adaptStoryLayoutCommand(project, other)), reflowedAfter = apply(next, adaptStoryLayoutCommand(next, other));
  assert.equal(renderKey(reflowedAfter, other), renderKey(reflowedBefore, other));
  assert.equal(captureStoryStyle(next, first, "Copy", { layout: true }).components.layout.border, .006, "capture uses slide-local constraints");
});

test("look strength has deterministic endpoints and preserves source-specific edits", () => {
  const project = fixture(), slide = project.slides[0], photo = slidePhotos(project, slide.id)[0];
  photo.crop = { x: .1, y: .1, width: .8, height: .8 }; photo.focal = { x: .2, y: .8 };
  project.assets.mask = { ...project.assets[photo.assetId], id: "mask", kind: "mask" }; photo.maskId = "mask";
  const style = curatedStyles().find((entry) => entry.id === "builtin:film-diary");
  const zero = apply(project, storyStyleCommand(project, style, { strength: 0 })), full = apply(project, storyStyleCommand(project, style));
  assert.deepEqual(zero.shared.appearance, { brightness: 1, contrast: 1, saturation: 1 });
  assert.deepEqual(full.shared.appearance, style.components.look.appearance);
  for (const key of ["crop", "focal", "maskId", "assetId", "variantFrames"]) assert.deepEqual(full.nodes[photo.id][key], photo[key]);
  assert.equal(full.nodes[`${slide.id}:caption`].text, "PRIVATE CAPTION");
  photo.appearance = { brightness: 1.4 }; slide.overrides[photo.id] = { appearance: { contrast: 1.1 } };
  const scoped = apply(project, storyStyleCommand(project, style, { slideId: slide.id }));
  const resolved = resolveSlide(scoped, slide.id).nodes.find((node) => node.id === photo.id);
  assert.deepEqual(resolved.appearance, { brightness: 1.4, contrast: 1.1, saturation: .76 }, "manual corrections resolve after the scoped look");
  const changedScope = apply(scoped, storyStyleCommand(scoped, curatedStyles()[2], { slideId: slide.id }));
  assert.equal(resolveSlide(changedScope, slide.id).nodes.find((node) => node.id === photo.id).appearance.saturation, 1, "a second scoped look replaces the prior look base");
  assert.deepEqual(styleFromLook(project.recipe.definition), curatedStyles()[0], "applied old-style definitions map to the same immutable built-in revision");
});

test("layout application keeps manual positions by default; explicit reset preserves crop/appearance/text overrides", () => {
  const initial = fixture(), slide = initial.slides[0].id, photo = slidePhotos(initial, slide)[0];
  const project = apply(initial, positionStoryPhotoCommand(initial, slide, "tall", photo.id, { x: .25, y: .55, scale: .8 }));
  project.slides[0].overrides[photo.id].crop = { x: .1, y: .1, width: .8, height: .8 };
  project.slides[0].overrides[photo.id].appearance = { contrast: 1.1 };
  project.slides[0].overrides[`${slide}:caption`] = { text: "Private local words" };
  const style = captureStoryStyle(project, slide, "Framing", { layout: true }); style.components.layout.arrangement = "stack";
  const kept = apply(project, storyStyleCommand(project, style)), reset = apply(project, storyStyleCommand(project, style, { keepPositions: false }));
  assert.deepEqual(kept.slides[0].overrides, project.slides[0].overrides);
  assert.deepEqual(reset.slides[0].overrides[photo.id], { crop: { x: .1, y: .1, width: .8, height: .8 }, appearance: { contrast: 1.1 } });
  assert.deepEqual(reset.slides[0].overrides[`${slide}:caption`], { text: "Private local words" });
});

test("style previews produce one undo and copy the immutable definition through serialization", () => {
  const project = fixture(), history = new ProjectHistory(project), style = captureStoryStyle(project, project.slides[0].id, "My type", { text: true, output: true });
  style.components.output = { variant: "tall", format: "png" }; style.requires = style.requires.filter((entry) => entry !== "jpeg-output").concat("png-output");
  style.components.text.caption.style.fontSize = .1;
  const original = clone(style);
  for (const choice of [curatedStyles()[1], curatedStyles()[2], style]) { history.cancel(); history.preview(storyStyleCommand(history.document, choice)); }
  history.commit("Choose style"); assert.equal(history.past.length, 1);
  style.components.text.caption.style.fontSize = .02;
  assert.deepEqual(history.document.recipe.style.definition, original);
  const serialized = JSON.parse(JSON.stringify(history.document));
  for (const slide of project.slides) assert.equal(renderKey(serialized, slide.id), renderKey(history.document, slide.id));
  assert.equal(serialized.recipe.outputVariant, "tall"); assert.equal(serialized.recipe.outputFormat, "png");
  history.undo(); assert.deepEqual(history.document.nodes, project.nodes); assert.deepEqual(history.document.recipe, project.recipe);
  history.redo(); history.preview(storyStyleCommand(history.document, curatedStyles()[2])); history.cancel(); assert.deepEqual(history.document.recipe.style.definition, original);
});

test("custom fonts and unrecognized layouts require an explicit supported alternative when saving", () => {
  const project = fixture(), slide = project.slides[0].id;
  project.assets.font = { id: "font", kind: "font", name: "Private font", type: "font/ttf", byteLength: 100, sha256: "f".repeat(64), orientation: "upright" };
  project.nodes[`${slide}:caption`].fontId = "font";
  assert.throws(() => captureStoryStyle(project, slide, "Private type", { text: true }), /licensed asset pack/);
  assert.doesNotThrow(() => captureStoryStyle(project, slide, "Color only", { look: true }));
  project.recipe.layout.version = 999;
  assert.throws(() => captureStoryStyle(project, slide, "Unknown layout", { layout: true }), /preserved/);
});

test("unsupported requirements and engines import as identifiable styles but cannot be applied", () => {
  const project = fixture(), style = captureStoryStyle(project, project.slides[0].id, "Future style");
  style.requires.push("portrait-segmentation-v99"); const loaded = parseStyle(serializeStyle(style));
  assert.match(styleCompatibility(loaded, project), /portrait-segmentation-v99/);
  assert.throws(() => storyStyleCommand(project, loaded), /Unavailable requirement/);
  loaded.requires.pop(); loaded.engine.versions = ["99.0.0"];
  assert.match(styleCompatibility(loaded, project), /different renderer/);
  assert.throws(() => storyStyleCommand(project, loaded), /different renderer/);
});

test("malformed imports reject executable, remote, private, oversized and out-of-range content", () => {
  const base = curatedStyles()[0];
  for (const mutate of [
    (s) => { s.components.look.appearance.brightness = 5; }, (s) => { s.components.look.appearance.saturation = NaN; },
    (s) => { s.components.look.crop = { x: 0 }; }, (s) => { s.components.look.text = "Private words"; },
    (s) => { s.assets = [{ url: "https://example.com/image.png" }]; }, (s) => { s.script = "alert(1)"; },
    (s) => { s.components.look.appearance.bytes = new Uint8Array(4); }, (s) => { s.run = () => {}; },
    (s) => { s.version = 9; }, (s) => { s.revision = 1.5; }, (s) => { s.requires = []; }, (s) => { s.controls = []; },
    (s) => { s.components = {}; }, (s) => { s.engine.versions = []; }, (s) => { s.supported.photoCounts.min = 0; },
  ]) { const style = clone(base); mutate(style); assert.throws(() => validateStyle(style)); }
  assert.throws(() => parseStyle('{"__proto__":{"x":true}}'), /Unsafe/);
  assert.throws(() => parseStyle(" ".repeat(32769)), /32 KiB/); assert.throws(() => parseStyle("not JSON"), /not valid/);
  assert.equal({}.x, undefined);
});

test("text-only styles reflow the selected slide while keeping old static stories static", () => {
  const project = fixture(), slide = project.slides[0].id, style = captureStoryStyle(project, slide, "Large captions", { text: true });
  style.components.text.caption.style.fontSize = .12;
  const next = apply(project, storyStyleCommand(project, style, { slideId: slide }));
  assert.notDeepEqual(next.nodes[`${slide}:caption`].variantFrames, project.nodes[`${slide}:caption`].variantFrames);
  for (const other of project.slides.slice(1)) assert.equal(renderKey(project, other.id), renderKey(next, other.id));
  const old = clone(project); old.recipe.layout = "paper-prints-v1";
  for (const node of Object.values(old.nodes)) delete node.variantFrames;
  const staticResult = apply(old, storyStyleCommand(old, style));
  assert.equal(staticResult.recipe.layout, "paper-prints-v1");
  assert.deepEqual(staticResult.nodes[`${slide}:photo-0`], old.nodes[`${slide}:photo-0`]);
});

function depthFixture() {
  let project = fixture(); const slideId = project.slides[0].id, photoId = slidePhotos(project, slideId)[0].id;
  project.assets["private-mask"] = { ...project.assets[project.nodes[photoId].assetId], id: "private-mask", kind: "mask" };
  project.nodes[photoId].maskId = "private-mask";
  project = apply(project, storyDepthCommand(project, photoId, { background: "page" }));
  const title = project.nodes[project.nodes[photoId].depthTextId];
  title.text = "PRIVATE DEPTH WORDS"; title.frame = { x: .08, y: .24, width: .84, height: .4 };
  title.style = { ...title.style, builtinFont: "system-serif", fontSize: .21 }; title.color = "#123456";
  return { project, slideId, photoId, titleId: title.id };
}

test("depth styles capture bounded relative settings without private words, masks, identities or font assets", () => {
  const { project, slideId, photoId, titleId } = depthFixture();
  const style = captureStoryStyle(project, slideId, "My depth type", { depthTitle: true, depthPhotoId: photoId });
  const serialized = serializeStyle(style);
  assert.deepEqual(parseStyle(serialized), style);
  assert.deepEqual(Object.keys(style.components), ["depthTitle"]);
  assert.deepEqual(style.components.depthTitle, { schema: 1, background: "page", frame: project.nodes[titleId].frame,
    style: project.nodes[titleId].style, color: "#123456" });
  assert.ok(style.requires.includes("depth-title-v1")); assert.deepEqual(style.controls, []);
  for (const secret of ["PRIVATE", "private-photo", "private-name", "private-mask", slideId, photoId, titleId, '"text"', '"maskId"', '"crop"']) assert.ok(!serialized.includes(secret), secret);
  project.slides[0].overrides[titleId] = { variantFrames: { portrait: { x: .1, y: .2, width: .9, height: .5 } }, text: "PRIVATE OVERRIDE" };
  assert.deepEqual(captureStoryStyle(project, slideId, "Moved type", { depthTitle: true, depthPhotoId: photoId }).components.depthTitle.frame,
    project.slides[0].overrides[titleId].variantFrames.portrait, "capture keeps photo-relative coordinates, not the resolved canvas box");
  project.assets.font = { id: "font", kind: "font", name: "Private font", type: "font/ttf", byteLength: 100, sha256: "f".repeat(64), orientation: "upright" };
  project.nodes[titleId].fontId = "font";
  assert.throws(() => captureStoryStyle(project, slideId, "Private font", { depthTitle: true, depthPhotoId: photoId }), /licensed asset pack/);
});

test("depth style applies once to selected masked photos, preserves words and repairs, and reports incompatible scope", () => {
  const { project, slideId, photoId } = depthFixture();
  const style = captureStoryStyle(project, slideId, "My depth type", { depthTitle: true, depthPhotoId: photoId });
  const targetSlide = project.slides[1].id, targetPhoto = slidePhotos(project, targetSlide)[0].id;
  project.nodes[targetPhoto].maskId = "private-mask"; project.nodes[targetPhoto].crop = { x: .1, y: .2, width: .7, height: .6 };
  project.nodes[targetPhoto].focal = { x: .2, y: .3 }; project.nodes[targetPhoto].appearance = { brightness: 1.2 };
  const next = apply(project, storyStyleCommand(project, style, { slideId: targetSlide }));
  const title = next.nodes[next.nodes[targetPhoto].depthTextId];
  assert.equal(title.text, project.name, "new words come from the destination story, never the style author");
  assert.deepEqual(title.style, style.components.depthTitle.style); assert.equal(title.color, "#123456");
  assert.deepEqual(title.frame, style.components.depthTitle.frame); assert.equal(next.nodes[targetPhoto].depthBackground, "page");
  for (const key of ["assetId", "maskId", "crop", "focal", "appearance", "variantFrames"]) assert.deepEqual(next.nodes[targetPhoto][key], project.nodes[targetPhoto][key]);
  assert.equal(renderKey(next, slideId), renderKey(project, slideId));
  for (const node of Object.values(next.nodes).filter((node) => node.kind === "image" && !node.maskId)) assert.equal(node.depthTextId, undefined);
  assert.match(styleCompatibility(style, project, null, project.slides[3].id), /subject.*this slide/i);
  assert.throws(() => storyStyleCommand(project, style, { slideId: project.slides[3].id }), /subject.*this slide/i);
  const bare = fixture(); assert.match(styleCompatibility(style, bare), /subject/);
});

test("depth styles keep existing words and positions by default, offer explicit reset, and undo as one change", () => {
  const { project, slideId, photoId, titleId } = depthFixture();
  const style = captureStoryStyle(project, slideId, "My depth type", { depthTitle: true, depthPhotoId: photoId });
  project.nodes[titleId].frame.y = .5; project.nodes[titleId].color = "#abcdef";
  project.nodes[titleId].variantFrames = { tall: { x: .15, y: .1, width: .7, height: .5 } };
  project.slides[0].overrides[titleId] = { frame: { x: .1, y: .15, width: .8, height: .3 }, text: "Keep local words", opacity: .8 };
  const kept = apply(project, storyStyleCommand(project, style, { slideId }));
  assert.deepEqual(kept.nodes[titleId].frame, project.nodes[titleId].frame);
  assert.deepEqual(kept.nodes[titleId].variantFrames, project.nodes[titleId].variantFrames);
  assert.deepEqual(kept.slides[0].overrides[titleId], project.slides[0].overrides[titleId]);
  const history = new ProjectHistory(project);
  history.preview(storyStyleCommand(project, style, { slideId, keepPositions: false })); history.commit("Apply depth style");
  assert.equal(history.past.length, 1); assert.deepEqual(history.document.nodes[titleId].frame, style.components.depthTitle.frame);
  assert.equal(history.document.nodes[titleId].variantFrames, undefined);
  assert.deepEqual(history.document.slides[0].overrides[titleId], { text: "Keep local words", opacity: .8 });
  assert.equal(history.document.nodes[titleId].text, "PRIVATE DEPTH WORDS");
  style.components.depthTitle.style.fontSize = .4;
  assert.equal(history.document.recipe.slideStyles[slideId].definition.components.depthTitle.style.fontSize, .21);
  const rendered = renderKey(history.document, slideId);
  history.undo(); assert.equal(renderKey(history.document, slideId), renderKey(project, slideId));
  history.redo(); assert.equal(renderKey(history.document, slideId), rendered);
  assert.equal(renderKey(JSON.parse(JSON.stringify(history.document)), slideId), rendered);
});

test("depth style scope updates both halves of a connected subject and creates one shared title", () => {
  let { project, slideId, photoId } = depthFixture();
  const style = captureStoryStyle(project, slideId, "My depth type", { depthTitle: true, depthPhotoId: photoId });
  project = apply(project, storyDepthCommand(project, photoId, { enabled: false }));
  const connected = createConnectedCutout(project, photoId, slideId); project = apply(project, connected.command);
  const second = project.nodes[connected.id].connection.rightSlideId;
  const next = apply(project, storyStyleCommand(project, style, { slideId: second }));
  const titleId = next.nodes[connected.id].depthTextId;
  assert.ok(titleId); assert.equal(next.nodes[photoId].depthTextId, undefined);
  assert.equal(Object.values(next.nodes).filter((node) => node.id === titleId).length, 1);
  for (const slide of next.slides.slice(0, 2)) assert.equal(slide.nodeIds.indexOf(titleId), slide.nodeIds.indexOf(connected.id) + 1);
  const all = apply(project, storyStyleCommand(project, style));
  for (const slide of all.slides.slice(0, 2)) assert.equal(slide.nodeIds.filter((id) => id === all.nodes[connected.id].depthTextId).length, 1);
});

test("depth style imports reject private fields, remote fonts, missing capabilities and invalid placement or type", () => {
  const { project, slideId, photoId } = depthFixture();
  const style = captureStoryStyle(project, slideId, "My depth type", { depthTitle: true, depthPhotoId: photoId });
  for (const mutate of [(s) => s.components.depthTitle.text = "secret", (s) => s.components.depthTitle.maskId = "secret",
    (s) => s.components.depthTitle.fontId = "remote", (s) => s.components.depthTitle.schema = 99,
    (s) => s.components.depthTitle.frame.width = 100, (s) => s.components.depthTitle.frame.x = -.51,
    (s) => s.components.depthTitle.style.fontBasis = "height", (s) => s.components.depthTitle.style.fontSize = 5,
    (s) => s.components.depthTitle.style.shadow.blur = 3, (s) => s.components.depthTitle.background = "url(https://example.com)",
    (s) => s.components.depthTitle.color = "red", (s) => s.requires = ["scene-v1"]]) {
    const value = clone(style); mutate(value); assert.throws(() => validateStyle(value));
  }
});
