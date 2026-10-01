import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { installHorizontalTabListKeyboard } from '../src/tab-list-keyboard.js';

const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

class FakeTab {
  constructor(name, { disabled = false, ariaDisabled = false, role = 'tab' } = {}) {
    this.name = name;
    this.disabled = disabled;
    this.role = role;
    this.ariaDisabled = ariaDisabled;
    this.focusCount = 0;
    this.clickCount = 0;
    this.focusOptions = null;
  }

  closest(selector) {
    return selector === '[role="tab"]' && this.role === 'tab' ? this : null;
  }

  getAttribute(name) {
    if (name === 'aria-disabled') return this.ariaDisabled ? 'true' : null;
    return null;
  }

  focus(options) {
    this.focusCount += 1;
    this.focusOptions = options;
  }

  click() {
    this.clickCount += 1;
  }
}

class FakeTabList {
  constructor(tabs) {
    this.tabs = tabs;
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }

  querySelectorAll(selector) {
    assert.equal(selector, '[role="tab"]');
    return this.tabs.filter(tab => tab.role === 'tab');
  }

  contains(target) {
    return this.tabs.includes(target);
  }

  dispatch(target, key) {
    let prevented = false;
    this.listeners.get('keydown')?.({
      target,
      key,
      preventDefault() { prevented = true; }
    });
    return prevented;
  }
}

test('horizontal arrows wrap, skip disabled tabs, and auto-activate the focused tab', () => {
  const first = new FakeTab('first');
  const disabled = new FakeTab('disabled', { disabled: true });
  const ariaDisabled = new FakeTab('aria-disabled', { ariaDisabled: true });
  const last = new FakeTab('last');
  const list = new FakeTabList([first, disabled, ariaDisabled, last]);
  installHorizontalTabListKeyboard(list);

  assert.equal(list.dispatch(first, 'ArrowLeft'), true);
  assert.equal(last.focusCount, 1);
  assert.deepEqual(last.focusOptions, { preventScroll: true });
  assert.equal(last.clickCount, 1);

  assert.equal(list.dispatch(last, 'ArrowRight'), true);
  assert.equal(first.focusCount, 1);
  assert.equal(first.clickCount, 1);
  assert.equal(disabled.focusCount + ariaDisabled.focusCount, 0);
  assert.equal(list.dispatch(disabled, 'ArrowRight'), false);
  assert.equal(list.dispatch(ariaDisabled, 'ArrowLeft'), false);
});

test('Home and End select the first and last enabled tabs', () => {
  const disabledFirst = new FakeTab('disabled first', { disabled: true });
  const first = new FakeTab('first');
  const middle = new FakeTab('middle');
  const disabledLast = new FakeTab('disabled last', { ariaDisabled: true });
  const list = new FakeTabList([disabledFirst, first, middle, disabledLast]);
  installHorizontalTabListKeyboard(list);

  assert.equal(list.dispatch(middle, 'Home'), true);
  assert.equal(first.focusCount, 1);
  assert.equal(first.clickCount, 1);

  assert.equal(list.dispatch(first, 'End'), true);
  assert.equal(middle.focusCount, 1);
  assert.equal(middle.clickCount, 1);
  assert.equal(disabledFirst.focusCount + disabledLast.focusCount, 0);
});

test('non-tab targets and unsupported keys are left untouched', () => {
  const tab = new FakeTab('tab');
  const nonTab = new FakeTab('separator', { role: 'separator' });
  const list = new FakeTabList([tab, nonTab]);
  installHorizontalTabListKeyboard(list);

  assert.equal(list.dispatch(nonTab, 'ArrowRight'), false);
  assert.equal(list.dispatch(tab, 'ArrowUp'), false);
  assert.equal(tab.focusCount + tab.clickCount, 0);
});

test('the returned cleanup function removes the key handler', () => {
  const first = new FakeTab('first');
  const second = new FakeTab('second');
  const list = new FakeTabList([first, second]);
  const dispose = installHorizontalTabListKeyboard(list);
  dispose();

  assert.equal(list.dispatch(first, 'ArrowRight'), false);
  assert.equal(second.focusCount + second.clickCount, 0);
});

test('both editor tab lists declare their panels and install keyboard navigation', () => {
  assert.match(indexHtml, /id="sidebar-tab-layers"[^>]*aria-controls="layers-section"[^>]*aria-selected="true"[^>]*tabindex="0"/);
  assert.match(indexHtml, /id="sidebar-tab-assets"[^>]*aria-controls="assets-section"[^>]*aria-selected="false"[^>]*tabindex="-1"/);
  assert.match(indexHtml, /id="layers-section"[^>]*role="tabpanel"[^>]*aria-labelledby="sidebar-tab-layers"/);
  assert.match(indexHtml, /id="assets-section"[^>]*role="tabpanel"[^>]*aria-labelledby="sidebar-tab-assets"/);
  for (const tab of ['design', 'prototype', 'inspect', 'comments', 'motion']) {
    assert.match(indexHtml, new RegExp(`id="inspector-tab-${tab}"[^>]*aria-controls="inspector-content"`));
  }
  assert.match(indexHtml, /id="inspector-content"[^>]*role="tabpanel"[^>]*aria-labelledby="inspector-tab-design"/);
  assert.match(mainSource, /\$\$\('\.sidebar-tabs, \.inspector-tabs'\)\.forEach\(installHorizontalTabListKeyboard\)/);
  assert.match(mainSource, /item\.tabIndex = active \? 0 : -1/);
  assert.match(mainSource, /setAttribute\('aria-labelledby', selected\.id\)/);
});
