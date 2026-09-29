import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createDefaultDocument, createLayer, resizedBounds, scaleNodesToBounds, selectionBounds } from "../src/model.js";

const root = new URL("../", import.meta.url);

test("new project has a populated design canvas and uniquely addressable layers", () => {
  const model = createDefaultDocument();
  assert.deepEqual(model.frame, { width: 1440, height: 1000, name: "Landing page" });
  assert.ok(model.nodes.length >= 20);
  assert.ok(model.nodes.some((node) => node.type === "text" && node.text.includes("Find a little")));
  assert.ok(model.nodes.some((node) => node.type === "landscape"));
  assert.equal(new Set(model.nodes.map((node) => node.id)).size, model.nodes.length);
  for (const node of model.nodes) {
    assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
    assert.ok(node.w > 0 && node.h > 0);
    assert.ok(node.x + node.w <= model.frame.width + 2);
    assert.ok(node.y + node.h <= model.frame.height + 2);
  }
});

test("layer creation starts inside the frame and exposes editable vector and text properties", () => {
  const rectangle = createLayer("rect", 120, 90);
  const text = createLayer("text", 80, 64, { text: "Editable" });
  assert.equal(rectangle.type, "rect");
  assert.equal(rectangle.fill, "#d9d2ff");
  assert.equal(text.text, "Editable");
  assert.equal(text.fontSize, 32);
  assert.ok(rectangle.id !== text.id);
});

test("canvas selection bounds resize from anchored handles and scale multiselections", () => {
  const nodes = [
    { id: "a", x: 10, y: 20, w: 30, h: 40, type: "rect" },
    { id: "b", x: 60, y: 35, w: 20, h: 10, type: "text", fontSize: 12 },
    { id: "hidden", x: -200, y: -200, w: 40, h: 40, hidden: true, type: "rect" },
  ];
  const bounds = selectionBounds(nodes);
  assert.deepEqual(bounds, { x: 10, y: 20, w: 70, h: 40 });
  assert.deepEqual(resizedBounds(bounds, "se", { x: 150, y: 100 }), { x: 10, y: 20, w: 140, h: 80 });
  assert.deepEqual(resizedBounds(bounds, "nw", { x: -20, y: -20 }, { preserveAspect: true }), { x: -60, y: -20, w: 140, h: 80 });
  scaleNodesToBounds(nodes, bounds, { x: 10, y: 20, w: 140, h: 80 });
  assert.deepEqual([nodes[0].x, nodes[0].y, nodes[0].w, nodes[0].h], [10, 20, 60, 80]);
  assert.deepEqual([nodes[1].x, nodes[1].y, nodes[1].w, nodes[1].h, nodes[1].fontSize], [110, 50, 40, 20, 24]);
  assert.deepEqual([nodes[2].x, nodes[2].y], [-200, -200], "hidden layers do not alter selection transforms");
});

test("fresh root is independent of the archived editor and loads the local WASM worker", async () => {
  const [html, main, worker, packageJson, oldIndex] = await Promise.all([
    readFile(new URL("index.html", root), "utf8"),
    readFile(new URL("src/main.js", root), "utf8"),
    readFile(new URL("src/pillow-worker.js", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("deprecated/index.html", root), "utf8"),
  ]);
  assert.match(html, /id="design-canvas"/);
  assert.match(html, /id="layer-tree"/);
  assert.match(html, /id="job-bar"/);
  assert.match(main, /Apply a recipe to/);
  assert.match(worker, /\.\.?\/wasm\/pillow_rs_js\.js/);
  assert.doesNotMatch(worker, /https?:\/\//);
  assert.equal(JSON.parse(packageJson).dependencies["pillow-rs"], "12.2.0-alpha.1");
  assert.match(oldIndex, /Image editor/);
});
