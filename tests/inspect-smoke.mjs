import { addNode, createDocument, createNode } from '../src/model.js';

const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 10000) {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      try { if (test()) { resolve(); return; } } catch { /* Wait for editor startup and asynchronous clipboard actions. */ }
      if (performance.now() - start > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(poll, 30);
    };
    poll();
  });
}
async function waitForSaveCycle(app, label) {
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saving locally'), `${label} save start`);
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), `${label} save completion`);
}
function click(element, options = {}) {
  assert(element, 'Expected an Inspect workflow control.');
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...options }));
}
function readDocuments() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('figma-local-documents', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result; const get = db.transaction('documents').objectStore('documents').getAll();
      get.onsuccess = () => { resolve(get.result); db.close(); };
      get.onerror = () => { reject(get.error); db.close(); };
    };
  });
}
function packageFile(documentData) {
  const manifest = new TextEncoder().encode(JSON.stringify({ schema: documentData.schema, document: documentData, assets: [] }));
  const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, manifest.byteLength, true);
  const parts = [new Uint8Array([70, 76, 79, 67, 65, 76, 1]), length, manifest];
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}

try {
  await waitFor(() => frame.contentDocument?.documentElement.dataset.appReady === 'true', 'editor startup');
  const app = frame.contentDocument;
  assert(app.title === 'Tiny Image Star', 'The editor should use Tiny Image Star as its public name.');
  const design = createDocument();
  const screen = createNode('frame', { name: 'Mobile screen', x: 30, y: 40, width: 350, height: 700, autoLayout: { axis: 'vertical', gap: 16, padding: 20 } });
  const button = createNode('rectangle', { name: 'Primary button', x: 18, y: 24, width: 180, height: 52, minWidth: 150, maxWidth: 240, minHeight: 44, maxHeight: 72, fill: '#1769aa', radius: 10, rotation: 3 });
  const label = createNode('text', { name: 'Button label', x: 24, y: 38, width: 160, height: 28, text: 'Continue', fontFamily: 'Arial, sans-serif', fontSize: 16, fontWeight: 600, lineHeight: 1.5, letterSpacing: 0.25, color: '#ffffff' });
  addNode(design, screen); addNode(design, button, { parentId: screen.id }); addNode(design, label, { parentId: screen.id });
  const input = app.querySelector('#open-file-input'); const transfer = new DataTransfer();
  transfer.items.add(new File([packageFile(design)], 'inspect-smoke.flocal', { type: 'application/octet-stream' }));
  Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => [...app.querySelectorAll('#toast-region .toast')].some(toast => toast.textContent.includes('Local design opened')), 'design import');

  click(app.querySelector(`[data-layer-id="${label.id}"]`));
  const textFit = app.querySelector('[data-prop="textFit"]');
  assert(textFit && ['fixed', 'auto-height', 'auto-width'].every(value => [...textFit.options].some(option => option.value === value)), 'text resize modes should be available on the phone');
  assert(textFit.getBoundingClientRect().right <= app.querySelector('#right-panel').getBoundingClientRect().right, 'the text resize control should fit inside the phone inspector');
  const phoneInspectorRight = app.querySelector('#right-panel').getBoundingClientRect().right;
  const textCase = app.querySelector('[data-prop="textCase"]');
  const textDecoration = app.querySelector('[data-prop="textDecoration"]');
  const verticalAlign = app.querySelector('[data-prop="verticalAlign"]');
  assert(textCase && ['none', 'uppercase', 'lowercase', 'capitalize'].every(value => [...textCase.options].some(option => option.value === value)), 'text case options should be available on the phone');
  assert(textDecoration && ['none', 'underline', 'line-through'].every(value => [...textDecoration.options].some(option => option.value === value)), 'text decoration options should be available on the phone');
  assert(verticalAlign && ['top', 'middle', 'bottom'].every(value => [...verticalAlign.options].some(option => option.value === value)), 'vertical text alignment options should be available on the phone');
  assert(textCase.getBoundingClientRect().right <= phoneInspectorRight && textDecoration.getBoundingClientRect().right <= phoneInspectorRight && verticalAlign.getBoundingClientRect().right <= phoneInspectorRight, 'text styling controls should fit inside the phone inspector');
  const textWidth = app.querySelector('[data-prop="width"]');
  textWidth.value = '50'; textWidth.dispatchEvent(new Event('input', { bubbles: true })); textWidth.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForSaveCycle(app, 'auto-height text');
  const textRecords = await readDocuments(); textRecords.sort((a, b) => b.savedAt - a.savedAt);
  const savedLabel = textRecords[0]?.document?.pages.flatMap(page => page.children.flatMap(parent => parent.children || [])).find(node => node.id === label.id);
  assert(savedLabel?.textFit === 'auto-height' && savedLabel.width === 50 && savedLabel.height >= 36, 'auto-height text should resize and persist after its width changes');
  const autoWidth = app.querySelector('[data-prop="textFit"]');
  autoWidth.value = 'auto-width'; autoWidth.dispatchEvent(new Event('input', { bubbles: true })); autoWidth.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForSaveCycle(app, 'auto-width text');
  const autoWidthRecords = await readDocuments(); autoWidthRecords.sort((a, b) => b.savedAt - a.savedAt);
  const savedAutoWidth = autoWidthRecords[0]?.document?.pages.flatMap(page => page.children.flatMap(parent => parent.children || [])).find(node => node.id === label.id);
  assert(savedAutoWidth?.textFit === 'auto-width' && savedAutoWidth.width > 50 && savedAutoWidth.width < 160, 'auto-width text should fit its measured line and persist the selected mode');
  const mobileTextCase = app.querySelector('[data-prop="textCase"]');
  mobileTextCase.value = 'uppercase'; mobileTextCase.dispatchEvent(new Event('input', { bubbles: true })); mobileTextCase.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForSaveCycle(app, 'uppercase text');
  const mobileTextDecoration = app.querySelector('[data-prop="textDecoration"]');
  mobileTextDecoration.value = 'underline'; mobileTextDecoration.dispatchEvent(new Event('input', { bubbles: true })); mobileTextDecoration.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForSaveCycle(app, 'underlined text');
  const renderedTextRecords = await readDocuments(); renderedTextRecords.sort((a, b) => b.savedAt - a.savedAt);
  const savedRenderedText = renderedTextRecords[0]?.document?.pages.flatMap(page => page.children.flatMap(parent => parent.children || [])).find(node => node.id === label.id);
  assert(savedRenderedText?.text === 'Continue' && savedRenderedText.textCase === 'uppercase' && savedRenderedText.textDecoration === 'underline', 'mobile text rendering controls should preserve the source copy and persist display casing and decoration');
  const mobileVerticalAlign = app.querySelector('[data-prop="verticalAlign"]');
  mobileVerticalAlign.value = 'bottom'; mobileVerticalAlign.dispatchEvent(new Event('input', { bubbles: true })); mobileVerticalAlign.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForSaveCycle(app, 'bottom-aligned text');
  const verticalRecords = await readDocuments(); verticalRecords.sort((a, b) => b.savedAt - a.savedAt);
  const savedVerticalText = verticalRecords[0]?.document?.pages.flatMap(page => page.children.flatMap(parent => parent.children || [])).find(node => node.id === label.id);
  assert(savedVerticalText?.verticalAlign === 'bottom', 'mobile vertical alignment should persist with the local design');
  click(app.querySelector(`[data-layer-id="${button.id}"]`));
  const limitFields = [...app.querySelectorAll('.size-limits-grid .size-limit-field')];
  assert(limitFields.length === 4 && limitFields.every(field => field.getBoundingClientRect().width >= 96), 'the four size-limit controls should remain readable in the phone inspector');
  const maxWidthInput = app.querySelector('[data-prop="maxWidth"]');
  maxWidthInput.value = '200'; maxWidthInput.dispatchEvent(new Event('input', { bubbles: true })); maxWidthInput.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForSaveCycle(app, 'size-limit');
  const savedRecords = await readDocuments(); savedRecords.sort((a, b) => b.savedAt - a.savedAt);
  const savedButton = savedRecords[0]?.document.pages.flatMap(page => page.children).flatMap(frameNode => frameNode.children || []).find(node => node.id === button.id);
  assert(savedButton?.minWidth === 150 && savedButton.maxWidth === 200 && savedButton.minHeight === 44 && savedButton.maxHeight === 72, 'size limits should persist in the local document');
  const rightPanel = app.querySelector('#right-panel').getBoundingClientRect();
  const fillType = app.querySelector('[data-prop="fillType"]');
  assert(fillType && ['solid', 'linear', 'radial'].every(value => [...fillType.options].some(option => option.value === value)) && fillType.getBoundingClientRect().right <= rightPanel.right, 'gradient fill options should be available inside the phone inspector');
  fillType.value = 'linear'; fillType.dispatchEvent(new Event('input', { bubbles: true })); fillType.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForSaveCycle(app, 'linear gradient');
  const firstStopColor = app.querySelector('[data-gradient-field="color"]');
  const firstStopPosition = app.querySelector('[data-gradient-field="position"]');
  assert(firstStopColor && firstStopPosition && firstStopPosition.getBoundingClientRect().right <= rightPanel.right, 'gradient stop controls should fit in the phone inspector');
  firstStopColor.value = '#00ff00'; firstStopColor.dispatchEvent(new Event('input', { bubbles: true })); firstStopColor.dispatchEvent(new Event('change', { bubbles: true }));
  firstStopPosition.value = '20'; firstStopPosition.dispatchEvent(new Event('input', { bubbles: true })); firstStopPosition.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForSaveCycle(app, 'gradient stop tuning');
  click(app.querySelector('[data-action="add-gradient-stop"]'));
  await waitForSaveCycle(app, 'additional gradient stop');
  const radialType = app.querySelector('[data-prop="fillType"]');
  radialType.value = 'radial'; radialType.dispatchEvent(new Event('input', { bubbles: true })); radialType.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForSaveCycle(app, 'radial gradient');
  const gradientRecords = await readDocuments(); gradientRecords.sort((a, b) => b.savedAt - a.savedAt);
  const gradientButton = gradientRecords[0]?.document.pages.flatMap(page => page.children).flatMap(frameNode => frameNode.children || []).find(node => node.id === button.id);
  assert(gradientButton?.fillGradient?.type === 'radial' && gradientButton.fillGradient.stops.length === 3 && gradientButton.fillGradient.stops[0].color === '#00ff00' && gradientButton.fillGradient.stops[0].position === 0.2, 'gradient type, stop position, color, and additional stop should persist');
  const addShadow = app.querySelector('[data-action="add-layer-effect"][data-effect-type="drop-shadow"]');
  assert(addShadow && addShadow.getBoundingClientRect().right <= rightPanel.right, 'effect actions should fit inside the phone inspector');
  click(addShadow);
  await waitForSaveCycle(app, 'drop shadow');
  const shadowX = app.querySelector('[data-effect-field="offsetX"]');
  const shadowOpacity = app.querySelector('[data-effect-field="opacity"]');
  assert(shadowX && shadowOpacity, 'the inspector should expose shadow offset and opacity controls');
  shadowX.value = '6'; shadowX.dispatchEvent(new Event('input', { bubbles: true })); shadowX.dispatchEvent(new Event('change', { bubbles: true }));
  shadowOpacity.value = '45'; shadowOpacity.dispatchEvent(new Event('input', { bubbles: true })); shadowOpacity.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForSaveCycle(app, 'shadow tuning');
  click(app.querySelector('[data-action="add-layer-effect"][data-effect-type="layer-blur"]'));
  await waitForSaveCycle(app, 'layer blur');
  const blurRadius = app.querySelector('[data-effect-field="radius"]');
  blurRadius.value = '3'; blurRadius.dispatchEvent(new Event('input', { bubbles: true })); blurRadius.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForSaveCycle(app, 'blur tuning');
  const effectRecords = await readDocuments(); effectRecords.sort((a, b) => b.savedAt - a.savedAt);
  const effectButton = effectRecords[0]?.document.pages.flatMap(page => page.children).flatMap(frameNode => frameNode.children || []).find(node => node.id === button.id);
  assert(effectButton?.effects?.length === 2 && effectButton.effects[0].offsetX === 6 && effectButton.effects[0].opacity === 0.45 && effectButton.effects[1].radius === 3, 'shadow and blur settings should save together on the selected layer');
  click(app.querySelector('[data-inspector-tab="prototype"]'));
  let prototypeTransition = app.querySelector('#prototype-transition');
  assert([...prototypeTransition.options].some(option => option.value === 'smart-animate') && prototypeTransition.getBoundingClientRect().right <= app.querySelector('#right-panel').getBoundingClientRect().right, 'Smart animate should remain available inside the phone prototype inspector');
  prototypeTransition.value = 'smart-animate'; prototypeTransition.dispatchEvent(new Event('change', { bubbles: true }));
  const prototypeEasing = app.querySelector('#prototype-easing');
  assert(prototypeEasing && prototypeEasing.getBoundingClientRect().right <= app.querySelector('#right-panel').getBoundingClientRect().right, 'the easing control should fit inside the phone prototype inspector');
  const prototypeAction = app.querySelector('#prototype-action');
  prototypeAction.value = 'open-overlay'; prototypeAction.dispatchEvent(new Event('change', { bubbles: true }));
  assert(![...app.querySelectorAll('#prototype-transition option')].some(option => option.value === 'smart-animate'), 'the phone prototype inspector should keep overlay transitions separate');
  prototypeAction.value = 'navigate'; prototypeAction.dispatchEvent(new Event('change', { bubbles: true }));
  click(app.querySelector('[data-inspector-tab="inspect"]'));
  await waitFor(() => app.querySelector('.inspect-panel'), 'Inspect panel');
  const panel = app.querySelector('.inspect-panel');
  const css = panel.querySelector('.inspect-code-card code')?.textContent || '';
  assert(panel.textContent.includes('50, 60 px') && css.includes('position: relative;') && !css.includes('left: 50px;'), 'Inspect did not report page-space values while keeping an auto-layout child in flow.');
  assert(css.includes('background: radial-gradient(circle,') && css.includes('filter: drop-shadow(') && css.includes(' blur(3px);') && css.includes('border-radius: 10px;') && css.includes('rotate(3deg)'), 'Inspect CSS omitted resolved gradient or layer effects.');
  assert(css.includes('min-width: 150px;') && css.includes('max-width: 200px;') && css.includes('min-height: 44px;') && css.includes('max-height: 72px;'), 'Inspect CSS omitted the selected layer size limits.');
  assert(panel.textContent.includes('Primary button') && panel.textContent.includes('Mobile screen'), 'The selected layer or its owner is missing from the handoff summary.');
  const html = [...panel.querySelectorAll('.inspect-code-card')].find(card => card.querySelector('strong')?.textContent === 'HTML structure')?.querySelector('code')?.textContent || '';
  assert(html.includes('data-layer-type="rectangle"'), 'HTML handoff should include the selected layer.');
  assert(Number.parseFloat(app.defaultView.getComputedStyle(panel.querySelector('.inspect-copy')).minHeight) >= 40, 'Copy control should remain finger-sized on a phone viewport.');

  const copied = [];
  Object.defineProperty(app.defaultView.navigator, 'clipboard', { configurable: true, value: { writeText: async text => copied.push(text) } });
  click(panel.querySelector('[data-inspect-copy="css"]'));
  await waitFor(() => copied.length === 1, 'copy CSS');
  assert(copied[0] === css, 'Copy CSS did not copy the visible generated CSS.');
  click(panel.querySelector('[data-inspect-copy="html"]'));
  await waitFor(() => copied.length === 2, 'copy HTML');
  assert(copied[1] === html, 'Copy HTML did not copy the visible generated markup.');
  click(panel.querySelector('[data-inspect-copy="json"]'));
  await waitFor(() => copied.length === 3, 'copy layer JSON');
  assert(JSON.parse(copied[2]).id === button.id, 'Copy JSON did not preserve exact selected layer data.');

  click(app.querySelector(`[data-layer-id="${screen.id}"]`));
  await waitFor(() => app.querySelector('.inspect-panel .inspect-code-card:nth-of-type(2) code')?.textContent.includes('data-layer-type="text"'), 'nested frame HTML handoff');
  const frameHtml = app.querySelector('.inspect-panel .inspect-code-card:nth-of-type(2) code')?.textContent || '';
  assert(frameHtml.includes('data-layer-type="frame"') && frameHtml.includes('data-layer-type="text"') && frameHtml.includes('Continue'), 'HTML handoff should preserve nested frame and text structure.');

  click(app.querySelector(`[data-layer-id="${label.id}"]`));
  await waitFor(() => app.querySelector('.inspect-panel')?.textContent.includes('16 px · Arial, sans-serif'), 'text metrics');
  assert(app.querySelector('.inspect-panel').textContent.includes('Continue'), 'Inspect panel did not show resolved text content.');
  const selectedVerticalAlign = app.querySelector('[data-prop="verticalAlign"]')?.value;
  const handoffJson = app.querySelector('.inspect-json-card pre code')?.textContent || '[]';
  const handoffLayer = JSON.parse(handoffJson)[0];
  const verticalCss = app.querySelector('.inspect-panel .inspect-code-card code')?.textContent || '';
  assert(verticalCss.includes('justify-content: flex-end;'), `Inspect CSS should hand off bottom-aligned text; control=${selectedVerticalAlign}, layer=${handoffLayer?.verticalAlign}, typography=${handoffLayer?.typography?.verticalAlign}; found: ${verticalCss}`);
  result.textContent = `PASS\n${JSON.stringify({ productName: 'Tiny Image Star', nestedPageCoordinates: true, resolvedStyleValues: true, nestedHtmlHandoff: true, typography: true, verticalTextAlignment: true, exactLayerJson: true, clipboardCopy: true, phoneSizedActions: true })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
}
