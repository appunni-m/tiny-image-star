import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bindDialogDismissal, closeDialog, openDialog } from '../src/collaboration/dialog-dismissal.js';

class FakeElement {
  listeners = new Map();
  descendants = [];
  dataAttributes = new Set();
  open = true;
  closeCount = 0;
  returnValue = '';
  removed = false;

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener({ ...event, type });
  }

  dispatchEvent(event) {
    this.dispatch(event.type);
    return true;
  }

  matches(selector) {
    return selector === '[data-dialog-dismiss]' && this.isDismissButton === true;
  }

  querySelectorAll(selector) {
    return selector === '[data-dialog-dismiss]'
      ? this.descendants
      : [];
  }

  contains(element) { return this.descendants.includes(element); }

  setAttribute(name) {
    if (name === 'open') this.open = true;
    else this.dataAttributes.add(name);
  }

  removeAttribute(name) {
    if (name === 'open') this.open = false;
    else this.dataAttributes.delete(name);
  }

  remove() { this.removed = true; }

  close(returnValue = '') {
    this.open = false;
    this.returnValue = returnValue;
    this.closeCount += 1;
  }
}

class AttributeOnlyDialog extends FakeElement {
  attributes = new Set();

  constructor() {
    super();
    delete this.open;
    this.close = undefined;
  }

  setAttribute(name) { this.attributes.add(name); }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
}

class StaleOpenPropertyDialog extends AttributeOnlyDialog {
  constructor() {
    super();
    this.attributes.add('open');
    this.close = undefined;
    Object.defineProperty(this, 'open', { configurable: true, get: () => true });
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    // Model embedded WebViews whose dialog.open property fails to reflect the
    // removal even though the actual open attribute has been removed.
  }
}

test('sharing dialog close button dismisses the panel while preserving a live session', () => {
  const dialog = new FakeElement();
  const closeButton = new FakeElement();
  const liveSession = { status: 'waiting-answer' };
  bindDialogDismissal(dialog, closeButton);

  closeButton.dispatch('click');

  assert.equal(dialog.open, false);
  assert.equal(dialog.closeCount, 1);
  assert.equal(dialog.returnValue, 'dismiss');
  assert.equal(liveSession.status, 'waiting-answer');
});

test('every sharing dialog close control dismisses the same panel', () => {
  const dialog = new FakeElement();
  const headerClose = new FakeElement();
  const footerClose = new FakeElement();
  bindDialogDismissal(dialog, [headerClose, footerClose]);

  footerClose.dispatch('click');

  assert.equal(dialog.open, false);
  assert.equal(dialog.closeCount, 1);
});

test('closing the QR sharing panel also closes its parent sharing window without ending the session', () => {
  const qrDialog = new FakeElement();
  const sharingDialog = new FakeElement();
  const closeButton = new FakeElement();
  const session = { status: 'waiting-answer' };
  bindDialogDismissal(qrDialog, closeButton, {
    onDismiss: () => closeDialog(sharingDialog, 'close')
  });

  closeButton.dispatch('click');

  assert.equal(qrDialog.open, false);
  assert.equal(sharingDialog.open, false);
  assert.equal(sharingDialog.returnValue, 'close');
  assert.equal(session.status, 'waiting-answer');
});

