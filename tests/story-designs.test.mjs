import test from "node:test";
import assert from "node:assert/strict";
import { canonicalJSON, clone, resolveSlide, validateProject } from "../src/project/model.js";
import { applyProjectCommand, ProjectHistory } from "../src/project/history.js";
import { createPhotoStory, moveStorySlide } from "../src/story/recipes.js";
import { captureStoryStyle, curatedStoryStyles, curatedStyles, parseStyle, serializeStyle, storyStyleCommand, styleCompatibility, validateStyle } from "../src/styles/model.js";
import { authoredStoryDesigns, validateStoryDesign } from "../src/story/designs.js";
import { positionStoryPhotoCommand, reviewStoryLayout, withStoryReflow } from "../src/story/layout.js";
import { storyMaskCommand } from "../src/story/masks.js";
import { storyDepthCommand } from "../src/story/depth.js";

const apply = (project, command) => applyProjectCommand(project, command).project;
function fixture(count = 6, ratios = [.75, 4 / 3]) {
  return createPhotoStory(Array.from({ length: count }, (_, i) => ({ id: `source-${i}`, kind: "image", name: `Private source ${i}`, type: "image/png",
    width: Math.round(800 * ratios[i % ratios.length]), height: 800, byteLength: 100, sha256: i.toString(16).padStart(64, "0"), orientation: "upright" })), { title: "Our summer" });
}
const photoId = (project, slide = project.slides[0]) => slide.nodeIds.find((id) => project.nodes[id].kind === "image" && !project.nodes[id].connection);
function masked(project, id = photoId(project)) {
  const source = project.assets[project.nodes[id].assetId];
  return apply(project, storyMaskCommand(project, id, { ...source, id: `mask-${source.id}`, kind: "mask", sha256: "f".repeat(64) }));
}
const key = (project) => canonicalJSON(project.slides.map((slide) => project.variants.map((variant) => resolveSlide(project, slide.id, variant.id))));

test("three frozen story recipes remain separate from the existing color-look revisions", () => {
  const before = curatedStyles(), styles = curatedStoryStyles();
  assert.deepEqual(styles.map((s) => s.id), ["builtin:story-scrapbook", "builtin:story-depth-cover", "builtin:story-film-diary"]);
  for (const style of styles) { validateStyle(style); assert.deepEqual(parseStyle(serializeStyle(style)), style); assert.ok(style.requires.includes("story-design-v1")); }
  styles[0].components.storyDesign.roles.cover.caption.fontSize = .12;
  assert.equal(curatedStoryStyles()[0].components.storyDesign.roles.cover.caption.fontSize, .1);
  assert.deepEqual(curatedStyles(), before);
  assert.notEqual(canonicalJSON(styles[0].components.storyDesign), canonicalJSON(styles[2].components.storyDesign));
});

test("all recipes preserve every photo and caption across counts, orientations and both output shapes", () => {
  for (let count = 6; count <= 12; count++) for (const ratios of [[.75], [4 / 3], [1], [.5, 2, 1, 3]]) {
    let project = masked(fixture(count, ratios));
    const captionId = `${project.slides[1].id}:caption`; project.nodes[captionId].text = "A longer note for a day we want to remember. ".repeat(4);
    for (const style of curatedStoryStyles()) {
      const next = apply(project, storyStyleCommand(project, style)); validateProject(next);
      assert.equal(next.slides.length, project.slides.length);
      assert.deepEqual(Object.values(next.nodes).filter((n) => n.kind === "image").map((n) => n.assetId).sort(), Object.keys(project.assets).filter((id) => project.assets[id].kind === "image").sort());
      assert.equal(next.nodes[captionId].text, project.nodes[captionId].text);
      assert.equal(next.recipe.storyDesign.roles[next.slides[0].id], "cover");
      assert.equal(next.recipe.storyDesign.roles[next.slides.at(-1).id], "closing");
      for (const slide of next.slides) for (const variant of next.variants) assert.deepEqual(reviewStoryLayout(next, slide.id, variant.id), [], `${count} ${ratios} ${style.id} ${variant.id}`);
      assert.equal(key(JSON.parse(JSON.stringify(next))), key(next));
    }
  }
});

