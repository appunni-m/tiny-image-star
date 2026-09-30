const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');

function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 20000) {
  result.textContent = `RUNNING: ${label}…`;
  return new Promise((resolve, reject) => {
    let lastError = null;
    const deadline = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.${lastError ? ` Last probe failed: ${lastError.message || lastError}` : ''}`)), timeout);
    const poll = async () => {
      try {
        if (await test()) { clearTimeout(deadline); resolve(); return; }
        lastError = null;
      } catch (error) {
        lastError = error;
      }
      setTimeout(() => { void poll(); }, 35);
    };
    poll();
  });
}
function tap(app, element) {
  assert(element, 'Expected a rich text control.');
  const Pointer = app.defaultView.PointerEvent;
  if (Pointer) {
    element.dispatchEvent(new Pointer('pointerdown', { bubbles: true, cancelable: true, pointerId: 37, pointerType: 'touch', button: 0 }));
    element.dispatchEvent(new Pointer('pointerup', { bubbles: true, cancelable: true, pointerId: 37, pointerType: 'touch', button: 0 }));
  }
  element.dispatchEvent(new app.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}
function dispatchCanvasPointer(app, canvas, type, clientX, clientY, pointerId) {
  Object.defineProperty(canvas, 'setPointerCapture', { configurable: true, value: () => {} });
  canvas.dispatchEvent(new app.defaultView.PointerEvent(type, { bubbles: true, cancelable: true, pointerId, pointerType: 'touch', button: 0, clientX, clientY }));
}
function createTextAtCenter(app, pointerId) {
  tap(app, app.querySelector('.tool-button[data-tool="text"]'));
  const canvas = app.querySelector('#scene-canvas'); const rect = canvas.getBoundingClientRect();
  const x = rect.left + rect.width * (pointerId % 2 ? .45 : .65); const y = rect.top + rect.height * (pointerId % 2 ? .48 : .62);
  dispatchCanvasPointer(app, canvas, 'pointerdown', x, y, pointerId);
  dispatchCanvasPointer(app, canvas, 'pointerup', x, y, pointerId);
}
function textPointAt(editor, position) {
  const walker = editor.ownerDocument.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let remaining = position;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (remaining <= node.length) return { node, offset: remaining };
    remaining -= node.length;
  }
  const last = editor.lastChild;
  if (last?.nodeType === Node.TEXT_NODE) return { node: last, offset: last.length };
  if (last) {
    const nested = editor.ownerDocument.createTreeWalker(last, NodeFilter.SHOW_TEXT);
    let node; let final = null;
    while ((node = nested.nextNode())) final = node;
    if (final) return { node: final, offset: final.length };
  }
  const empty = editor.ownerDocument.createTextNode(''); editor.append(empty);
  return { node: empty, offset: 0 };
}
function selectRange(app, editor, start, end) {
  const from = textPointAt(editor, start); const to = textPointAt(editor, end);
  const range = app.createRange(); range.setStart(from.node, from.offset); range.setEnd(to.node, to.offset);
  const selection = app.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  editor.dispatchEvent(new app.defaultView.MouseEvent('mouseup', { bubbles: true }));
}
const documentDatabases = new WeakMap();
function documentDatabase(app) {
  if (documentDatabases.has(app)) return documentDatabases.get(app);
  const pending = new Promise((resolve, reject) => {
    const request = app.defaultView.indexedDB.open('figma-local-documents');
    const deadline = setTimeout(() => reject(new Error('Timed out opening the local document database.')), 5000);
    request.onerror = () => { clearTimeout(deadline); reject(request.error); };
    request.onblocked = () => { clearTimeout(deadline); reject(new Error('Local document database open was blocked.')); };
    request.onsuccess = () => {
      clearTimeout(deadline);
      resolve(request.result);
    };
  });
  documentDatabases.set(app, pending);
  return pending;
}
async function readDocuments(app) {
  const db = await documentDatabase(app);
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('documents', 'readonly');
    const get = transaction.objectStore('documents').getAll();
    get.onsuccess = () => resolve(get.result);
    get.onerror = () => reject(get.error);
    transaction.onabort = () => reject(transaction.error || new Error('Local document read was aborted.'));
    transaction.onerror = () => reject(transaction.error || new Error('Local document read failed.'));
  });
}
function documentByName(app, name) {
  return readDocuments(app).then(records => records.find(record => record.document?.name === name)?.document);
}
function documentById(app, id) {
  return readDocuments(app).then(records => records.find(record => record.id === id)?.document);
}
function textNode(documentData, text) {
  for (const page of documentData?.pages || []) {
    const stack = [...page.children];
    while (stack.length) {
      const node = stack.pop();
      if (node.type === 'text' && node.text === text) return node;
      stack.push(...(node.children || []));
    }
  }
  return null;
}
function assertTouchReachable(app, element, label) {
  const rect = element.getBoundingClientRect();
  assert(rect.width >= 40 && rect.height >= 40, `${label} should be at least 40×40px (got ${Math.round(rect.width)}×${Math.round(rect.height)}).`);
  const scroll = app.querySelector('#canvas-scroll').getBoundingClientRect();
  assert(rect.left >= scroll.left && rect.right <= scroll.right && rect.top >= scroll.top && rect.bottom <= scroll.bottom,
    `${label} must fit inside the phone canvas viewport.`);
  const hit = app.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  assert(hit === element || element.contains(hit), `${label} should be reachable at its visible touch center.`);
}

try {
  await waitFor(() => frame.contentDocument?.documentElement.dataset.appReady === 'true', 'phone-sized editor startup');
  let app = frame.contentDocument;
  assert(app.defaultView.innerWidth === 390 && app.defaultView.innerHeight === 844, 'rich text smoke must run at a 390×844 phone viewport.');
  tap(app, app.querySelector('#file-menu-button'));
  const newDesign = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.includes('New design'));
  assert(newDesign, 'the mobile File menu should offer a new local design.');
  tap(app, newDesign);
  await waitFor(() => app.querySelectorAll('.layer-row[data-layer-id]').length === 0, 'fresh design');
  await waitFor(() => !app.querySelector('#document-name')?.closest('.topbar')?.inert
    && app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'fresh design editing unlock');

  // The smoke can run beside other browser checks on the same origin. Give its
  // document a unique identity so another check's newer save cannot look like
  // this editor failed to autosave.
  const smokeDocumentName = `Rich text smoke ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const documentName = app.querySelector('#document-name');
  documentName.value = smokeDocumentName;
  documentName.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
  let saved;
  await waitFor(async () => { saved = await documentByName(app, smokeDocumentName); return Boolean(saved); }, 'isolated smoke document save');
  const smokeDocumentId = saved.id;

  createTextAtCenter(app, 81);
  await waitFor(() => !app.querySelector('#text-editor-overlay')?.hidden, 'new text editor');
  let editor = app.querySelector('#text-editor-overlay');
  const originalText = 'Make images feel yours';
  editor.textContent = originalText;
  editor.dispatchEvent(new app.defaultView.InputEvent('input', { bubbles: true, inputType: 'insertText', data: originalText }));
  await waitFor(() => app.querySelector('#text-format-toolbar')?.hidden === false, 'rich text toolbar');
  let toolbar = app.querySelector('#text-format-toolbar');
  const controls = '.text-format-button, #text-format-family, #text-format-weight, #text-format-size, #text-format-line-height, #text-format-spacing, #text-format-decoration, #text-format-color, .text-format-done';
  const actions = [...toolbar.querySelectorAll(controls)];
  for (const control of actions) assertTouchReachable(app, control, control.getAttribute('aria-label') || control.textContent.trim() || control.id);

  const editorRange = (needle, offset = 0) => {
    const start = originalText.indexOf(needle) + offset;
    assert(start >= 0, `could not locate ${needle} in test text`);
    selectRange(app, editor, start, start + needle.length);
  };
  editorRange('images');
  tap(app, toolbar.querySelector('[data-text-format="bold"]'));
  editorRange('images');
  const fontWeight = toolbar.querySelector('#text-format-weight'); fontWeight.value = '800'; fontWeight.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
  editorRange('images');
  const decoration = toolbar.querySelector('#text-format-decoration'); decoration.value = 'underline'; decoration.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
  editorRange('images');
  const fontFamily = toolbar.querySelector('#text-format-family'); fontFamily.value = 'Georgia, serif'; fontFamily.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
  editorRange('images');
  const letterSpacing = toolbar.querySelector('#text-format-spacing'); letterSpacing.value = '1.2'; letterSpacing.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
  editorRange('feel');
  tap(app, toolbar.querySelector('[data-text-format="italic"]'));
  editorRange('yours');
  const fontSize = toolbar.querySelector('#text-format-size'); fontSize.value = '36'; fontSize.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
  editorRange('yours');
  const lineHeight = toolbar.querySelector('#text-format-line-height'); lineHeight.value = '1.6'; lineHeight.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
  editorRange('yours');
  const color = toolbar.querySelector('#text-format-color'); color.value = '#f0123c'; color.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
  editorRange(originalText);
  const mixedWeight = toolbar.querySelector('#text-format-weight');
  const mixedFamily = toolbar.querySelector('#text-format-family');
  const mixedSize = toolbar.querySelector('#text-format-size');
  const mixedColor = toolbar.querySelector('#text-format-color');
  const mixedSpacing = toolbar.querySelector('#text-format-spacing');
  assert(mixedWeight.dataset.mixed === 'true' && mixedWeight.value === '' && /mixed values/i.test(mixedWeight.getAttribute('aria-label')),
    'a range spanning different weights should expose an accessible Mixed state instead of the first run value.');
  assert(mixedFamily.dataset.mixed === 'true' && mixedFamily.value === '' && mixedFamily.placeholder === 'Mixed',
    'a range spanning different font families should display Mixed.');
  assert(mixedSize.dataset.mixed === 'true' && mixedSize.value === '' && mixedSize.placeholder === 'Mixed',
    'a range spanning different font sizes should display Mixed.');
  assert(mixedColor.dataset.mixed === 'true' && /mixed values/i.test(mixedColor.getAttribute('aria-label')),
    'a range spanning different colors should identify the color control as mixed.');
  assert(mixedSpacing.dataset.mixed === 'true' && mixedSpacing.value === '',
    'a range spanning different letter spacing should display Mixed.');
  mixedSpacing.value = '2.4'; mixedSpacing.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
  assert([...editor.querySelectorAll('[data-text-run="true"]')].every(span => span.dataset.runLetterSpacing === '2.4'),
    'applying a new value from a mixed field should format the entire selected range.');
  const editSpans = [...editor.querySelectorAll('[data-text-run="true"]')];
  assert(editSpans.some(span => span.textContent === 'images' && span.getAttribute('data-run-font-weight') === '800' && span.dataset.runTextDecoration === 'underline' && span.dataset.runFontFamily === 'Georgia, serif' && span.dataset.runLetterSpacing === '2.4'), 'the editor did not apply the selected word weight, decoration, family, and spacing.');
  assert(editSpans.some(span => span.textContent === 'feel' && span.getAttribute('data-run-font-style') === 'italic'), 'the editor did not wrap the selected word in italic formatting.');
  assert(editSpans.some(span => span.textContent === 'yours' && span.getAttribute('data-run-font-size') === '36' && span.getAttribute('data-run-line-height') === '1.6' && span.getAttribute('data-run-color') === '#f0123c'),
    'font size, line height, and color were not applied to the same selected range.');
  tap(app, toolbar.querySelector('[data-text-format-done]'));
  await waitFor(() => editor.hidden, 'text edit commit');
  await waitFor(async () => { saved = await documentById(app, smokeDocumentId); return Boolean(textNode(saved, originalText)); }, 'rich text autosave');
  let richNode = textNode(saved, originalText);
  assert(richNode?.textRuns?.map(run => run.text).join('') === originalText, 'the saved rich runs did not concatenate exactly to the text.');
  const boldRun = richNode.textRuns.find(run => run.text === 'images');
  const italicRun = richNode.textRuns.find(run => run.text === 'feel');
  const coloredRun = richNode.textRuns.find(run => run.text === 'yours');
  assert(boldRun?.fontWeight === 800 && boldRun.textDecoration === 'underline' && boldRun.fontFamily === 'Georgia, serif' && boldRun.letterSpacing === 2.4 && italicRun?.fontStyle === 'italic', 'saved weight, decoration, family, spacing, or italic styles did not match the selection.');
  assert(coloredRun?.fontSize === 36 && coloredRun?.lineHeight === 1.6 && coloredRun?.color === '#f0123c', 'saved range size/line-height/color did not match the selected text.');

  const beforeFirstReload = app;
  frame.contentWindow.location.reload();
  await waitFor(() => frame.contentDocument !== beforeFirstReload
    && frame.contentDocument?.documentElement.dataset.appReady === 'true'
    && frame.contentDocument.querySelector(`.layer-row[data-layer-id="${richNode.id}"]`), 'saved rich text after reload');
  app = frame.contentDocument;
  assert(app.querySelector('#document-name').value === smokeDocumentName, 'reload opened a different local document during the rich text smoke.');
  const reloaded = await documentById(app, smokeDocumentId);
  richNode = textNode(reloaded, originalText);
  assert(richNode?.textRuns?.some(run => run.fontWeight === 800 && run.textDecoration === 'underline' && run.fontFamily === 'Georgia, serif' && run.letterSpacing === 2.4 && run.text === 'images'), 'reload lost the formatted range.');
  assert(richNode?.textRuns?.some(run => run.fontStyle === 'italic' && run.text === 'feel'), 'reload lost the italic range.');
  assert(richNode?.textRuns?.some(run => run.fontSize === 36 && run.lineHeight === 1.6 && run.color === '#f0123c' && run.text === 'yours'), 'reload lost the size/line-height/color range.');

  tap(app, app.querySelector('#sidebar-toggle'));
  await waitFor(() => app.querySelector('#left-panel').classList.contains('is-open'), 'phone Layers panel');
  tap(app, app.querySelector(`.layer-row[data-layer-id="${richNode.id}"]`));
  tap(app, app.querySelector('#inspector-toggle'));
  await waitFor(() => app.querySelector('#right-panel').classList.contains('is-open'), 'phone Inspector panel');
  tap(app, app.querySelector('[data-action="edit-text"]'));
  await waitFor(() => !app.querySelector('#text-editor-overlay').hidden, 'reopened rich text editor');
  editor = app.querySelector('#text-editor-overlay'); toolbar = app.querySelector('#text-format-toolbar');
  assert(editor.textContent === originalText, 'reopened text did not match the saved content.');
  const reopenedFormatted = editor.querySelector('[data-run-font-weight="800"][data-run-text-decoration="underline"][data-run-font-family="Georgia, serif"][data-run-letter-spacing="2.4"]');
  assert(reopenedFormatted?.textContent === 'images', 'reopening the editor did not render saved weight, decoration, family, and spacing spans.');
  assert(editor.querySelector('[data-run-font-style="italic"]')?.textContent === 'feel', 'reopening the editor did not render saved italic spans.');
  const reopenedColor = editor.querySelector('[data-run-color="#f0123c"]');
  assert(reopenedColor?.dataset.runFontSize === '36' && reopenedColor.dataset.runLineHeight === '1.6' && reopenedColor.textContent === 'yours', 'reopening did not render saved color, size, and line height together.');
  const actualSize = Number.parseFloat(getComputedStyle(reopenedColor).fontSize);
  assert(Math.abs(actualSize - 36) <= 1, `run font size rendered at ${actualSize}px instead of the 36px model size at 100% zoom.`);
  for (const control of [...toolbar.querySelectorAll(controls)]) {
    assertTouchReachable(app, control, control.getAttribute('aria-label') || control.textContent.trim() || control.id);
  }

  // A content-only edit after reload must keep existing run boundaries and inherit the final run's style.
  const finalTextPoint = textPointAt(editor, originalText.length);
  const endRange = app.createRange(); endRange.setStart(finalTextPoint.node, finalTextPoint.offset); endRange.collapse(true);
  app.getSelection().removeAllRanges(); app.getSelection().addRange(endRange);
  finalTextPoint.node.parentElement.append(app.createTextNode('!'));
  editor.dispatchEvent(new app.defaultView.InputEvent('input', { bubbles: true, inputType: 'insertText', data: '!' }));
  assert(editor.textContent === `${originalText}!`, 'the appended character was not present in the editor before commit.');
  tap(app, toolbar.querySelector('[data-text-format-done]'));
  await waitFor(() => editor.hidden, 'reopened edit commit');
  assert(app.querySelector('#save-state')?.lastElementChild.textContent === 'Saving locally…', 'the appended rich text commit did not start an autosave.');
  await waitFor(() => {
    const state = app.querySelector('#save-state')?.lastElementChild.textContent || 'missing save status';
    return state === 'Saved locally';
  }, 'appended rich text save completion');

  const beforeAppendReload = app;
  frame.contentWindow.location.reload();
  await waitFor(() => frame.contentDocument !== beforeAppendReload
    && frame.contentDocument?.documentElement.dataset.appReady === 'true'
    && frame.contentDocument.querySelector(`.layer-row[data-layer-id="${richNode.id}"]`), 'appended rich text after reload');
  app = frame.contentDocument;
  assert(app.querySelector('#document-name').value === smokeDocumentName, 'reload after appending opened a different local document.');
  tap(app, app.querySelector('#sidebar-toggle'));
  await waitFor(() => app.querySelector('#left-panel').classList.contains('is-open'), 'reloaded Layers panel');
  tap(app, app.querySelector(`.layer-row[data-layer-id="${richNode.id}"]`));
  tap(app, app.querySelector('#inspector-toggle'));
  await waitFor(() => app.querySelector('#right-panel').classList.contains('is-open'), 'reloaded Inspector panel');
  tap(app, app.querySelector('[data-action="edit-text"]'));
  await waitFor(() => !app.querySelector('#text-editor-overlay').hidden, 'reopened appended rich text editor');
  editor = app.querySelector('#text-editor-overlay'); toolbar = app.querySelector('#text-format-toolbar');
  assert(editor.textContent === `${originalText}!`, 'reload lost the appended character or changed the run text.');
  assert(editor.querySelector('[data-run-font-weight="800"][data-run-text-decoration="underline"]')?.textContent === 'images', 'reload after appending lost the formatted run.');
  assert(editor.querySelector('[data-run-font-style="italic"]')?.textContent === 'feel', 'reload after appending lost the italic run.');
  const reloadedFinalRun = editor.querySelector('[data-run-color="#f0123c"]');
  assert(reloadedFinalRun?.dataset.runFontSize === '36' && reloadedFinalRun.dataset.runLineHeight === '1.6' && reloadedFinalRun.textContent === 'yours!', 'reload after appending lost the final run style.');
  for (const control of [...toolbar.querySelectorAll(controls)]) {
    assertTouchReachable(app, control, control.getAttribute('aria-label') || control.textContent.trim() || control.id);
  }
  tap(app, toolbar.querySelector('[data-text-format-done]'));
  await waitFor(() => editor.hidden, 'reloaded appended text commit');

  createTextAtCenter(app, 82);
  await waitFor(() => !app.querySelector('#text-editor-overlay')?.hidden, 'plain text editor');
  editor = app.querySelector('#text-editor-overlay'); editor.textContent = 'Ordinary plain text';
  editor.dispatchEvent(new app.defaultView.InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Ordinary plain text' }));
  tap(app, app.querySelector('[data-text-format-done]'));
  await waitFor(() => editor.hidden, 'plain text commit');
  await waitFor(async () => { saved = await documentById(app, smokeDocumentId); return Boolean(textNode(saved, 'Ordinary plain text')); }, 'plain text autosave');
  const plainNode = textNode(saved, 'Ordinary plain text');
  assert(plainNode && !Object.hasOwn(plainNode, 'textRuns'), 'ordinary plain text edits should remain plain when no range style was applied.');

  createTextAtCenter(app, 83);
  await waitFor(() => !app.querySelector('#text-editor-overlay')?.hidden, 'paragraph text editor');
  editor = app.querySelector('#text-editor-overlay'); toolbar = app.querySelector('#text-format-toolbar');
  const paragraphText = 'Alpha line\nBeta line\n\nGamma line';
  editor.textContent = paragraphText;
  editor.dispatchEvent(new app.defaultView.InputEvent('input', { bubbles: true, inputType: 'insertText', data: paragraphText }));
  selectRange(app, editor, paragraphText.indexOf('Beta'), paragraphText.indexOf('Beta') + 'Beta'.length);
  tap(app, toolbar.querySelector('[data-text-format="italic"]'));
  assert(editor.querySelector('[data-run-font-style="italic"]')?.textContent === 'Beta', 'formatting a word in a later paragraph should preserve paragraph content.');
  tap(app, toolbar.querySelector('[data-text-format-done]'));
  await waitFor(() => editor.hidden, 'paragraph edit commit');
  let paragraphDocument;
  await waitFor(async () => {
    paragraphDocument = await documentById(app, smokeDocumentId);
    return Boolean(textNode(paragraphDocument, paragraphText));
  }, 'formatted later paragraph save');
  const paragraphNode = textNode(paragraphDocument, paragraphText);
  assert(paragraphNode?.textRuns?.some(run => run.text === 'Beta' && run.fontStyle === 'italic'),
    `the formatted later-paragraph run did not persist: ${JSON.stringify((paragraphDocument?.pages || []).flatMap(page => page.children || []).map(node => ({ text: node.text, runs: node.textRuns })))}`);
  if (!app.querySelector('#right-panel').classList.contains('is-open')) tap(app, app.querySelector('#inspector-toggle'));
  await waitFor(() => app.querySelector('#right-panel').classList.contains('is-open'), 'paragraph Inspector panel');
  const paragraphSpacing = app.querySelector('[data-prop="paragraphSpacing"]');
  paragraphSpacing.value = '11'; paragraphSpacing.dispatchEvent(new app.defaultView.Event('input', { bubbles: true })); paragraphSpacing.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
  const firstLineIndent = app.querySelector('[data-prop="firstLineIndent"]');
  firstLineIndent.value = '14'; firstLineIndent.dispatchEvent(new app.defaultView.Event('input', { bubbles: true })); firstLineIndent.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
  await waitFor(async () => {
    saved = await documentById(app, smokeDocumentId);
    const persisted = textNode(saved, paragraphText);
    return persisted?.paragraphSpacing === 11 && persisted?.firstLineIndent === 14;
  }, 'paragraph metrics autosave');
  tap(app, app.querySelector('[data-action="edit-text"]'));
  await waitFor(() => !app.querySelector('#text-editor-overlay').hidden, 'paragraph editor reopen');
  editor = app.querySelector('#text-editor-overlay'); toolbar = app.querySelector('#text-format-toolbar');
  const paragraphs = [...editor.querySelectorAll(':scope > .text-editor-paragraph')];
  assert(paragraphs.length === 4 && paragraphs.map(paragraph => paragraph.textContent).join('\n') === paragraphText, 'reopening should keep all text paragraphs, including a blank paragraph.');
  assert(paragraphs.every(paragraph => getComputedStyle(paragraph).textIndent === '14px'), 'the editor paragraphs should use the saved first-line indent.');
  assert(paragraphs.slice(1).every(paragraph => getComputedStyle(paragraph).marginBlockStart === '11px'), 'later editor paragraphs should use the saved paragraph spacing.');
  assert(editor.querySelector('[data-run-font-style="italic"]')?.textContent === 'Beta', 'reopening should keep rich formatting inside the paragraph wrappers.');

  const blankParagraph = paragraphs[2];
  const gammaText = paragraphs[3].querySelector('span')?.firstChild;
  assert(blankParagraph && !blankParagraph.textContent && gammaText?.nodeType === app.TEXT_NODE, 'the middle blank paragraph should remain an editable block.');
  const acrossBlank = app.createRange(); acrossBlank.setStart(blankParagraph, 0); acrossBlank.setEnd(gammaText, gammaText.length);
  const selection = app.getSelection(); selection.removeAllRanges(); selection.addRange(acrossBlank);
  editor.dispatchEvent(new app.defaultView.MouseEvent('mouseup', { bubbles: true }));
  tap(app, toolbar.querySelector('[data-text-format="bold"]'));
  const restoredRange = app.getSelection().getRangeAt(0);
  const restoredBlankParagraph = [...editor.querySelectorAll(':scope > .text-editor-paragraph')][2];
  assert(restoredRange.startContainer === restoredBlankParagraph && restoredRange.startOffset === 0,
    'formatting a range that starts in a blank paragraph should restore the selection to that paragraph.');
  assert(editor.querySelector('[data-run-font-weight="700"]')?.textContent === 'Gamma line',
    'formatting across a blank paragraph should apply to the following text.');

  // Insert a paragraph while the overlay is live. The browser may create its
  // own block node, so the live CSS also covers native contenteditable blocks.
  const insertionPoint = paragraphText.length;
  selectRange(app, editor, insertionPoint, insertionPoint);
  assert(app.execCommand('insertParagraph'), 'the browser should insert a paragraph at the caret.');
  assert(app.execCommand('insertText', false, 'Delta'), 'the browser should type into the newly inserted paragraph.');
  editor.dispatchEvent(new app.defaultView.InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Delta' }));
  const insertedBlock = [...editor.querySelectorAll(':scope > .text-editor-paragraph, :scope > div:not(.text-editor-paragraph), .text-editor-paragraph > div')]
    .find(block => block.textContent === 'Delta');
  assert(insertedBlock && getComputedStyle(insertedBlock).textIndent === '14px', 'a newly entered paragraph should inherit the active first-line indent.');
  assert(getComputedStyle(insertedBlock).marginBlockStart === '11px', 'a newly entered paragraph should inherit the active paragraph spacing.');
  const editedParagraphText = `${paragraphText}\nDelta`;
  tap(app, toolbar.querySelector('[data-text-format-done]'));
  await waitFor(() => editor.hidden, 'paragraph editor close');
  await waitFor(async () => {
    saved = await documentById(app, smokeDocumentId);
    const persisted = textNode(saved, editedParagraphText);
    return persisted?.paragraphSpacing === 11 && persisted?.firstLineIndent === 14
      && persisted.textRuns?.some(run => run.text === 'Beta' && run.fontStyle === 'italic');
  }, 'entered paragraph autosave');
  const beforeParagraphReload = app;
  frame.contentWindow.location.reload();
  await waitFor(() => frame.contentDocument !== beforeParagraphReload
    && frame.contentDocument?.documentElement.dataset.appReady === 'true', 'paragraph text after reload');
  app = frame.contentDocument;
  const reloadedParagraph = textNode(await documentById(app, smokeDocumentId), editedParagraphText);
  assert(reloadedParagraph?.paragraphSpacing === 11 && reloadedParagraph?.firstLineIndent === 14
    && reloadedParagraph.textRuns?.some(run => run.text === 'Beta' && run.fontStyle === 'italic'),
  'reload should preserve paragraph metrics and formatted runs together after an in-session Enter.');

  tap(app, app.querySelector('#sidebar-toggle'));
  await waitFor(() => app.querySelector('#left-panel').classList.contains('is-open'), 'list editor Layers panel');
  tap(app, app.querySelector(`[data-layer-id="${reloadedParagraph.id}"]`));
  tap(app, app.querySelector('#inspector-toggle'));
  await waitFor(() => app.querySelector('#right-panel').classList.contains('is-open'), 'list editor Inspector panel');
  tap(app, app.querySelector('[data-action="edit-text"]'));
  await waitFor(() => !app.querySelector('#text-editor-overlay').hidden, 'list formatting editor');
  editor = app.querySelector('#text-editor-overlay'); toolbar = app.querySelector('#text-format-toolbar');
  const listButtons = [...toolbar.querySelectorAll('[data-paragraph-format]')];
  assert(listButtons.length === 4, 'the mobile text toolbar must expose list, numbering, indent and outdent controls.');
  for (const control of listButtons) assertTouchReachable(app, control, control.getAttribute('aria-label'));
  selectRange(app, editor, 0, editedParagraphText.indexOf('\n\n'));
  tap(app, toolbar.querySelector('[data-paragraph-format="bulleted"]'));
  let editorParagraphs = [...editor.querySelectorAll(':scope > .text-editor-paragraph')];
  assert(editorParagraphs[0].dataset.editorListStyle === 'bulleted' && editorParagraphs[1].dataset.editorListStyle === 'bulleted',
    'selecting two paragraphs and applying bullets did not mark both list items.');
  selectRange(app, editor, 0, 'Alpha line'.length);
  tap(app, toolbar.querySelector('[data-text-format="bold"]'));
  editorParagraphs = [...editor.querySelectorAll(':scope > .text-editor-paragraph')];
  assert(editorParagraphs[0].dataset.editorListStyle === 'bulleted' && editorParagraphs[1].dataset.editorListStyle === 'bulleted'
    && editorParagraphs[0].dataset.editorListMarker === '•' && editorParagraphs[0].querySelector('[data-run-font-weight="700"]')?.textContent === 'Alpha line',
  'applying character formatting to a list item must preserve list metadata and markers.');
  const betaStart = editedParagraphText.indexOf('Beta');
  selectRange(app, editor, betaStart, betaStart + 'Beta line'.length);
  tap(app, toolbar.querySelector('[data-paragraph-format="numbered"]'));
  tap(app, toolbar.querySelector('[data-paragraph-format="indent"]'));
  editorParagraphs = [...editor.querySelectorAll(':scope > .text-editor-paragraph')];
  assert(editorParagraphs[1].dataset.editorListStyle === 'numbered' && editorParagraphs[1].dataset.editorListLevel === '1'
    && editorParagraphs[1].dataset.editorListMarker === 'a.', 'numbered list formatting and nested list level did not update the selected paragraph.');
  tap(app, toolbar.querySelector('[data-paragraph-format="outdent"]'));
  editorParagraphs = [...editor.querySelectorAll(':scope > .text-editor-paragraph')];
  assert(editorParagraphs[1].dataset.editorListLevel === '0', 'outdent did not return the list item to the top level.');
  tap(app, toolbar.querySelector('[data-text-format-done]'));
  await waitFor(() => editor.hidden, 'list format commit');
  assert(app.activeElement?.matches('[data-action="edit-text"]'), 'Done should restore keyboard focus to the text edit action.');
  const listGap = app.querySelector('[data-prop="listSpacing"]');
  listGap.value = '9'; listGap.dispatchEvent(new app.defaultView.Event('input', { bubbles: true })); listGap.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
  await waitFor(async () => {
    saved = await documentById(app, smokeDocumentId);
    const persisted = textNode(saved, editedParagraphText);
    return persisted?.listSpacing === 9 && persisted.paragraphStyles?.[0]?.listStyle === 'bulleted'
      && persisted.paragraphStyles?.[1]?.listStyle === 'numbered' && persisted.paragraphStyles?.[1]?.listLevel === 0;
  }, 'paragraph list and spacing autosave');
  const savedLists = textNode(saved, editedParagraphText);
  assert(savedLists.textRuns?.some(run => run.text === 'Beta' && run.fontStyle === 'italic'), 'applying list formatting removed existing rich text runs.');
  tap(app, app.querySelector('[data-action="edit-text"]'));
  await waitFor(() => !app.querySelector('#text-editor-overlay').hidden, 'saved list editor reopen');
  editor = app.querySelector('#text-editor-overlay'); toolbar = app.querySelector('#text-format-toolbar');
  editorParagraphs = [...editor.querySelectorAll(':scope > .text-editor-paragraph')];
  assert(editorParagraphs[0].dataset.editorListMarker === '•' && editorParagraphs[1].dataset.editorListMarker === '1.'
    && getComputedStyle(editor).getPropertyValue('--text-list-spacing') === '9px'
    && getComputedStyle(editorParagraphs[0]).textIndent === '14px',
  'reopening did not restore list markers, item spacing, and first-line indent.');
  const alignmentButtons = [...toolbar.querySelectorAll('[data-paragraph-align]')];
  assert(alignmentButtons.length === 4, 'the text toolbar must expose left, center, right, and justified paragraph alignment.');
  for (const control of alignmentButtons) assertTouchReachable(app, control, control.getAttribute('aria-label'));
  selectRange(app, editor, betaStart, betaStart + 'Beta line'.length);
  tap(app, toolbar.querySelector('[data-paragraph-align="center"]'));
  editorParagraphs = [...editor.querySelectorAll(':scope > .text-editor-paragraph')];
  assert(editorParagraphs[1].dataset.editorParagraphAlign === 'center'
    && getComputedStyle(editorParagraphs[1]).textAlign === 'center',
  'centering the selected paragraph should update its live editor alignment.');
  tap(app, toolbar.querySelector('[data-text-format-done]'));
  await waitFor(() => editor.hidden, 'saved list editor close');
  await waitFor(async () => {
    saved = await documentById(app, smokeDocumentId);
    return textNode(saved, editedParagraphText)?.paragraphStyles?.[1]?.align === 'center';
  }, 'paragraph alignment autosave');
  const beforeAlignmentReload = app;
  frame.contentWindow.location.reload();
  await waitFor(() => frame.contentDocument !== beforeAlignmentReload
    && frame.contentDocument?.documentElement.dataset.appReady === 'true', 'paragraph alignment after reload');
  app = frame.contentDocument;
  const alignedNode = textNode(await documentById(app, smokeDocumentId), editedParagraphText);
  assert(alignedNode?.paragraphStyles?.[1]?.align === 'center', 'local reload should preserve paragraph-level alignment.');

result.textContent = `PASS\n${JSON.stringify({ mobileViewport: '390x844', boldRange: true, italicRange: true, selectedFontSize: 36, selectedWeight: 800, selectedDecoration: 'underline', selectedFamily: 'Georgia, serif', selectedLetterSpacing: 1.2,
    selectedLineHeight: 1.6, selectedColor: '#f0123c', savedRuns: true, reloadPreservesRuns: true, reopenedRunRendering: true,
    editAfterReloadPreservesRuns: true, appendedTextSurvivesReload: true, touchSizedControls: true, plainTextUnchanged: true,
    paragraphs: 4, blankParagraphSelectionRestored: true, savedParagraphSpacing: 11, savedFirstLineIndent: 14, paragraphRunsSurviveReload: true,
    liveEnterUsesParagraphMetrics: true, enteredParagraphSaves: true, mobileParagraphLists: true, listIndenting: true, listStylesSurviveReload: true,
    paragraphAlignment: 'center', alignmentControlsTouchSized: true, paragraphAlignmentSurvivesReload: true })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
}