test('Escape and backdrop dismissal close the complete QR sharing flow', () => {
  for (const dismiss of [
    dialog => dialog.dispatch('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} }),
    dialog => dialog.dispatch('click', { target: dialog })
  ]) {
    const qrDialog = new FakeElement();
    const sharingDialog = new FakeElement();
    bindDialogDismissal(qrDialog, [], { onDismiss: () => closeDialog(sharingDialog, 'close') });

    dismiss(qrDialog);

    assert.equal(qrDialog.open, false);
    assert.equal(sharingDialog.open, false);
  }
});

test('sharing dialog close controls remove the open state when native close is unavailable', () => {
  const dialog = new FakeElement();
  dialog.close = undefined;
  const closeButton = new FakeElement();
  bindDialogDismissal(dialog, closeButton);

  closeButton.dispatch('click');

  assert.equal(dialog.open, false);
});

test('sharing dialogs open in webviews without native showModal support', () => {
  const dialog = new FakeElement();
  dialog.open = false;

  assert.equal(openDialog(dialog), true);
  assert.equal(dialog.open, true);
  assert.equal(dialog.dataAttributes.has('data-dialog-modeless-fallback'), true);
});

test('modeless sharing fallback places a backdrop above editor controls that closes the panel', () => {
  const parent = {
    children: [],
    insertBefore(element, reference) {
      const index = this.children.indexOf(reference);
      this.children.splice(index < 0 ? this.children.length : index, 0, element);
    }
  };
  let backdrop;
  const dialog = new FakeElement();
  dialog.open = false;
  dialog.parentNode = parent;
  dialog.ownerDocument = { createElement: () => (backdrop = new FakeElement()) };
  parent.children.push(dialog);

  assert.equal(openDialog(dialog), true);
  assert.equal(backdrop.className, 'dialog-modeless-fallback-backdrop');
  assert.deepEqual(parent.children, [backdrop, dialog]);

  backdrop.dispatch('click');

  assert.equal(dialog.open, false);
  assert.equal(backdrop.removed, true);
  assert.equal(dialog.dataAttributes.has('data-dialog-modeless-fallback'), false);
});

test('sharing dialogs close in embedded views that expose only the open attribute', () => {
  const dialog = new AttributeOnlyDialog();
  let closeEvents = 0;
  dialog.addEventListener('close', () => { closeEvents += 1; });

  assert.equal(openDialog(dialog), true);
  assert.equal(dialog.hasAttribute('open'), true);
  assert.equal(dialog.hasAttribute('data-dialog-modeless-fallback'), true);
  assert.equal(closeDialog(dialog, 'close'), true);
  assert.equal(dialog.hasAttribute('open'), false);
  assert.equal(dialog.hasAttribute('data-dialog-modeless-fallback'), false);
  assert.equal(closeEvents, 1);
});

test('modeless dialog fallback stays above editor layers and presents a dismissible backdrop', async () => {
  const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(styles, /dialog\[data-dialog-modeless-fallback\]\[open\]\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*20000;[^}]*inset:\s*0;/);
  assert.match(styles, /\.dialog-modeless-fallback-backdrop\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*19999;[^}]*inset:\s*0;[^}]*background:/);
});

test('sharing dialog closure trusts the open attribute over a stale WebView property', () => {
  const dialog = new StaleOpenPropertyDialog();
  let closeEvents = 0;
  dialog.addEventListener('close', () => { closeEvents += 1; });

  assert.equal(closeDialog(dialog, 'close'), true);
  assert.equal(dialog.hasAttribute('open'), false);
  assert.equal(dialog.open, true);
  assert.equal(closeEvents, 1);
});

test('closeDialog falls back to removing the open attribute when the native method is absent', () => {
  const dialog = new FakeElement();
  dialog.close = undefined;

  assert.equal(closeDialog(dialog, 'close'), true);
  assert.equal(dialog.open, false);
});

test('closeDialog forces closure and emits cleanup when an embedded native close method fails', () => {
  const dialog = new FakeElement();
  dialog.close = () => { throw new Error('native dialog close unsupported'); };
  let closeEvents = 0;
  dialog.addEventListener('close', () => { closeEvents += 1; });

  assert.equal(closeDialog(dialog, 'close'), true);
  assert.equal(dialog.open, false);
  assert.equal(dialog.returnValue, 'close');
  assert.equal(closeEvents, 1);
});

test('explicit dismiss controls close without relying on native form submission', () => {
  const dialog = new FakeElement();
  const button = new FakeElement();
  button.isDismissButton = true;
  button.closest = selector => selector === '[data-dialog-dismiss]' ? button : null;
  dialog.descendants = [button];
  bindDialogDismissal(dialog, []);
  let prevented = false;

  dialog.dispatch('click', {
    target: button,
    preventDefault() { prevented = true; },
    stopPropagation() {}
  });

  assert.equal(prevented, true);
  assert.equal(dialog.open, false);
  assert.equal(dialog.returnValue, 'dismiss');
});

test('a dialog close form submission dismisses the sharing panel when its click handler is unavailable', () => {
  const dialog = new FakeElement();
  const form = { matches: selector => selector === 'form[method="dialog"]' };
  bindDialogDismissal(dialog, []);
  let prevented = false;

  dialog.dispatch('submit', {
    target: form,
    preventDefault() { prevented = true; },
    stopPropagation() {}
  });

  assert.equal(dialog.open, false);
  assert.equal(dialog.returnValue, 'dismiss');
  assert.equal(prevented, true);
});

test('native dialog form submission remains available if the dismissal handler cannot close', () => {
  const dialog = new FakeElement();
  dialog.close = () => { throw new Error('native close unavailable'); };
  dialog.removeAttribute = () => {};
  const button = new FakeElement();
  button.isDismissButton = true;
  button.closest = selector => selector === '[data-dialog-dismiss]' ? button : null;
  dialog.descendants = [button];
  let prevented = false;
  bindDialogDismissal(dialog, []);

  dialog.dispatch('click', {
    target: button,
    preventDefault() { prevented = true; },
    stopPropagation() {}
  });

  assert.equal(prevented, false);
  assert.equal(dialog.open, true);
});

