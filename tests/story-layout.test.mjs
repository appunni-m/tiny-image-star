import test from "node:test";
import assert from "node:assert/strict";
import { canonicalJSON, clone, createLegacyProject, resolveSlide, validateProject } from "../src/project/model.js";
import { applyProjectCommand, ProjectHistory } from "../src/project/history.js";
import { createPhotoStory, slidePhotos, storyLayoutCommand } from "../src/story/recipes.js";
import { adaptStoryLayoutCommand, hasAdaptiveLayout, positionStoryPhotoCommand, reviewStoryLayout, solveStoryLayout, validateStoryLayout, withStoryReflow } from "../src/story/layout.js";
import { imagePlacement } from "../src/compositor/scene-spec.js";

const assets = (count = 6, ratios = [3 / 4]) => Array.from({ length: count }, (_, index) => ({ id: `asset-${index}`, kind: "image", name: `Photo ${index}`,
  type: "image/png", sha256: index.toString(16).padStart(64, "0"), byteLength: 100, width: Math.round(800 * ratios[index % ratios.length]), height: 800, orientation: "upright" }));
const make = (count, ratios) => createPhotoStory(assets(count, ratios));
const key = (project, slide, variant) => canonicalJSON(resolveSlide(project, slide, variant));
const apply = (project, command) => applyProjectCommand(project, command).project;
const near = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-7, `${message}: ${a} vs ${b}`);

test("automatic layout actually changes the arrangement between portrait and tall", () => {
  const project = make(), slide = project.slides[1].id, photos = slidePhotos(project, slide);
  assert.equal(solveStoryLayout(project, slide, "portrait").arrangement, "row");
  assert.equal(solveStoryLayout(project, slide, "tall").arrangement, "stack");
  assert.notEqual(photos[0].variantFrames.portrait.x, photos[1].variantFrames.portrait.x);
  assert.equal(photos[0].variantFrames.tall.x, photos[1].variantFrames.tall.x);
  assert.notEqual(photos[0].variantFrames.tall.y, photos[1].variantFrames.tall.y);
});

test("an infeasible candidate does not discard another valid automatic arrangement", () => {
  const project = make(6, [1 / 800]), slide = project.slides[1].id;
  assert.equal(solveStoryLayout(project, slide, "portrait").arrangement, "row");
  assert.throws(() => adaptStoryLayoutCommand(project, slide, { arrangement: "stack" }), /too narrow/);
  assert.equal(project.recipe.layout.slides[slide].arrangement, "auto", "a failed explicit layout leaves the project intact");
});

test("every photo count and varied aspect/caption corpus fits rotated prints with consistent physical borders", () => {
  for (let count = 6; count <= 12; count++) for (const ratios of [[.75], [4 / 3], [1], [1 / 32, 32], [.5, 2, 1, 3]]) {
    const initial = make(count, ratios);
    for (const slide of initial.slides) {
      const captionId = `${slide.id}:caption`, caption = initial.nodes[captionId];
      const project = apply(initial, withStoryReflow(initial, { type: "node", id: captionId,
        value: { ...caption, text: "A long caption with a second line\n".repeat(count % 3 === 0 ? 12 : 1) } }, slide.id));
      const before = canonicalJSON(project);
      for (const variant of project.variants) {
        assert.deepEqual(reviewStoryLayout(project, slide.id, variant.id), [], `${count} ${ratios} ${variant.id}`);
        const solution = solveStoryLayout(project, slide.id, variant.id);
        for (const photo of slidePhotos(project, slide.id)) {
          const box = solution.frames[photo.id], border = solution.frames[photo.id.replace(":photo-", ":border-")], asset = project.assets[photo.assetId];
          near(box.width * variant.width / (box.height * variant.height), asset.width / asset.height, "upright source proportions");
          near((box.x - border.x) * variant.width, .014 * variant.width, "horizontal border");
          near((box.y - border.y) * variant.height, .014 * variant.width, "vertical border");
          const angle = Math.abs(photo.rotation) * Math.PI / 180;
          const extentX = (border.width * variant.width * Math.cos(angle) + border.height * variant.height * Math.sin(angle)) / 2;
          const extentY = (border.width * variant.width * Math.sin(angle) + border.height * variant.height * Math.cos(angle)) / 2;
          const cx = (border.x + border.width / 2) * variant.width, cy = (border.y + border.height / 2) * variant.height;
          assert.ok(cx - extentX >= .07 * variant.width - 1e-7 && cx + extentX <= .93 * variant.width + 1e-7);
          assert.ok(cy - extentY >= .13 * variant.width - 1e-7 && cy + extentY < variant.height - .07 * variant.width);
        }
      }
      assert.equal(canonicalJSON(project), before, "solving and reviewing do not mutate saved data");
    }
  }
});

