import assert from "node:assert/strict";
import { test } from "node:test";
import { paintMask, validateMaskStroke, validateMaskRegion, maskWork } from "../src/compositor/mask-spec.js";
import { maskDetailRegion, maskSourcePoint, maskViewPoint } from "../src/story/mask-view.js";
import { createPhotoStory, slidePhotos, storyLookCommand } from "../src/story/recipes.js";
import { storyMaskCommand, pruneStorySources } from "../src/story/masks.js";
import { ProjectHistory, applyProjectCommand } from "../src/project/history.js";
import { captureStoryStyle, storyStyleCommand, curatedStyles, serializeStyle } from "../src/styles/model.js";

const stroke = { mode: "erase", radius: .25, hardness: 1, opacity: 1, points: [[.5, .5]] };
const assets = Array.from({ length: 6 }, (_, i) => ({ id: `source-${i}`, kind: "image", name: `Photo ${i}`, width: 40, height: 30, orientation: "upright", type: "image/png", byteLength: 12, sha256: "a".repeat(64) }));
const mask = { id: "subject", kind: "mask", name: "Subject", width: 40, height: 30, orientation: "upright", type: "image/png", byteLength: 8, sha256: "b".repeat(64) };

test("mask brushes preserve untouched pixels and support erase/restore with soft opacity", () => {
  const pixels = new Uint8Array(100).fill(255);
  paintMask(pixels, 10, 10, stroke);
  assert.equal(pixels[55], 0); assert.equal(pixels[0], 255);
  paintMask(pixels, 10, 10, { ...stroke, mode: "restore", opacity: .5 });
  assert.equal(pixels[55], 128); assert.equal(pixels[0], 255);
  const soft = paintMask(new Uint8Array(100).fill(255), 10, 10, { ...stroke, hardness: 0 });
  assert.ok(soft[55] > 0 && soft[55] < soft[56] && soft[56] < 255);
});

test("one stroke is independent of point density and retracing", () => {
  const render = (points) => paintMask(new Uint8Array(1600).fill(255), 40, 40, { ...stroke, opacity: .4, hardness: .3, points });
  const direct = render([[.25, .5], [.75, .5]]);
  assert.deepEqual(direct, render([[.25, .5], [.5, .5], [.75, .5], [.25, .5], [.75, .5]]));
});

test("a one-source-pixel brush can repair a large image without touching neighbors", () => {
  const width = 1600, height = 1200, pixels = new Uint8Array(width * height).fill(255);
  paintMask(pixels, width, height, { ...stroke, radius: .5 / height, points: [[701.5 / width, 401.5 / height]] });
  assert.equal(pixels[401 * width + 701], 0);
  assert.equal(pixels.filter((value) => value !== 255).length, 1);
});

test("detail areas preserve source coordinates at every zoom and edge, with bounded allocation", () => {
  for (const zoom of [1, 2, 4]) for (const center of [[0, 0], [1, 1], [.314, .739], [-4, 9]]) {
    const region = maskDetailRegion(4032, 3024, center, { width: 347, height: 218 }, zoom);
    validateMaskRegion(region, 4032, 3024);
    assert.equal(region.width, Math.floor(347 / zoom)); assert.equal(region.height, Math.floor(218 / zoom));
    for (const position of [[0, 0], [.5, .5], [1, 1]]) {
      const point = maskSourcePoint(region, 4032, 3024, ...position), back = maskViewPoint(region, 4032, 3024, point);
      back.forEach((value, i) => assert.ok(Math.abs(value - position[i]) < 1e-12));
    }
  }
  assert.deepEqual(maskDetailRegion(3, 2, [.5, .5], { width: 800, height: 220 }, 1), { x: 0, y: 0, width: 3, height: 2 });
  assert.deepEqual(maskDetailRegion(4032, 3024, [0, 0], { width: 10_000, height: 10_000 }, 1), { x: 0, y: 0, width: 1024, height: 1024 });
  for (const patch of [{ x: -1 }, { x: 3900 }, { y: 3024 }, { width: 0 }, { width: 1025 }, { height: 1.5 }, { arbitrary: 1 }]) {
    assert.throws(() => maskWork({ width: 4032, height: 3024, previewRegion: { x: 10, y: 10, width: 200, height: 200, ...patch } }), /detail area/);
  }
});

