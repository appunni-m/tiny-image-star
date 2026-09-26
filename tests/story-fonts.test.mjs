import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { clone, validateProject } from "../src/project/model.js";
import { applyProjectCommand, ProjectHistory } from "../src/project/history.js";
import { createPhotoStory } from "../src/story/recipes.js";
import { storyMaskCommand } from "../src/story/masks.js";
import { curatedStoryStyles, captureStoryStyle, parseStyle, serializeStyle, storyStyleCommand, storyDeviceFontsCommand, styleCompatibility, validateStyle } from "../src/styles/model.js";
import { storyFonts, storyFont, knownStoryFont, unsupportedFontCharacters, loadStoryFont } from "../src/styles/font-pack.js";
import { StoryFontLoader } from "../src/story/font-loader.js";
import { planScene } from "../src/compositor/scene-spec.js";
import { STORY_FONT_DATA } from "../src/styles/font-pack-data.js";
import { fontUnicodeRanges } from "./helpers/font-cmap.mjs";

const apply = (p, command) => applyProjectCommand(p, command).project;
const root = new URL("../src/assets/story-type-v1/", import.meta.url);
const provenance = JSON.parse(await readFile(new URL("provenance.json", root)));
const sourceBytes = async (role) => readFile(new URL(provenance.fonts.find((f) => f.role === role).files[0].path, root));
const tick = () => new Promise(setImmediate);
const fixture = () => createPhotoStory(Array.from({ length: 6 }, (_, i) => ({ id: `private-source-${i}`, kind: "image", name: `Private photo ${i}`, type: "image/png",
  width: 600, height: 800, byteLength: 100, sha256: String(i).repeat(64), orientation: "upright" })), { title: "Private holiday" });
const masked = (project) => {
  const node = Object.values(project.nodes).find((node) => node.kind === "image"), asset = project.assets[node.assetId];
  return apply(project, storyMaskCommand(project, node.id, { ...asset, id: "private-mask", kind: "mask", sha256: "f".repeat(64) }));
};
const caption = (project) => Object.values(project.nodes).find((node) => node.id.endsWith(":caption"));

test("the unmodified font pack binds four binaries, licenses, descriptors and coverage to pinned source hashes", async () => {
  assert.equal(provenance.modified, false); assert.match(provenance.source_revision, /^[a-f0-9]{40}$/);
  assert.equal(provenance.fonts.length, 4);
  for (const item of provenance.fonts) {
    const asset = storyFont(item.role); assert.ok(knownStoryFont(asset));
    assert.equal(asset.license, "OFL-1.1"); assert.equal(asset.sha256, item.files[0].sha256);
    assert.deepEqual(fontUnicodeRanges(await sourceBytes(item.role)), STORY_FONT_DATA.find(entry => entry.role === item.role).codepoints, `${item.role}: complete independent cmap comparison`);
    for (const file of item.files) {
      const bytes = await readFile(new URL(file.path, root)); assert.equal(bytes.length, file.bytes);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
      assert.ok(file.url.includes(provenance.source_revision));
      if (file.path.endsWith("OFL.txt")) assert.match(bytes.toString(), /SIL OPEN FONT LICENSE Version 1.1/);
    }
  }
  assert.equal(storyFonts().reduce((sum, font) => sum + font.byteLength, 0), 2240276);
  assert.deepEqual(unsupportedFontCharacters(storyFont("serif"), "Café — Noël\nΚαλημέρα Привет 012345"), []);
  assert.deepEqual(unsupportedFontCharacters(storyFont("display"), "ORBIT 東京 東京"), ["東", "京"]);
  const changed = storyFont("serif"); changed.fontFace.weight = "100 900"; assert.equal(knownStoryFont(changed), false);
  assert.equal(storyFont("serif").fontFace.weight, "200 900");
});