test('sharing close buttons are handled before app click handlers can suppress their action', () => {
  const dialog = new FakeElement();
  const headerClose = new FakeElement();
  const footerClose = new FakeElement();
  dialog.descendants = [headerClose, footerClose];
  for (const button of dialog.descendants) {
    button.isDismissButton = true;
    button.closest = selector => selector === '[data-dialog-dismiss]' ? button : null;
  }
  bindDialogDismissal(dialog, []);

  let prevented = false;
  dialog.dispatch('click', {
    target: headerClose,
    preventDefault() { prevented = true; },
    stopPropagation() {}
  });

  assert.equal(prevented, true);
  assert.equal(dialog.open, false);
  assert.equal(dialog.closeCount, 1);
});

test('clicking the backdrop dismisses the dialog but clicking its contents does not', () => {
  const dialog = new FakeElement();
  bindDialogDismissal(dialog, new FakeElement());

  dialog.dispatch('click', { target: { id: 'dialog-content' } });
  assert.equal(dialog.open, true);

  dialog.dispatch('click', { target: dialog });
  assert.equal(dialog.open, false);
});

test('Escape dismissal closes the panel even when app keyboard handlers cancel the native action', () => {
  const dialog = new FakeElement();
  bindDialogDismissal(dialog, new FakeElement());
  let prevented = false;

  dialog.dispatch('cancel', { preventDefault() { prevented = true; } });

  assert.equal(prevented, true);
  assert.equal(dialog.open, false);
});

test('Escape key is handled inside the sharing dialog before app-wide keyboard shortcuts', () => {
  const dialog = new FakeElement();
  bindDialogDismissal(dialog, new FakeElement());
  let prevented = false;
  let stopped = false;

  dialog.dispatch('keydown', {
    key: 'Escape',
    preventDefault() { prevented = true; },
    stopPropagation() { stopped = true; }
  });

  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.equal(dialog.open, false);
});

test('sharing panels use the compatible open and close helpers', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const qrSource = await readFile(new URL('../src/collaboration/qr-handoff-ui.js', import.meta.url), 'utf8');
  assert.match(source, /function openLiveDialog\(role\) \{[\s\S]*?openDialog\(dialog\);/);
  assert.match(source, /closeDialog\(\$\('#live-collaboration-dialog'\), 'revoked'\)/);
  assert.match(html, /<form class="dialog-dismiss-form" method="dialog"><button class="icon-button" id="live-collaboration-close" type="submit" data-dialog-dismiss/);
  assert.match(html, /<form class="dialog-dismiss-form" method="dialog"><button class="secondary-button" id="live-collaboration-close-action" type="submit" data-dialog-dismiss/);
  assert.match(qrSource, /dismissDialog\(dialog, 'close'\)/);
  assert.match(qrSource, /<form class="dialog-dismiss-form" method="dialog"><button class="icon-button" id="live-qr-close" type="submit" value="close" data-dialog-dismiss/);
  assert.match(qrSource, /<form class="dialog-dismiss-form" method="dialog"><button class="secondary-button" id="live-qr-close-action" type="submit" value="close" data-dialog-dismiss/);
  assert.match(qrSource, /dialog\.returnValue === 'close'\) closeSharing\(\)/,
    'native fallback dismissal should close the parent sharing window too');
  assert.match(qrSource, /bindDialogDismissal\(dialog, \[\], \{ onDismiss: \(\) => \{\s*void stopActivities\(\);\s*closeSharing\(\);\s*\} \}\)/);
  assert.match(qrSource, /dialog\.addEventListener\('close', \(\) => \{\s*void stopActivities\(\);\s*if \(dialog\.returnValue === 'close'\) closeSharing\(\);\s*\}\)/,
    'only an explicit close fallback should close the sharing parent after the QR window closes');
});

test('the live collaboration panel uses normal Escape dismissal without changing session state', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /bindDialogDismissal\(liveDialogElement, \[\s*\$\('#live-collaboration-close'\),\s*\$\('#live-collaboration-close-action'\)\s*\]\)/);
  assert.match(source, /activeSession\?\.role === 'guest' && !liveTerminal\(activeSession\.status\)\) openLiveDialog\('guest'\)/,
    'the Share toolbar action should reopen an active guest session after its dialog is dismissed');
  assert.doesNotMatch(source, /Wait for the guest to connect or stop sharing before closing this panel/);
  assert.doesNotMatch(source, /Leave the live session first so Tiny Image Star can save your local fork/);
});