test("output frames resolve with local precedence and invalidate only their own variant", () => {
  const project = make(), slide = project.slides[0], photo = slidePhotos(project, slide.id)[0];
  const portraitKey = key(project, slide.id, "portrait"), oldTall = key(project, slide.id, "tall");
  const after = apply(project, positionStoryPhotoCommand(project, slide.id, "tall", photo.id, { x: .4, y: .5, scale: .8 }));
  assert.equal(key(after, slide.id, "portrait"), portraitKey);
  assert.notEqual(key(after, slide.id, "tall"), oldTall);
  const custom = { x: .2, y: .2, width: .4, height: .4 };
  after.slides[0].overrides[photo.id].frame = custom;
  assert.deepEqual(resolveSlide(after, slide.id, "portrait").nodes.find((node) => node.id === photo.id).frame, custom);
  assert.notDeepEqual(resolveSlide(after, slide.id, "tall").nodes.find((node) => node.id === photo.id).frame, custom);
  const resolved = resolveSlide(after, slide.id, "tall").nodes.find((node) => node.id === photo.id);
  assert.equal(Object.hasOwn(resolved, "variantFrames"), false, "render keys have no unrelated geometry");
});

test("reflow preserves masks, crop rounding, captions, focal points and local appearance as one undo", () => {
  const project = make(), slide = project.slides[1], photo = slidePhotos(project, slide.id)[0];
  project.assets.mask = { ...project.assets[photo.assetId], id: "mask", kind: "mask" };
  photo.maskId = "mask"; photo.crop = { x: .113, y: .237, width: .413, height: .337 }; photo.focal = { x: .2, y: .8 };
  photo.appearance = { contrast: 1.2 }; slide.overrides[photo.id] = { appearance: { brightness: .9 } };
  const captionId = `${slide.id}:caption`; project.nodes[captionId].text = "Keep this caption";
  const history = new ProjectHistory(project), otherKeys = project.slides.filter((entry) => entry.id !== slide.id).map((entry) => key(project, entry.id, "portrait"));
  history.preview(adaptStoryLayoutCommand(history.document, slide.id, { arrangement: "stack" }));
  history.preview(storyLayoutCommand(history.document, slide.id, "straight")); history.commit("Arrange photos");
  const after = history.document.nodes[photo.id];
  for (const field of ["crop", "focal", "appearance", "maskId", "assetId"]) assert.deepEqual(after[field], photo[field]);
  assert.deepEqual(history.document.slides[1].overrides, slide.overrides); assert.equal(history.document.nodes[captionId].text, "Keep this caption");
  for (const variant of project.variants) {
    const rendered = resolveSlide(history.document, slide.id, variant.id).nodes.find((entry) => entry.id === photo.id);
    const box = imagePlacement(rendered, project.assets[photo.assetId].width, project.assets[photo.assetId].height).box;
    near(rendered.viewport.width / rendered.viewport.height, (box.right - box.left) / (box.bottom - box.top), "source pixel rounding matches renderer");
  }
  assert.deepEqual(history.document.slides.filter((entry) => entry.id !== slide.id).map((entry) => key(history.document, entry.id, "portrait")), otherKeys);
  assert.equal(history.past.length, 1); history.undo(); assert.deepEqual(history.document.nodes, project.nodes);
  history.redo(); history.preview(adaptStoryLayoutCommand(history.document, slide.id, { arrangement: "row" })); history.cancel();
  assert.deepEqual(history.document.nodes[photo.id], after);
});

test("manual positions survive replacement/reflow; explicit reset removes only position overrides", () => {
  const project = make(6, [.75, .75, .75, .75, 2]), slide = project.slides[1], photo = slidePhotos(project, slide.id)[0];
  let changed = apply(project, positionStoryPhotoCommand(project, slide.id, "portrait", photo.id, { x: .02, y: .9, scale: 1.3 }));
  changed.slides[1].overrides[photo.id].crop = { x: .1, y: .1, width: .8, height: .8 };
  changed.slides[1].overrides[photo.id].appearance = { saturation: .7 };
  changed.slides[1].overrides[`${slide.id}:caption`] = { text: "Local words", opacity: .9 };
  const manual = clone(changed.slides[1].overrides[photo.id].variantFrames);
  changed = apply(changed, withStoryReflow(changed, { type: "node", id: photo.id, value: { ...changed.nodes[photo.id], assetId: "asset-4" } }, slide.id));
  assert.deepEqual(changed.slides[1].overrides[photo.id].variantFrames, manual);
  assert.ok(reviewStoryLayout(changed, slide.id, "portrait").some((warning) => warning.code === "LAYOUT_CLIPPED"));
  const references = Object.fromEntries(resolveSlide(changed, slide.id, "portrait").nodes.map((node) => [node.id, node.frame]));
  const moved = apply(changed, positionStoryPhotoCommand(changed, slide.id, "portrait", photo.id, { x: .3, y: .5, scale: 1 }, references));
  assert.equal(moved.slides[1].overrides[photo.id].variantFrames.portrait.width, manual.portrait.width, "moving an existing override preserves its shape");
  assert.equal(moved.slides[1].overrides[photo.id].variantFrames.portrait.height, manual.portrait.height);
  const twice = apply(moved, positionStoryPhotoCommand(moved, slide.id, "portrait", photo.id, { x: .3, y: .5, scale: .8 }, references));
  near(twice.slides[1].overrides[photo.id].variantFrames.portrait.width, manual.portrait.width * .8, "gesture scaling is relative to opening frames");
  const reset = apply(changed, adaptStoryLayoutCommand(changed, slide.id, { resetPositions: true }));
  assert.deepEqual(reset.slides[1].overrides[photo.id], { crop: { x: .1, y: .1, width: .8, height: .8 }, appearance: { saturation: .7 } });
  assert.deepEqual(reset.slides[1].overrides[`${slide.id}:caption`], { text: "Local words", opacity: .9 });
  assert.deepEqual(reviewStoryLayout(reset, slide.id, "portrait"), []);
});