test("revision-two recipes freeze licensed fonts while revision one remains independent and asset-free", () => {
  const base = masked(fixture()), old = curatedStoryStyles({ revision: 1 }), current = curatedStoryStyles();
  for (let i = 0; i < 3; i++) {
    assert.equal(old[i].revision, 1); assert.equal(old[i].assets.length, 0); assert.equal(old[i].components.storyDesign.schema, 1);
    assert.equal(current[i].revision, 2); assert.equal(current[i].components.storyDesign.schema, 2); assert.ok(current[i].requires.includes("licensed-fonts-v1"));
    const project = apply(base, storyStyleCommand(base, current[i])); validateProject(project);
    assert.equal(project.recipe.style.definition.revision, 2);
    for (const node of Object.values(project.nodes).filter((n) => n.kind === "text" && n.fontId)) assert.ok(knownStoryFont(project.assets[node.fontId]));
    for (const [id, asset] of Object.entries(base.assets)) assert.deepEqual(project.assets[id], asset);
    const legacy = apply(base, storyStyleCommand(base, old[i])); assert.ok(Object.values(legacy.nodes).every((node) => !node.fontId));
    assert.deepEqual(parseStyle(serializeStyle(current[i])), current[i]);
  }
  assert.equal(current[1].components.depthTitle.style.weight, 700);
  assert.equal(old[1].components.depthTitle.style.weight, 800);
});

test("saved text and depth styles share only pinned font references and preserve one-step undo", () => {
  const base = masked(fixture()), source = apply(base, storyStyleCommand(base, curatedStoryStyles()[1]));
  const photo = Object.values(source.nodes).find((node) => node.depthTextId);
  const style = captureStoryStyle(source, source.slides[0].id, "My type", { text: true, depthTitle: true, depthPhotoId: photo.id });
  assert.equal(style.assets.length, 3);
  const bytes = serializeStyle(style); for (const word of ["Private holiday", "private-source", "private-mask", "https://", "data:"]) assert.ok(!bytes.includes(word));
  const history = new ProjectHistory(base); history.apply(storyStyleCommand(base, parseStyle(bytes)), "Typography");
  assert.ok(caption(history.document).fontId); assert.equal(history.past.length, 1);
  history.undo(); assert.deepEqual(history.document.nodes, base.nodes); assert.deepEqual(history.document.assets, base.assets);
  history.redo(); assert.ok(caption(history.document).fontId);
  const conflict = clone(base); conflict.assets[style.assets[0].id] = { ...style.assets[0], name: "Conflicting font" };
  assert.throws(() => storyStyleCommand(conflict, style), /conflicts/); assert.equal(conflict.assets[style.assets[0].id].name, "Conflicting font");
});

test("font declarations reject unsafe/private fields and preserve unavailable imports without substitution", () => {
  for (const change of [s => s.assets[0].url = "https://example.com/font", s => s.assets[0].kind = "image", s => s.assets[0].license = "unknown",
    s => s.assets[0].byteLength = 17 * 1024 * 1024, s => s.assets.push(clone(s.assets[0])), s => s.assets = [],
    s => s.assets[0].fontFace.weight = "900 200", s => s.assets[0].fontFace.style = "script", s => s.requires = s.requires.filter(x => x !== "licensed-fonts-v1")]) {
    const style = curatedStoryStyles()[0]; change(style); assert.throws(() => validateStyle(style));
  }
  const unavailable = curatedStoryStyles()[0]; unavailable.id = "custom:unavailable"; unavailable.assets[0].name = "Unavailable font edition";
  const imported = parseStyle(serializeStyle(unavailable)); assert.deepEqual(imported, unavailable);
  assert.match(styleCompatibility(imported, fixture()), /font pack unavailable/);
  assert.throws(() => storyStyleCommand(fixture(), imported), /font pack unavailable/);
});

