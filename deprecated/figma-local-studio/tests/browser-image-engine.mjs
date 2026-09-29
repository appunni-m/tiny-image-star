import { createInitialProject, createNode, serializeProject } from '../src/model.js';
import { LocalImageEngine } from '../src/image-engine.js';
import { loadImageAsset, deleteImageAsset, saveImageAsset } from '../src/storage.js';
import { packProject, unpackProjectPackage } from '../src/project-package.js';

const result = document.querySelector('#result');
const engine = new LocalImageEngine();
let previousProject = null;
let stagedAssetId = null;
function assert(condition, message) { if (!condition) throw new Error(message); }
function makeBmp() {
  const bytes = new Uint8Array(62), view = new DataView(bytes.buffer);
  bytes.set([66, 77]); view.setUint32(2, 62, true); view.setUint32(10, 54, true); view.setUint32(14, 40, true);
  view.setInt32(18, 2, true); view.setInt32(22, 1, true); view.setUint16(26, 1, true); view.setUint16(28, 24, true); view.setUint32(34, 8, true);
  bytes.set([0, 0, 255, 0, 255, 0, 0, 0], 54);
  return bytes;
}
function sameBytes(left, right) { return left.length === right.length && left.every((value, index) => value === right[index]); }

try {
  await engine.initialization;
  const original = makeBmp(), node = createNode('image', { sourceBytes: original, adjustments: { brightness: 0, contrast: 0, saturation: 0, blur: 0 } });
  const baseline = await engine.render(node);
  const bitmap = await createImageBitmap(new Blob([baseline.bytes], { type: 'image/png' }));
  assert(bitmap.width === 2 && bitmap.height === 1, 'WASM baseline output did not decode in the browser');
  bitmap.close();
  node.adjustments.brightness = -40;
  const adjusted = await engine.render(node);
  assert(adjusted.width === 2 && adjusted.height === 1, 'WASM adjustment changed source dimensions');
  assert(!sameBytes(baseline.bytes, adjusted.bytes), 'WASM adjustment did not change the rendered pixels');
  assert(sameBytes(original, makeBmp()), 'WASM worker modified the retained original bytes');

  const assetId = `browser-check-${crypto.randomUUID()}`;
  await saveImageAsset(assetId, original, 'two-color.bmp', 'image/bmp');
  const stored = await loadImageAsset(assetId);
  assert(stored?.name === 'two-color.bmp' && sameBytes(stored.bytes, original), 'IndexedDB did not preserve original image bytes');
  await deleteImageAsset(assetId);

  const packageProject = createInitialProject();
  const imageNode = createNode('image', { assetId, sourceName: 'two-color.bmp' });
  packageProject.pages[0].nodes.push(imageNode);
  const portable = packProject(packageProject, new Map([[assetId, original]]));
  const roundTrip = unpackProjectPackage(new Uint8Array(await portable.arrayBuffer()));
  assert(sameBytes(roundTrip.assets.get(assetId).bytes, original), 'Portable design did not retain the image asset');
  previousProject = localStorage.getItem('local-studio-project-v1');
  const appProject = createInitialProject();
  const appImage = createNode('image', { name: 'Two color test', sourceName: 'two-color.bmp', sourceType: 'image/bmp', x: 160, y: 140, w: 240, h: 120, adjustments: { brightness: 0, contrast: 0, saturation: 0, blur: 0 } });
  appImage.assetId = appImage.id; stagedAssetId = appImage.id;
  appProject.pages[0].nodes.push(appImage);
  await saveImageAsset(appImage.id, original, 'two-color.bmp', 'image/bmp');
  localStorage.setItem('local-studio-project-v1', serializeProject(appProject));
  result.textContent = JSON.stringify({ status: 'PASS', engine: 'Pillow-RS WebAssembly in dedicated worker', sourceBytesRetained: true, sameImageLayerReRendered: true, indexedDb: true, portableAsset: true, appSeed: 'Reload Local Studio to verify its image inspector and live preview.' });
  document.querySelector('#reset').hidden = false;
} catch (error) {
  result.textContent = `FAIL: ${error?.stack || error}`;
} finally {
  engine.destroy();
}

document.querySelector('#reset').addEventListener('click', async () => {
  if (previousProject === null) localStorage.removeItem('local-studio-project-v1');
  else localStorage.setItem('local-studio-project-v1', previousProject);
  if (stagedAssetId) await deleteImageAsset(stagedAssetId);
  result.textContent = 'Preview restored to the clean document. Reload Local Studio to see it.';
  document.querySelector('#reset').disabled = true;
});