test("photo decorations follow manual frames and rotation using photo-relative geometry", () => {
  let project = fixture(), id = photoId(project), slide = project.slides[0].id;
  project = apply(project, storyStyleCommand(project, curatedStoryStyles()[0]));
  const decoration = project.nodes[`${id}:design:tape`], stored = clone(decoration.frame);
  project = apply(project, positionStoryPhotoCommand(project, slide, "tall", id, { x: .3, y: .6, scale: .65 }));
  project.nodes[id].rotation = 27;
  const resolved = resolveSlide(project, slide, "tall"), photo = resolved.nodes.find((n) => n.id === id), tape = resolved.nodes.find((n) => n.id === decoration.id);
  const width = photo.viewport.width, height = photo.viewport.height, theta = 27 * Math.PI / 180;
  const center = [(stored.x + stored.width / 2) * width - width / 2, (stored.y + stored.height / 2) * height - height / 2];
  const expected = [photo.viewport.x + width / 2 + center[0] * Math.cos(theta) - center[1] * Math.sin(theta),
    photo.viewport.y + height / 2 + center[0] * Math.sin(theta) + center[1] * Math.cos(theta)];
  assert.ok(Math.abs(tape.viewport.x + tape.viewport.width / 2 - expected[0]) < 1e-8);
  assert.ok(Math.abs(tape.viewport.y + tape.viewport.height / 2 - expected[1]) < 1e-8);
  assert.equal(tape.rotation, 25); assert.equal(tape.viewport.width, stored.width * width);
  assert.deepEqual(project.nodes[decoration.id].frame, stored, "resolving does not rewrite the stored local box");
  const moved = apply(project, moveStorySlide(project, slide, 1));
  const movedNodes = resolveSlide(moved, slide, "tall").nodes;
  for (const node of [photo, tape]) assert.deepEqual(movedNodes.find((entry) => entry.id === node.id), node, "photo and decoration keep their appearance after reorder; page numbering changes");
});

test("recipe replacement removes only owned decorations and preserves local photo/word repairs through undo", () => {
  let project = masked(fixture()); const id = photoId(project), slide = project.slides[0].id;
  project = apply(project, storyStyleCommand(project, curatedStoryStyles()[0]));
  project = apply(project, positionStoryPhotoCommand(project, slide, "tall", id, { x: .4, y: .5, scale: .8 }));
  project.nodes[id].crop = { x: .1, y: .2, width: .8, height: .6 }; project.nodes[id].focal = { x: .3, y: .7 };
  project.slides[0].overrides[id].appearance = { brightness: 1.2 };
  project.slides[0].overrides[`${slide}:caption`] = { text: "Private local words" };
  const history = new ProjectHistory(project), styles = curatedStoryStyles();
  history.preview(storyStyleCommand(project, styles[2])); history.commit("Film diary");
  assert.equal(history.past.length, 1); assert.equal(history.document.nodes[`${id}:design:tape`], undefined);
  assert.equal(history.document.recipe.storyDesign.decorations.length, 6 * 8);
  assert.deepEqual(history.document.slides[0].overrides, project.slides[0].overrides);
  for (const field of ["assetId", "maskId", "crop", "focal"]) assert.deepEqual(history.document.nodes[id][field], project.nodes[id][field]);
  const after = key(history.document); history.undo(); assert.equal(key(history.document), key(project)); history.redo(); assert.equal(key(history.document), after);
  const reset = apply(project, storyStyleCommand(project, styles[2], { keepPositions: false }));
  assert.deepEqual(reset.slides[0].overrides[id], { appearance: { brightness: 1.2 } });
  assert.deepEqual(reset.slides[0].overrides[`${slide}:caption`], { text: "Private local words" });
});

test("Depth cover requires the cover mask, targets only that photo and preserves an existing title", () => {
  const style = curatedStoryStyles()[1]; let project = fixture(), first = photoId(project), second = photoId(project, project.slides[1]);
  assert.match(styleCompatibility(style, project), /cover subject/);
  project = masked(project, second); assert.match(styleCompatibility(style, project), /cover subject/);
  project = masked(project, first); project = apply(project, storyDepthCommand(project, first));
  const titleId = project.nodes[first].depthTextId; project.nodes[titleId].text = "Our private words";
  const next = apply(project, storyStyleCommand(project, style));
  assert.equal(next.nodes[titleId].text, "Our private words"); assert.equal(next.nodes[second].depthTextId, undefined);
  assert.equal(next.nodes[`${project.slides[0].id}:caption`].text, "Our summer");
  assert.throws(() => storyStyleCommand(project, style, { slideId: project.slides[0].id }), /whole story/);
  assert.ok(!serializeStyle(style).includes("Our private words"));
});

