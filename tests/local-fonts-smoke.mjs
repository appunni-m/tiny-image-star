import { addNode, createDocument, createNode } from '../src/model.js';
import { deleteFontAsset, packLocalPackage, unpackLocalPackage } from '../src/storage.js';

const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');

function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 20000) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try { if (await test()) { resolve(); return; } } catch { /* Wait for editor startup or its asynchronous local write. */ }
      if (performance.now() - started > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(() => { void poll(); }, 30);
    };
    void poll();
  });
}
function click(app, element) {
  assert(element, 'Expected a local-font workflow control.');
  element.dispatchEvent(new app.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}
function setFile(app, selector, file) {
  const input = app.querySelector(selector);
  assert(input, `Missing file input ${selector}.`);
  const transfer = new app.defaultView.DataTransfer();
  transfer.items.add(file);
  Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
  input.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
}
function readStore(app, storeName) {
  return new Promise((resolve, reject) => {
    const request = app.defaultView.indexedDB.open('figma-local-documents');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      let read;
      try { read = db.transaction(storeName).objectStore(storeName).getAll(); }
      catch (error) { db.close(); reject(error); return; }
      read.onsuccess = () => { resolve(read.result); db.close(); };
      read.onerror = () => { reject(read.error); db.close(); };
    };
  });
}
function tinyWoff2(seed) {
  return new Uint8Array([0x77, 0x4f, 0x46, 0x32, seed & 255, 0x21, 0x42, 0x63, 0x84, 0xa5, 0xc6, 0xe7]);
}
function installScopedFontFaceStub(app) {
  const faces = new Set();
  class SmokeFontFace {
    constructor(family, source, descriptors) {
      assert(source instanceof app.defaultView.ArrayBuffer, 'FontFace should receive an isolated ArrayBuffer copy.');
      assert(new app.defaultView.Uint8Array(source).subarray(0, 4).join(',') === '119,79,70,50', 'The local font bytes lost their WOFF2 signature.');
      this.family = family;
      this.weight = descriptors.weight;
      this.style = descriptors.style;
      this.status = 'unloaded';
    }
    async load() { this.status = 'loaded'; return this; }
  }
  const fakeFontSet = {
    faces,
    ready: Promise.resolve(),
    add(face) { faces.add(face); return this; },
    delete(face) { return faces.delete(face); }
  };
  const viewDescriptor = Object.getOwnPropertyDescriptor(app.defaultView, 'FontFace');
  const fontsDescriptor = Object.getOwnPropertyDescriptor(app, 'fonts');
  const confirmDescriptor = Object.getOwnPropertyDescriptor(app.defaultView, 'confirm');
  const restore = () => {
    if (viewDescriptor) Object.defineProperty(app.defaultView, 'FontFace', viewDescriptor);
    else delete app.defaultView.FontFace;
    if (fontsDescriptor) Object.defineProperty(app, 'fonts', fontsDescriptor);
    else delete app.fonts;
    if (confirmDescriptor) Object.defineProperty(app.defaultView, 'confirm', confirmDescriptor);
    else delete app.defaultView.confirm;
  };
  try {
    Object.defineProperty(app.defaultView, 'FontFace', { configurable: true, writable: true, value: SmokeFontFace });
    Object.defineProperty(app, 'fonts', { configurable: true, value: fakeFontSet });
    Object.defineProperty(app.defaultView, 'confirm', { configurable: true, writable: true, value: () => true });
  } catch (error) {
    restore();
    throw error;
  }
  return {
    faces,
    restore
  };
}

let app = null;
let faceStub = null;
let originalFontId = null;
let importedFontId = null;
let family = `Smoke Display ${Date.now().toString(36)}`;
let variableFontId = null;
const variableFamily = `Inter Variable ${Date.now().toString(36)}`;