test("mask brush and memory bounds reject malformed work before allocation", () => {
  for (const patch of [{ mode: "execute" }, { radius: 0 }, { opacity: NaN }, { points: [[-1, .5]] }, { points: Array(513).fill([.5, .5]) }, { script: "x" }]) assert.throws(() => validateMaskStroke({ ...stroke, ...patch }));
  assert.throws(() => maskWork({ width: 10_000, height: 10_000 }), /dimensions/);
  assert.throws(() => maskWork({ width: 100, height: 100, encodedBytes: 200 * 1024 * 1024 }), /large/);
  const memory = maskWork({ width: 4000, height: 3000, encodedBytes: 4 * 1024 * 1024 });
  assert.ok(memory.heap > 12_000_000 * 24 && memory.transient > 12_000_000 * 3);
});

test("a cutout is one reversible asset edit and global looks preserve mask/crop", () => {
  const document = createPhotoStory(assets), photo = slidePhotos(document, document.slides[0].id)[0];
  photo.crop = { x: .1, y: .1, width: .8, height: .8 };
  const history = new ProjectHistory(document);
  history.apply(storyMaskCommand(document, photo.id, mask), "Cutout");
  assert.equal(history.document.nodes[photo.id].maskId, mask.id);
  const looked = applyProjectCommand(history.document, storyLookCommand(history.document, "film-diary")).project;
  assert.equal(looked.nodes[photo.id].maskId, mask.id); assert.deepEqual(looked.nodes[photo.id].crop, photo.crop);
  const styled = applyProjectCommand(history.document, storyStyleCommand(history.document, curatedStyles()[1])).project;
  assert.equal(styled.nodes[photo.id].maskId, mask.id); assert.deepEqual(styled.nodes[photo.id].crop, photo.crop);
  const shared = serializeStyle(captureStoryStyle(styled, styled.slides[0].id, "Reusable colors", { look: true, text: true, layout: true, output: true }));
  assert.doesNotMatch(shared, /maskId|subject|source-0|sha256|crop/);
  history.undo(); assert.equal(history.document.nodes[photo.id].maskId, undefined); assert.equal(history.document.assets[mask.id], undefined);
  history.redo(); assert.deepEqual(history.document.assets[mask.id], mask);
  assert.throws(() => storyMaskCommand(history.document, photo.id, { ...mask, width: 1 }), /upright/);
});

test("mask removal preserves shared assets and bounded history keeps undo dependencies", () => {
  const document = createPhotoStory(assets), first = slidePhotos(document, document.slides[0].id)[0], second = slidePhotos(document, document.slides[1].id)[0];
  const history = new ProjectHistory(document);
  history.apply(storyMaskCommand(history.document, first.id, mask));
  history.apply(storyMaskCommand(history.document, second.id, mask));
  history.apply(storyMaskCommand(history.document, first.id, null));
  assert.deepEqual(history.document.assets[mask.id], mask, "another photo still uses the mask");
  history.apply(storyMaskCommand(history.document, second.id, null));
  assert.equal(history.document.assets[mask.id], undefined);
  const sources = new Map([...assets, mask].map((asset) => [asset.id, new Blob([new Uint8Array(asset.byteLength)])]));
  const session = { history, sources };
  pruneStorySources(session); assert.equal(sources.has(mask.id), true, "undo still owns the mask bytes");
  pruneStorySources(session, 0); assert.equal(sources.has(mask.id), false); assert.equal(sources.size, assets.length);
});
