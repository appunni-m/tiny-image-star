import * as binding from "../../wasm/pillow_rs_js.js";
import { createPillowEngine, renderSlideWithApi } from "../../src/engine/pillow.js";
import { createSceneProject } from "../../src/project/model.js";
import { planScene } from "../../src/compositor/scene-spec.js";
import { sceneWork, MiB } from "../../src/processing/policy.js";

// Research-only wrapper. It observes the unchanged published binding; it does
// not count native allocations or claim process/GPU/JavaScript memory.
self.onmessage = async ({ data: input }) => {
  const trace = [];
  try {
    const wasm = await binding.default(), engine = await createPillowEngine();
    const initialHeap = wasm.memory.buffer.byteLength;
    const observed = (name, action) => {
      const before = wasm.memory.buffer.byteLength, started = performance.now();
      try { return action(); }
      finally {
        const after = wasm.memory.buffer.byteLength;
        if (trace.length < 512) trace.push({ operation: name, before, after, elapsedMs: performance.now() - started,
          ...(after > before ? { caller: new Error().stack?.split("\n").slice(3, 6).join("\n") } : {}) });
        if (after > 1024 * MiB) throw new Error("Research worker exceeded its 1 GiB Wasm stop threshold.");
      }
    };
    for (const name of ["convert", "crop", "enhanceBrightness", "enhanceContrast", "enhanceColor", "transformWithInput",
      "getchannel", "putalphaImageInput", "resize", "alphaComposite", "toBytes", "gaussianBlur", "point", "load", "saveWithInput", "free"]) {
      const original = binding.Image.prototype[name];
      binding.Image.prototype[name] = function (...args) { return observed(name, () => original.apply(this, args)); };
    }
    const api = { ...binding, Image: new Proxy(binding.Image, {
      construct: (target, args) => observed("new Image", () => Reflect.construct(target, args)),
      get: (target, key) => key === "open" ? (...args) => observed("open", () => target.open(...args)) : Reflect.get(target, key),
    }), fromBytesFn: (...args) => observed("fromBytesFn", () => binding.fromBytesFn(...args)),
    ImageChops: new Proxy(binding.ImageChops, {
      get: (target, key) => key === "multiply" ? (...args) => observed("multiply", () => target.multiply(...args)) : Reflect.get(target, key),
    }) };
    const photoBytes = new Uint8Array(input.photo), maskBytes = new Uint8Array(input.mask);
    const inspectionBefore = wasm.memory.buffer.byteLength;
    const inspection = engine.inspect({ bytes: photoBytes });
    const inspectionAfter = wasm.memory.buffer.byteLength;
    const asset = { id: "photo", kind: "image", name: input.name, type: input.type, width: input.width, height: input.height,
      orientation: "upright", byteLength: photoBytes.length, sha256: input.photoSha256 };
    const mask = { ...asset, id: "mask", kind: "mask", type: "image/png", byteLength: maskBytes.length, sha256: input.maskSha256 };
    const photo = { id: "photo", kind: "image", space: "slide", frame: { x: .05, y: .2, width: .9, height: .7 },
      assetId: "photo", maskId: "mask", fit: "cover", rotation: 3, appearance: { brightness: 1.05, contrast: 1.08, saturation: .9 } };
    if (input.finish) photo.cutoutEffects = { schema: 1, outline: { color: "#ffffff", width: .006 },
      shadow: { color: "#000000", opacity: .25, blur: .008, x: .004, y: .008 } };
    const nodes = { photo };
    if (input.depth) {
      photo.depthTextId = "title"; photo.depthBackground = "photo";
      nodes.title = { id: "title", kind: "text", space: "slide", frame: { x: .05, y: .3, width: .9, height: .3 },
        text: "MEMORY STUDY", color: "#ffffff", style: { builtinFont: "system-sans", fontBasis: "width", fontSize: .07, weight: 700 } };
    }
    const project = createSceneProject({ id: input.name, assets: { photo: asset, mask }, nodes,
      variants: [{ id: "tall", width: 1080, height: 1920 }] });
    const slideId = project.slides[0].id, plan = planScene(project, slideId, "tall");
    const estimate = sceneWork(plan);
    if (estimate.heap + estimate.transient > 1024 * MiB) throw new Error("Research case exceeds the 1 GiB admission envelope.");
    trace.push({ operation: "render-start", before: wasm.memory.buffer.byteLength, after: wasm.memory.buffer.byteLength, elapsedMs: 0 });
    const started = performance.now();
    const rendered = await renderSlideWithApi(api, { project, slideId, variantId: "tall", memoryEstimate: estimate,
      assets: [{ id: "photo", bytes: photoBytes }, { id: "mask", bytes: maskBytes }] }, { outputFormats: ["png", "jpeg"] });
    const elapsedMs = performance.now() - started;
    const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", rendered.bytes))].map((n) => n.toString(16).padStart(2, "0")).join("");
    self.postMessage({ status: "pass", initialHeap, inspection: { ...inspection, before: inspectionBefore, after: inspectionAfter },
      estimate, finalHeap: wasm.memory.buffer.byteLength, elapsedMs, trace,
      output: { sha256, width: rendered.width, height: rendered.height, byteLength: rendered.bytes.length }, bytes: rendered.bytes }, [rendered.bytes.buffer]);
  } catch (error) { self.postMessage({ status: "fail", error: { name: error.name, message: error.message, stack: error.stack }, trace }); }
};