test("unsupported glyphs and styles fail preflight; explicit device fallback keeps words and is reversible", () => {
  const base = masked(fixture()), project = apply(base, storyStyleCommand(base, curatedStoryStyles()[1]));
  const node = caption(project); node.text = "東京 🌈";
  assert.throws(() => planScene(project, project.slides[0].id, "portrait"), /every character/);
  node.text = "Readable"; node.style.italic = true;
  assert.throws(() => planScene(project, project.slides[0].id, "portrait"), /italic style/); delete node.style.italic;
  const title = Object.values(project.nodes).find((n) => n.kind === "text" && n.fontId === storyFont("display").id); title.style.weight = 800;
  assert.throws(() => planScene(project, project.slides[0].id, "portrait"), /weight/); title.style.weight = 700; node.text = "東京 🌈";
  const history = new ProjectHistory(project); history.apply(storyDeviceFontsCommand(project), "Device fonts");
  assert.equal(caption(history.document).text, "東京 🌈"); assert.ok(Object.values(history.document.nodes).every(n => !n.fontId));
  assert.doesNotThrow(() => planScene(history.document, history.document.slides[0].id, "portrait"));
  history.undo(); assert.deepEqual(history.document.assets, project.assets); assert.deepEqual(history.document.nodes, project.nodes);
});

test("font fetches are pinned, bounded, hash-checked, cancellable and never accept recipe URLs", async () => {
  const asset = storyFont("display"), bytes = await sourceBytes("display"); let count = 0;
  const blob = await loadStoryFont(asset, { fetcher: async (url, options) => {
    count++; assert.ok(url.pathname.endsWith("/oswald/Oswald[wght].ttf")); assert.equal(options.redirect, "error"); assert.equal(options.credentials, "omit");
    return new Response(bytes);
  } });
  assert.equal(blob.size, asset.byteLength); assert.equal(count, 1);
  const wrong = Buffer.from(bytes); wrong[128] ^= 255;
  for (const body of [bytes.subarray(0, 10), wrong, Buffer.concat([bytes, Buffer.from([1])])])
    await assert.rejects(loadStoryFont(asset, { fetcher: async () => new Response(body) }), /could not be loaded/);
  const signal = AbortSignal.abort(); await assert.rejects(loadStoryFont(asset, { signal, fetcher: () => { throw new Error("must not fetch"); } }), { name: "AbortError" });
  await assert.rejects(loadStoryFont({ ...asset, url: "https://example.com" }), /unavailable/);
});

test("shared font loading counts temporary bytes, cancels only the last consumer and reuses stored sources", async () => {
  const asset = storyFont("mono"), sources = new Map(); let resolve, requests = 0, cancellations = 0;
  const loader = new StoryFontLoader({ sources, load: (_asset, { signal }) => {
    requests++; return new Promise((yes, no) => { resolve = yes; signal.addEventListener("abort", () => { cancellations++; no(new DOMException("Cancelled", "AbortError")); }); });
  } });
  const a = new AbortController(), b = new AbortController(); const first = loader.read(asset, { signal: a.signal }), second = loader.read(asset, { signal: b.signal });
  assert.equal(loader.pendingBytes, asset.byteLength * 3); await tick(); assert.equal(requests, 1);
  a.abort(); await assert.rejects(first, { name: "AbortError" }); assert.equal(cancellations, 0);
  const blob = new Blob(["verified fixture"]); resolve(blob); assert.equal(await second, blob); assert.equal(loader.pendingBytes, 0);
  assert.equal(await loader.read(asset), blob); assert.equal(requests, 1);
  sources.clear(); const c = new AbortController(), abandoned = loader.read(asset, { signal: c.signal }); await tick(); c.abort();
  await assert.rejects(abandoned, { name: "AbortError" }); await tick(); assert.equal(cancellations, 1); assert.equal(sources.size, 0); assert.equal(loader.pendingBytes, 0);
  const offline = new StoryFontLoader({ sources, readStored: async () => blob, load: () => { throw new Error("must not fetch"); } });
  assert.equal(await offline.read(asset), blob);
  const corrupt = new StoryFontLoader({ sources: new Map(), readStored: async () => { throw new Error("corrupt saved font"); }, load: () => { throw new Error("must not replace"); } });
  await assert.rejects(corrupt.read(asset), /corrupt saved font/);
});