test("replacing a portrait with landscape and extending a caption reflows only the dependent slide", () => {
  const project = make(6, [.75, .75, .75, 2]), slide = project.slides[1], photo = slidePhotos(project, slide.id)[0];
  const before = key(project, slide.id, "portrait");
  let changed = apply(project, withStoryReflow(project, { type: "node", id: photo.id, value: { ...photo, assetId: "asset-3" } }, slide.id));
  assert.notDeepEqual(changed.nodes[photo.id].variantFrames, photo.variantFrames);
  const id = `${slide.id}:caption`, prior = changed.nodes[id].variantFrames;
  changed = apply(changed, withStoryReflow(changed, { type: "node", id, value: { ...changed.nodes[id], text: "Longer words for the next chapter. ".repeat(12) } }, slide.id));
  assert.ok(changed.nodes[id].variantFrames.portrait.height > prior.portrait.height);
  assert.notEqual(key(changed, slide.id, "portrait"), before);
  for (const other of project.slides.filter((entry) => entry.id !== slide.id)) for (const variant of project.variants) assert.equal(key(changed, other.id, variant.id), key(project, other.id, variant.id));
});

test("old stories stay unchanged until explicit adaptation; reopening uses frozen frames", () => {
  const project = make(), slide = project.slides[0].id;
  project.recipe.layout = "paper-prints-v1";
  for (const node of Object.values(project.nodes)) { delete node.variantFrames; if (node.style) delete node.style.fontBasis; }
  const original = canonicalJSON(project);
  const roundtrip = JSON.parse(original);
  assert.equal(hasAdaptiveLayout(roundtrip, slide), false);
  for (const variant of project.variants) assert.equal(key(roundtrip, slide, variant.id), key(project, slide, variant.id));
  const adapted = apply(project, adaptStoryLayoutCommand(project, slide));
  assert.equal(hasAdaptiveLayout(adapted, slide), true);
  assert.equal(hasAdaptiveLayout(adapted, project.slides[1].id), false);
  assert.equal(canonicalJSON(project), original);
  const frozen = key(adapted, slide, "portrait");
  adapted.recipe.layout.version = 999;
  assert.equal(key(JSON.parse(JSON.stringify(adapted)), slide, "portrait"), frozen, "unknown solver versions can render frozen positions");
  assert.throws(() => adaptStoryLayoutCommand(adapted, slide), /preserved/);
});

test("malformed variant maps, sizing bases and layout definitions fail before editing", () => {
  const legacy = createLegacyProject({ files: [{ assetId: "source", nodeId: "image", name: "source.png", size: 100, width: 600, height: 800 }], operations: [{ format: "png" }] });
  legacy.nodes.image.variantFrames = {};
  assert.throws(() => validateProject(legacy), /Legacy image dimensions/);
  for (const mutate of [
    (p, id) => { p.nodes[id].variantFrames.unknown = p.nodes[id].frame; },
    (p, id) => { p.nodes[id].variantFrames.tall.width = -1; },
    (p, id) => { p.nodes[id].variantFrames = []; },
    (p, id) => { p.slides[0].overrides[id] = { variantFrames: { missing: p.nodes[id].frame } }; },
    (p) => { p.nodes[`${p.slides[0].id}:caption`].style.fontBasis = "screen"; },
  ]) { const project = make(); mutate(project, slidePhotos(project, project.slides[0].id)[0].id); assert.throws(() => validateProject(project)); }
  for (const mutate of [
    (p) => { p.recipe.layout.border = Infinity; }, (p) => { p.recipe.layout.execute = "anything"; },
    (p) => { p.recipe.layout.slides[p.slides[0].id].photos[0].borderId = `${p.slides[1].id}:border-0`; },
    (p) => { p.recipe.layout.slides[p.slides[0].id].arrangement = "random"; },
  ]) { const project = make(); mutate(project); assert.throws(() => validateStoryLayout(project)); }
});