test("Depth cover fills the available frame in both shapes while preserving editable source crop and mask", () => {
  const project = masked(fixture()), id = photoId(project), slide = project.slides[0].id;
  project.nodes[id].crop = { x: .1, y: .1, width: .8, height: .8 };
  const next = apply(project, storyStyleCommand(project, curatedStoryStyles()[1]));
  assert.deepEqual(next.nodes[id].crop, project.nodes[id].crop); assert.equal(next.nodes[id].maskId, project.nodes[id].maskId);
  for (const variant of next.variants) {
    const photo = resolveSlide(next, slide, variant.id).nodes.find((node) => node.id === id);
    assert.ok(photo.viewport.height > variant.height * .73, "the hero cover uses the available vertical frame");
    assert.ok(photo.viewport.width > variant.width * .85);
  }
  const style = captureStoryStyle(next, slide, "Filled cover framing", { layout: true });
  assert.equal(style.components.layout.fit, "cover");
  assert.ok(style.requires.includes("photo-fill-v1"));
  const incomplete = clone(style); incomplete.requires = incomplete.requires.filter((value) => value !== "photo-fill-v1");
  assert.throws(() => validateStyle(incomplete), /capability/);
  const copied = apply(project, storyStyleCommand(project, parseStyle(serializeStyle(style)), { slideId: slide }));
  assert.equal(copied.recipe.layout.slides[slide].fit, "cover");
  const printed = apply(next, storyStyleCommand(next, curatedStoryStyles()[0]));
  assert.equal(printed.recipe.layout.slides[slide].fit, "contain", "another recipe restores whole-crop framing without changing crop data");
  assert.deepEqual(printed.nodes[id].crop, project.nodes[id].crop);
});

test("recipe color strength leaves layout, typography, captions and subject selection identical", () => {
  const project = masked(fixture());
  for (const style of curatedStoryStyles()) {
    const zero = apply(project, storyStyleCommand(project, style, { strength: 0 })), full = apply(project, storyStyleCommand(project, style, { strength: 1 }));
    assert.deepEqual(zero.nodes, full.nodes); assert.deepEqual(zero.slides, full.slides); assert.deepEqual(zero.assets, full.assets);
    assert.deepEqual(zero.shared.appearance, { brightness: 1, contrast: 1, saturation: 1 });
  }
});

test("new source reflow keeps decorations attached and old saved stories do not acquire a design", () => {
  const original = fixture(); const oldKey = key(original), id = photoId(original), slide = original.slides[0].id;
  let project = apply(original, storyStyleCommand(original, curatedStoryStyles()[2]));
  project = apply(project, withStoryReflow(project, { type: "node", id, value: { ...project.nodes[id], assetId: original.recipe.photoOrder[1] } }, slide));
  assert.equal(project.nodes[`${id}:design:hole-l-0`].attachment.imageId, id);
  assert.equal(key(original), oldKey); assert.equal(original.recipe.storyDesign, undefined);
  assert.equal(Object.values(original.nodes).filter((node) => node.attachment).length, 0);
  const stored = JSON.parse(JSON.stringify(project)), before = key(stored);
  authoredStoryDesigns()[2].design.roles.cover.layout.margin = .1;
  assert.equal(key(stored), before, "reopen/render uses saved graph and parameters");
});

test("untrusted designs and attachments cannot add executable fields, unbounded data or unrelated owners", () => {
  for (const change of [(d) => d.roles.body.layout.margin = .5, (d) => d.roles.cover.caption.fontSize = 12,
    (d) => d.roles.cover.caption.url = "https://example.com/font", (d) => d.roles.body.decoration = "script",
    (d) => d.roles.closing.extra = true, (d) => d.roles.cover.layout.tilt = 999, (d) => d.schema = 3]) {
    const design = authoredStoryDesigns()[0].design; change(design); assert.throws(() => validateStoryDesign(design));
  }
  const style = curatedStoryStyles()[0]; style.requires = style.requires.filter((capability) => capability !== "story-design-v1"); assert.throws(() => validateStyle(style), /capability/);
  const base = fixture(), project = apply(base, storyStyleCommand(base, curatedStoryStyles()[0]));
  const decoration = Object.values(project.nodes).find((node) => node.attachment);
  for (const change of [(node) => node.attachment.imageId = decoration.id, (node) => node.attachment.schema = 9,
    (node) => node.attachment.url = "https://example.com", (node) => node.space = "story"]) {
    const next = clone(project); change(next.nodes[decoration.id]); assert.throws(() => validateProject(next));
  }
  const broken = clone(project); broken.recipe.storyDesign.decorations = [`${broken.slides[0].id}:paper`];
  assert.throws(() => storyStyleCommand(broken, curatedStoryStyles()[2]), /unrelated artwork/);
});
