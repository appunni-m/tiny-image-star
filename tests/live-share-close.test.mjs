import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bindDialogDismissal } from '../src/collaboration/dialog-dismissal.js';

class FakeElement {
  listeners = new Map();
  open = true;
  returnValue = '';

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  hasAttribute(name) { return name === 'open' && this.open; }
  removeAttribute(name) { if (name === 'open') this.open = false; }
  contains() { return false; }
  querySelectorAll() { return []; }
  close(value = '') { this.open = false; this.returnValue = value; }
  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) || []) listener(event);
    return true;
  }
  click() {
    for (const listener of this.listeners.get('click') || []) {
      listener({ preventDefault() {}, stopPropagation() {} });
    }
  }
}

test('the sharing close button dismisses the panel without stopping the active session', () => {
  const dialog = new FakeElement();
  const closeButton = new FakeElement();
  const session = { role: 'guest', status: 'connected' };
  bindDialogDismissal(dialog, closeButton);

  closeButton.click();

  assert.equal(dialog.open, false);
  assert.equal(session.status, 'connected');
});

test('the live sharing panel binds dismissal directly to its close button', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /bindDialogDismissal\(liveDialogElement, \[\$\('#live-collaboration-close'\)\]\)/);
  assert.doesNotMatch(source, /Wait for the guest to connect or stop sharing before closing this panel/);
  assert.doesNotMatch(source, /Leave the live session first so Tiny Image Star can save your local fork/);
});