try {
  await waitFor(() => frame.contentDocument?.documentElement.dataset.appReady === 'true', 'editor startup');
  app = frame.contentDocument;
  assert(app.title === 'Tiny Image Star', 'the local-font workflow should run in the Tiny Image Star editor.');
  faceStub = installScopedFontFaceStub(app);

  const addButton = app.querySelector('#add-local-font');
  const fontInput = app.querySelector('#font-input');
  assert(addButton?.getAttribute('aria-label') === 'Add a local font', 'the add-font action needs an accessible name.');
  assert(['.woff2', '.woff', '.ttf', '.otf'].every(extension => fontInput.accept.includes(extension)), 'the file picker should advertise every supported local font format.');
  setFile(app, '#font-input', new app.defaultView.File([tinyWoff2(1)], 'smoke-display.woff2', { type: 'font/woff2' }));

  const dialog = app.querySelector('#font-import-dialog');
  await waitFor(() => dialog?.open, 'font descriptor dialog');
  const familyInput = app.querySelector('#font-family-name');
  const weightInput = app.querySelector('#font-weight-value');
  const styleInput = app.querySelector('#font-style-value');
  assert(familyInput.labels?.length && weightInput.labels?.length && styleInput.labels?.length,
    'font family, weight, and style controls should have associated labels.');
  familyInput.value = family;
  weightInput.value = '700';
  styleInput.value = 'italic';
  click(app, app.querySelector('#font-import-confirm'));
  await waitFor(() => !dialog.open && app.querySelector('#font-assets-list .local-font-row'), 'font installation');

  const firstMetadata = (await readStore(app, 'fontMetadata')).find(record => record.family === family);
  assert(firstMetadata, 'font installation did not persist its local metadata record.');
  originalFontId = firstMetadata.id;
  assert(firstMetadata.weight === 700 && firstMetadata.style === 'italic' && firstMetadata.byteLength === 12,
    'the chosen family, weight, style, and size were not stored accurately.');
  const firstBinary = (await readStore(app, 'fontAssets')).find(record => record.id === originalFontId);
  assert(firstBinary?.bytes && new Uint8Array(firstBinary.bytes).join(',') === [...tinyWoff2(1)].join(','),
    'the font bytes did not survive an IndexedDB round trip.');
  const familyOption = [...app.querySelector('#font-family-options').options].find(option => option.value === family);
  assert(familyOption, 'the installed family was not added to the text font-family options.');
  assert([...faceStub.faces].some(face => face.family === family && face.weight === '700' && face.style === 'italic'),
    'the stored local font was not loaded into the isolated document FontFaceSet.');

  const variableBytes = new Uint8Array(await (await app.defaultView.fetch('./fixtures/fonts/inter-latin-variable.woff2')).arrayBuffer());
  setFile(app, '#font-input', new app.defaultView.File([variableBytes], 'inter-latin-variable.woff2', { type: 'font/woff2' }));
  await waitFor(() => dialog?.open, 'variable WOFF2 descriptor dialog');
  app.querySelector('#font-family-name').value = variableFamily;
  app.querySelector('#font-weight-value').value = '400';
  app.querySelector('#font-style-value').value = 'normal';
  click(app, app.querySelector('#font-import-confirm'));
  await waitFor(() => {
    const row = [...app.querySelectorAll('#font-assets-list .local-font-row')]
      .find(item => item.textContent.includes(variableFamily));
    return row?.textContent.includes('opsz 14–32') && row.textContent.includes('wght 100–900')
      && [...faceStub.faces].some(face => face.family === variableFamily && face.weight === '100 900');
  }, 'background variable WOFF2 axis inspection and face upgrade', 75_000);
  const variableMetadata = (await readStore(app, 'fontMetadata')).find(record => record.family === variableFamily);
  variableFontId = variableMetadata?.id;
  assert(variableFontId, 'the variable WOFF2 font metadata was not stored.');
  const variableRow = [...app.querySelectorAll('#font-assets-list .local-font-row')]
    .find(row => row.textContent.includes(variableFamily));
  assert(variableRow.textContent.includes('opsz 14–32') && variableRow.textContent.includes('wght 100–900'),
    'the bundled local WASM decoder should discover the WOFF2 optical-size and weight axis ranges.');
  assert([...faceStub.faces].some(face => face.family === variableFamily && face.weight === '100 900'),
    'the variable WOFF2 weight axis should configure an honest FontFace matching range.');

  click(app, app.querySelector('#file-menu-button'));
  const newDesign = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.includes('New design'));
  assert(newDesign, 'the editor did not expose a local new-design action for the text workflow.');
  click(app, newDesign);
  await waitFor(() => app.querySelector('#toast-region')?.textContent.includes('New local design created.'), 'clean local design');

  click(app, app.querySelector('[data-tool="text"]'));
  const canvas = app.querySelector('#scene-canvas');
  Object.defineProperty(canvas, 'setPointerCapture', { configurable: true, value: () => {} });
  const rect = canvas.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const Pointer = app.defaultView.PointerEvent;
  assert(Pointer, 'the editor needs PointerEvent support for the text-layer interaction.');
  canvas.dispatchEvent(new Pointer('pointerdown', { bubbles: true, cancelable: true, pointerId: 81, pointerType: 'mouse', button: 0, clientX: x, clientY: y }));
  canvas.dispatchEvent(new Pointer('pointerup', { bubbles: true, cancelable: true, pointerId: 81, pointerType: 'mouse', button: 0, clientX: x, clientY: y }));
  await waitFor(() => !app.querySelector('#text-editor-overlay')?.hidden, 'text editor');
  const textEditor = app.querySelector('#text-editor-overlay');
  textEditor.textContent = 'Local font smoke';
  textEditor.dispatchEvent(new app.defaultView.Event('input', { bubbles: true }));
  click(app, app.querySelector('[data-text-format-done]'));
  await waitFor(() => app.querySelector('[data-prop="fontFamily"]'), 'text font family control');
  const textFamilyControl = app.querySelector('[data-prop="fontFamily"]');
  assert(textFamilyControl.list?.id === 'font-family-options', 'text layers should use the local/system family option catalog.');
  textFamilyControl.value = family;
  textFamilyControl.dispatchEvent(new app.defaultView.Event('input', { bubbles: true }));
  textFamilyControl.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
  await waitFor(async () => {
    const records = await readStore(app, 'documents');
    return records.some(record => record.document?.pages?.some(page => page.children?.some(node => node.type === 'text' && node.fontFamily === family)));
  }, 'selected local font saved on a text layer');

  const packageDocument = createDocument();
  packageDocument.name = 'Local font package smoke';
  const packageText = createNode('text', { text: 'Portable font', fontFamily: `${family}, Arial, sans-serif`, fontWeight: 700, fontStyle: 'italic' });
  addNode(packageDocument, packageText);
  const packageBytes = tinyWoff2(2);
  const packed = packLocalPackage(packageDocument, [], [{
    id: originalFontId, name: 'smoke-display-copy.woff2', type: 'font/woff2', family, weight: 700, style: 'italic', bytes: packageBytes
  }]);
  const decoded = unpackLocalPackage(packed);
  assert(decoded.fonts.length === 1 && decoded.fonts[0].id === originalFontId,
    'the .flocal manifest did not include the local font identity.');
  assert(decoded.fonts[0].bytes.join(',') === [...packageBytes].join(','), '.flocal did not retain the exact font bytes.');

  setFile(app, '#open-file-input', new app.defaultView.File([packed], 'local-font-smoke.flocal', { type: 'application/octet-stream' }));
  await waitFor(async () => {
    const records = await readStore(app, 'documents');
    return records.some(record => record.id === packageDocument.id
      && record.document?.pages?.some(page => page.children?.some(node => node.type === 'text'
        && node.fontFamily === `${family} Imported, Arial, sans-serif`)));
  }, '.flocal font collision remapping');
  const importedMetadata = (await readStore(app, 'fontMetadata')).find(record => record.family === `${family} Imported`);
  assert(importedMetadata, 'the .flocal import did not persist a remapped font face.');
  importedFontId = importedMetadata.id;
  const importedBinary = (await readStore(app, 'fontAssets')).find(record => record.id === importedFontId);
  assert(importedBinary?.bytes && new Uint8Array(importedBinary.bytes).join(',') === [...packageBytes].join(','),
    'the imported .flocal font bytes did not round-trip through IndexedDB.');
  assert([...app.querySelector('#font-family-options').options].some(option => option.value === `${family} Imported`),
    'the remapped family was not available to imported text layers.');

  for (const id of [originalFontId, variableFontId, importedFontId]) {
    const remove = app.querySelector(`[data-font-id="${id}"]`);
    assert(remove, `The font catalog did not expose an accessible remove control for ${id}.`);
    click(app, remove);
    await waitFor(async () => !(await readStore(app, 'fontMetadata')).some(record => record.id === id), `font ${id} removal`);
  }
  assert(!(await readStore(app, 'fontAssets')).some(record => [originalFontId, variableFontId, importedFontId].includes(record.id)),
    'font removal left orphaned binary data in IndexedDB.');
  assert(![...faceStub.faces].some(face => [family, variableFamily, `${family} Imported`].includes(face.family)),
    'font removal left a local face registered in the document.');

  result.textContent = `PASS\n${JSON.stringify({ fontDialog: true, accessibleDescriptors: true, indexedDbMetadata: true, indexedDbBytesRoundTrip: true, woff2VariableAxisInspection: true, woff2WeightRange: true, textFamilyOptions: true, textFamilyApplied: true, flocalFontBytes: true, flocalCollisionRemapping: true, removeClearsMetadataBinaryAndFace: true, stubbedFontFaces: faceStub.faces.size })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
} finally {
  if (app) {
    const dialog = app.querySelector('#font-import-dialog');
    if (dialog?.open) dialog.close();
    if (faceStub) {
      const remaining = (await readStore(app, 'fontMetadata').catch(() => []))
        .filter(record => [family, variableFamily, `${family} Imported`].includes(record.family));
      for (const record of remaining) await deleteFontAsset(record.id).catch(() => {});
      faceStub.restore();
    }
  }
}
