import test from "node:test";
import assert from "node:assert/strict";
import { createPhotoStory } from "../src/story/recipes.js";
import { planStoryExports, StoryExportBatch } from "../src/story/export-plan.js";
import { captureStoryStyle, parseStyle, serializeStyle, storyStyleCommand, validateStyle } from "../src/styles/model.js";
import { applyProjectCommand } from "../src/project/history.js";

function story() {
  return createPhotoStory(Array.from({ length: 6 }, (_, index) => ({ id: `photo-${index}`, kind: "image", name: `${index}.png`, type: "image/png",
    width: 300, height: 200, byteLength: 100, sha256: index.toString(16).padStart(64, "0"), orientation: "upright" })), { title: "Our weekend" });
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test("both shapes have a complete, ordered output manifest with unique filenames and independent metadata", () => {
  const project = story(), plan = planStoryExports(project, { variants: ["tall", "portrait"], format: "png" });
  assert.equal(plan.items.length, 8); assert.equal(new Set(plan.items.map(item => item.key)).size, 8);
  assert.deepEqual(plan.items.map(item => [item.variantId, item.slideIndex]), ["portrait", "tall"].flatMap(id => [0,1,2,3].map(index => [id,index])));
  assert.deepEqual(plan.items.map(item => item.name), ["portrait", "tall"].flatMap(id => [1,2,3,4].map(index => `our-weekend-${id}-0${index}.png`)));
  assert.deepEqual(plan.items.map(item => [item.width, item.height]), [...Array(4).fill([1080,1350]), ...Array(4).fill([1080,1920])]);
  const first = project.slides[0].nodeIds.find(id => project.nodes[id].kind === "image");
  project.nodes[first].focal.x = .1; project.name = "Changed later"; project.slides.reverse();
  assert.equal(plan.project.name, "Our weekend"); assert.equal(plan.project.nodes[first].focal.x, .5);
  assert.throws(() => { plan.project.name = "Mutable"; }, TypeError);
});

test("legacy single-shape filenames and saved export selections survive without changing preview shape", () => {
  const project = story(); project.recipe.outputVariant = "tall";
  assert.deepEqual(planStoryExports(project).items.map(item => item.name), [1,2,3,4].map(index => `our-weekend-0${index}.jpg`));
  project.recipe.outputVariants = ["portrait", "tall"]; project.recipe.outputFormat = "png";
  assert.equal(planStoryExports(JSON.parse(JSON.stringify(project))).items.length, 8);
  assert.equal(project.recipe.outputVariant, "tall");
});

test("invalid, unavailable, duplicate and unbounded export choices fail before rendering", () => {
  const project = story();
  for (const variants of [[], ["square"], ["tall", "tall"], ["portrait", "tall", "square"], "portrait", null]) assert.throws(() => planStoryExports(project, { variants }), /export shapes/);
  assert.throws(() => planStoryExports(project, { format: "webp" }), /PNG or JPEG/);
  project.variants = project.variants.filter(variant => variant.id === "portrait");
  for (const node of Object.values(project.nodes)) if (node.variantFrames) delete node.variantFrames.tall;
  assert.throws(() => planStoryExports(project, { variants: ["tall"] }), /export shapes/);
  project.engine.compositor = "future"; assert.throws(() => planStoryExports(project), /renderer|compositor/i);
});

test("output-only saved styles retain both shapes and legacy styles still choose exactly one", () => {
  const source = story(); source.recipe.outputVariants = ["portrait", "tall"]; source.recipe.outputFormat = "png";
  const style = captureStoryStyle(source, source.slides[0].id, "Both sizes", { output: true });
  assert.ok(style.requires.includes("export-variants-v1")); assert.deepEqual(style.assets, []);
  const restored = parseStyle(serializeStyle(style)), target = story();
  const applied = applyProjectCommand(target, storyStyleCommand(target, restored)).project;
  assert.equal(planStoryExports(applied).items.length, 8); assert.deepEqual(applied.nodes, target.nodes);
  const missing = structuredClone(style); missing.requires = missing.requires.filter(id => id !== "export-variants-v1");
  assert.throws(() => validateStyle(missing), /required capability/);
  for (const variants of [[], ["tall","tall"], ["unknown"]]) { const invalid=structuredClone(style); invalid.components.output.variants=variants; assert.throws(()=>validateStyle(invalid)); }
  const legacySource=story(); legacySource.recipe.outputVariant="tall";
  const legacy=captureStoryStyle(legacySource,legacySource.slides[0].id,"Tall only",{output:true});
  const single=applyProjectCommand(applied,storyStyleCommand(applied,legacy)).project;
  assert.equal(single.recipe.outputVariants,undefined); assert.equal(planStoryExports(single).items.length,4);
  assert.ok(planStoryExports(single).items.every(item=>item.variantId==="tall"));
});

test("one failed output preserves all successes, ordered results and the exact frozen retry", async () => {
  const plan = planStoryExports(story()), calls = [], pending = new Map();
  const batch = new StoryExportBatch(plan, { render: (item, options) => { calls.push({ key: item.key, project: options.plan.project }); const task = deferred(); pending.set(item.key, task); return task.promise; } });
  const running = batch.start(); assert.equal(batch.counts.processing, 4);
  await assert.rejects(batch.start(), /already being prepared/);
  pending.get(plan.items[3].key).resolve("last"); pending.get(plan.items[1].key).reject(new Error("Unreadable source"));
  pending.get(plan.items[0].key).resolve("first"); pending.get(plan.items[2].key).resolve("third"); await running;
  assert.deepEqual(batch.counts, { total: 4, ready: 3, failed: 1, pending: 0, processing: 0 });
  assert.deepEqual(batch.records.map(record => record.value), ["first",null,"third","last"]);
  const retry = batch.start({ retryFailed: true }); assert.equal(calls.length, 5); assert.equal(calls[4].key, plan.items[1].key);
  assert.ok(calls.every(call => call.project === plan.project)); pending.get(plan.items[1].key).resolve("repaired"); await retry;
  assert.deepEqual(batch.records.map(record => record.value), ["first","repaired","third","last"]);
});

test("pausing preserves ready files and rejects late output ownership; continuing runs only pending items", async () => {
  const plan = planStoryExports(story()), calls = [], pending = [], retained = [];
  const batch = new StoryExportBatch(plan, { render: item => { calls.push(item.key); const task = deferred(); pending.push(task); return task.promise; }, retain: value => { retained.push(value); return value; } });
  const running = batch.start(); pending[0].resolve("keep"); await tick(); batch.pause();
  pending[1].resolve("too late"); pending[2].reject(new DOMException("Cancelled", "AbortError")); pending[3].resolve("also late"); await running;
  assert.deepEqual(retained, ["keep"]); assert.deepEqual(batch.counts, { total: 4, ready: 1, failed: 0, pending: 3, processing: 0 });
  const continued = batch.start(); assert.deepEqual(calls.slice(4), plan.items.slice(1).map(item => item.key));
  pending.slice(4).forEach((task, index) => task.resolve(index)); await continued; assert.equal(batch.counts.ready, 4);
  batch.dispose(); assert.ok(batch.records.every(record => record.value === null), "closing drops held output references as well as cancelling work");
});

test("closing a batch cancels admitted work and ignores all later completion notifications", async () => {
  const plan = planStoryExports(story()), pending = [], signals = []; let retained = 0, changed = 0;
  const batch = new StoryExportBatch(plan, { render: (_, {signal}) => { signals.push(signal); const task = deferred(); pending.push(task); return task.promise; },
    retain: () => retained++, changed: () => changed++ });
  const running = batch.start(); const prior = changed; batch.dispose(); pending.forEach(task => task.resolve("late")); await running;
  assert.equal(retained, 0); assert.equal(changed, prior); assert.ok(signals.every(signal => signal.aborted));
  await assert.rejects(batch.start(), /closed/);
});

test("synchronous render and output-retention failures are isolated to their own output", async () => {
  const plan = planStoryExports(story());
  const batch = new StoryExportBatch(plan, { render: item => { if (item.index === 0) throw new Error("Admission failed"); return item.index; },
    retain: value => { if (value === 1) throw new Error("File could not be retained"); return value; } });
  await batch.start(); assert.equal(batch.counts.failed, 2); assert.equal(batch.counts.ready, 2);
  assert.match(batch.records[0].error, /Admission/); assert.match(batch.records[1].error, /retained/);
});
