import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, createDocument, createNode, findNode } from '../src/model.js';
import {
  installLayerReorder,
  layerDropPositionAt,
  LAYER_ROW_POINTER_DRAG_THRESHOLD,
  pointerDragThresholdExceeded
} from '../src/layer-order.js';

class FakeClassList {
  #values = new Set();
  add(...values) { for (const value of values) this.#values.add(value); }
  remove(...values) { for (const value of values) this.#values.delete(value); }
  contains(value) { return this.#values.has(value); }
  toggle(value, force = !this.contains(value)) { if (force) this.add(value); else this.remove(value); return force; }
}

class FakeElement {
  constructor(tagName = 'div', dataset = {}) {
    this.tagName = tagName.toUpperCase();
    this.dataset = dataset;
    this.parentElement = null;
    this.children = [];
    this.listeners = new Map();
    this.classList = new FakeClassList();
    this.attributes = {};
    this.scrollTop = 0;
    this.scrollHeight = 600;
    this.clientHeight = 300;
    this.rect = { top: 0, height: 40 };
  }
  addEventListener(type, listener, options = {}) {
    const listeners = this.listeners.get(type) || [];
    listeners.push({ listener, capture: options === true || Boolean(options?.capture) });
    this.listeners.set(type, listeners);
  }
  append(child) { child.parentElement = this; this.children.push(child); return child; }
  contains(element) {
    for (let current = element; current; current = current.parentElement) if (current === this) return true;
    return false;
  }
  matches(selector) {
    return selector.split(',').some(part => {
      const value = part.trim();
      if (value === '[data-layer-id]') return Boolean(this.dataset.layerId);
      if (value === 'button') return this.tagName === 'BUTTON';
      if (value === 'a') return this.tagName === 'A';
      if (value === 'input') return this.tagName === 'INPUT';
      if (value === 'select') return this.tagName === 'SELECT';
      if (value === 'textarea') return this.tagName === 'TEXTAREA';
      if (value === 'summary') return this.tagName === 'SUMMARY';
      if (value === '[role="button"]') return this.attributes.role === 'button';
      if (value === '[data-layer-drag-handle]') return Object.hasOwn(this.attributes, 'data-layer-drag-handle');
      if (value === '[data-layer-drag-ignore]') return Object.hasOwn(this.attributes, 'data-layer-drag-ignore');
      if (value.startsWith('[contenteditable]')) return this.attributes.contenteditable != null
        && this.attributes.contenteditable !== 'false';
      return false;
    });
  }
  closest(selector) {
    for (let current = this; current; current = current.parentElement) if (current.matches(selector)) return current;
    return null;
  }
  getBoundingClientRect() { return { ...this.rect, bottom: this.rect.top + this.rect.height }; }
  setPointerCapture(pointerId) { this.capturedPointerId = pointerId; }
  hasPointerCapture(pointerId) { return this.capturedPointerId === pointerId; }
  releasePointerCapture(pointerId) { if (this.capturedPointerId === pointerId) this.capturedPointerId = null; }
}

class FakeDocument extends FakeElement {
  constructor() {
    super('#document');
    this.defaultView = {};
  }
  elementFromPoint(_x, y) {
    const rows = [];
    const visit = element => {
      if (element.dataset.layerId) rows.push(element);
      for (const child of element.children) visit(child);
    };
    for (const child of this.children) visit(child);
    return rows.find(row => {
      const rect = row.getBoundingClientRect();
      return y >= rect.top && y <= rect.bottom;
    }) || null;
  }
}

function dispatch(target, type, properties = {}) {
  const ancestors = [];
  for (let current = target; current; current = current.parentElement) ancestors.push(current);
  const event = {
    type,
    target,
    pointerId: 1,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    clientX: 8,
    clientY: 8,
    cancelable: true,
    defaultPrevented: false,
    stopped: false,
    composedPath: () => ancestors,
    preventDefault() { if (this.cancelable) this.defaultPrevented = true; },
    stopImmediatePropagation() { this.stopped = true; },
    ...properties
  };
  for (const current of [...ancestors].reverse()) {
    for (const item of current.listeners.get(type) || []) {
      if (!item.capture || event.stopped) continue;
      event.currentTarget = current;
      item.listener(event);
    }
  }
  for (const current of ancestors) {
    for (const item of current.listeners.get(type) || []) {
      if (item.capture || event.stopped) continue;
      event.currentTarget = current;
      item.listener(event);
    }
  }
  return event;
}

function fixture({ lockedMiddle = false } = {}) {
  const document = createDocument();
  const container = createNode('frame', { name: 'Container' });
  const bottom = createNode('rectangle', { name: 'Bottom' });
  const middle = createNode('ellipse', { name: 'Middle', locked: lockedMiddle });
  const top = createNode('rectangle', { name: 'Top' });
  addNode(document, container);
  addNode(document, bottom, { parentId: container.id });
  addNode(document, middle, { parentId: container.id });
  addNode(document, top, { parentId: container.id });

  const ownerDocument = new FakeDocument();
  const list = new FakeElement();
  list.ownerDocument = ownerDocument;
  ownerDocument.append(list);
  list.rect = { top: 0, height: 300 };
  const rows = new Map();
  const handles = new Map();
  for (const [index, node] of [top, middle, bottom].entries()) {
    const row = new FakeElement('div', { layerId: node.id });
    row.rect = { top: index * 40, height: 40 };
    const handle = row.append(new FakeElement('button'));
    handle.attributes['data-layer-drag-handle'] = '';
    handles.set(node.name, handle);
    rows.set(node.name, list.append(row));
  }

  const callbacks = { before: 0, changed: 0, selected: 0 };
  list.addEventListener('click', () => { callbacks.selected += 1; });
  installLayerReorder(list, {
    getDocument: () => document,
    getPageId: () => document.activePageId,
    beforeChange: () => { callbacks.before += 1; },
    onChange: () => { callbacks.changed += 1; }
  });
  return { document, container, bottom, middle, top, ownerDocument, list, rows, handles, callbacks };
}

test('ordinary row taps and vertical swipes remain clicks or scroll gestures', () => {
  const { rows, callbacks } = fixture();
  const row = rows.get('Bottom');
  const down = dispatch(row, 'pointerdown', { clientX: 8, clientY: 100, pointerId: 7 });
  const move = dispatch(row, 'pointermove', { clientX: 8, clientY: 20, pointerId: 7 });
  assert.equal(move.defaultPrevented, false, 'row gestures outside the handle stay available for vertical scrolling');
  assert.equal(row.classList.contains('is-dragging'), false);
  dispatch(row, 'pointerup', { clientX: 8, clientY: 20, pointerId: 7 });
  dispatch(row, 'click', { pointerId: 7 });
  assert.equal(callbacks.selected, 1, 'a tap still reaches the layer selection handler');
  assert.equal(callbacks.before, 0);
  assert.equal(callbacks.changed, 0);
  assert.equal(down.defaultPrevented, false);
});

test('handle taps and sub-threshold movement remain ordinary clicks', () => {
  const { handles, rows, callbacks } = fixture();
  const handle = handles.get('Bottom');
  const row = rows.get('Bottom');
  const down = dispatch(handle, 'pointerdown', { clientX: 8, clientY: 100, pointerId: 8 });
  const move = dispatch(handle, 'pointermove', { clientX: 8 + LAYER_ROW_POINTER_DRAG_THRESHOLD, clientY: 100, pointerId: 8 });
  assert.equal(move.defaultPrevented, false, 'exactly reaching the threshold does not claim the gesture');
  assert.equal(row.classList.contains('is-dragging'), false);
  dispatch(handle, 'pointerup', { clientX: 14, clientY: 100, pointerId: 8 });
  dispatch(handle, 'click', { pointerId: 8 });
  assert.equal(callbacks.selected, 1);
  assert.equal(callbacks.before, 0);
  assert.equal(callbacks.changed, 0);
  assert.equal(down.defaultPrevented, false);
});

test('touch drag activates past threshold, previews the correct row half, and commits through callbacks', () => {
  const { document, container, list, rows, handles, callbacks } = fixture();
  const source = rows.get('Bottom');
  const handle = handles.get('Bottom');
  const target = rows.get('Top');
  dispatch(handle, 'pointerdown', { clientX: 8, clientY: 100, pointerId: 9 });
  const move = dispatch(handle, 'pointermove', { clientX: 8, clientY: 10, pointerId: 9 });
  assert.equal(move.defaultPrevented, true);
  assert.equal(source.classList.contains('is-dragging'), true);
  assert.equal(target.classList.contains('is-drop-before'), true, 'the upper half marks an insert-before drop');
  dispatch(handle, 'pointerup', { clientX: 8, clientY: 10, pointerId: 9 });
  assert.deepEqual(container.children.map(node => node.name), ['Middle', 'Top', 'Bottom']);
  assert.equal(callbacks.before, 1);
  assert.equal(callbacks.changed, 1);
  const click = dispatch(list, 'click', { pointerId: 9 });
  assert.equal(click.defaultPrevented, true, 'the post-drag synthetic click must not select a row');
  assert.equal(callbacks.selected, 0);
  assert.equal(source.classList.contains('is-dragging'), false);
  assert.equal(target.classList.contains('is-drop-before'), false);
  assert.ok(document, 'the pointer target lookup is scoped to this layer list document');
});

test('pen reordering also starts from the dedicated handle', () => {
  const { container, handles, rows, callbacks } = fixture();
  const source = rows.get('Bottom');
  const handle = handles.get('Bottom');
  dispatch(handle, 'pointerdown', { pointerType: 'pen', clientX: 8, clientY: 100, pointerId: 10 });
  dispatch(handle, 'pointermove', { pointerType: 'pen', clientX: 8, clientY: 10, pointerId: 10 });
  dispatch(handle, 'pointerup', { pointerType: 'pen', clientX: 8, clientY: 10, pointerId: 10 });
  assert.deepEqual(container.children.map(node => node.name), ['Middle', 'Top', 'Bottom']);
  assert.equal(callbacks.before, 1);
  assert.equal(callbacks.changed, 1);
  assert.equal(source.classList.contains('is-dragging'), false);
});

test('drop positioning uses the row midpoint and rejects malformed bounds', () => {
  const rect = { top: 20, height: 40 };
  assert.equal(layerDropPositionAt(39, rect), 'before');
  assert.equal(layerDropPositionAt(40, rect), 'after');
  assert.equal(layerDropPositionAt(29, rect, true), 'before');
  assert.equal(layerDropPositionAt(40, rect, true), 'inside');
  assert.equal(layerDropPositionAt(51, rect, true), 'after');
  assert.equal(layerDropPositionAt(10, rect), 'before');
  assert.equal(layerDropPositionAt(40, { top: 0, height: 0 }), null);
  assert.equal(layerDropPositionAt(Number.NaN, rect), null);
  assert.equal(pointerDragThresholdExceeded(0, 0, 6, 0), false);
  assert.equal(pointerDragThresholdExceeded(0, 0, 6.01, 0), true);
  assert.equal(pointerDragThresholdExceeded(0, 0, 0, 6.01), true);
});

test('dropping in a container row center nests the layer or moves it to the end of its stack', () => {
  const { document, container, bottom, list, ownerDocument, handles, callbacks } = fixture();
  const containerRow = list.append(new FakeElement('div', { layerId: container.id }));
  containerRow.rect = { top: 120, height: 40 };
  ownerDocument.elementFromPoint = (_x, y) => y >= 120 ? containerRow : null;
  const handle = handles.get('Bottom');

  dispatch(handle, 'pointerdown', { clientX: 8, clientY: 100, pointerId: 30 });
  dispatch(handle, 'pointermove', { clientX: 8, clientY: 140, pointerId: 30 });
  assert.equal(containerRow.classList.contains('is-drop-inside'), true);
  dispatch(handle, 'pointerup', { clientX: 8, clientY: 140, pointerId: 30 });

  assert.deepEqual(container.children.map(node => node.name), ['Middle', 'Top', 'Bottom']);
  assert.equal(findNode(document, bottom.id)?.parent, container);
  assert.equal(callbacks.before, 1);
  assert.equal(callbacks.changed, 1);
});

test('pointer reorder ignores controls and leaves their tap/click behavior intact', () => {
  const { rows, callbacks } = fixture();
  const row = rows.get('Bottom');
  const button = row.append(new FakeElement('button'));
  dispatch(button, 'pointerdown', { clientX: 8, clientY: 100, pointerId: 12 });
  const move = dispatch(button, 'pointermove', { clientX: 30, clientY: 20, pointerId: 12 });
  dispatch(button, 'pointerup', { clientX: 30, clientY: 20, pointerId: 12 });
  dispatch(button, 'click', { pointerId: 12 });
  assert.equal(move.defaultPrevented, false);
  assert.equal(row.classList.contains('is-dragging'), false);
  assert.equal(callbacks.selected, 1);
  assert.equal(callbacks.before, 0);
  assert.equal(callbacks.changed, 0);
});

test('a canceled pointer gesture clears drag state without suppressing the next selection', () => {
  const { rows, handles, callbacks } = fixture();
  const row = rows.get('Bottom');
  const handle = handles.get('Bottom');
  dispatch(handle, 'pointerdown', { clientX: 8, clientY: 100, pointerId: 18 });
  dispatch(handle, 'pointermove', { clientX: 8, clientY: 20, pointerId: 18 });
  dispatch(handle, 'pointercancel', { pointerId: 18 });
  dispatch(row, 'click', { pointerId: 18 });
  assert.equal(row.classList.contains('is-dragging'), false);
  assert.equal(callbacks.selected, 1);
  assert.equal(callbacks.before, 0);
  assert.equal(callbacks.changed, 0);
});

test('locked sibling drops are cleared while a valid cross-parent drop reparents the layer', () => {
  const { document, container, bottom, top, list, ownerDocument, rows, handles, callbacks } = fixture({ lockedMiddle: true });
  const source = rows.get('Bottom');
  const handle = handles.get('Bottom');
  const target = rows.get('Top');
  dispatch(handle, 'pointerdown', { clientX: 8, clientY: 100, pointerId: 15 });
  dispatch(handle, 'pointermove', { clientX: 8, clientY: 20, pointerId: 15 });
  assert.equal(target.classList.contains('is-drop-before'), false, 'the locked middle sibling blocks crossing to Top');
  dispatch(handle, 'pointerup', { clientX: 8, clientY: 20, pointerId: 15 });
  assert.deepEqual(container.children.map(node => node.name), ['Bottom', 'Middle', 'Top']);
  assert.equal(callbacks.before, 0);
  assert.equal(callbacks.changed, 0);
  assert.equal(source.classList.contains('is-dragging'), false);

  const otherContainer = createNode('frame', { name: 'Other container' });
  const nested = createNode('rectangle', { name: 'Nested target' });
  addNode(document, otherContainer);
  addNode(document, nested, { parentId: otherContainer.id });
  const nestedRow = new FakeElement('div', { layerId: nested.id });
  nestedRow.rect = { top: 120, height: 40 };
  list.append(nestedRow);
  ownerDocument.elementFromPoint = (_x, y) => y >= 120 ? nestedRow : rows.get('Bottom');
  dispatch(handle, 'pointerdown', { clientX: 8, clientY: 100, pointerId: 16 });
  dispatch(handle, 'pointermove', { clientX: 8, clientY: 150, pointerId: 16 });
  assert.equal(nestedRow.classList.contains('is-drop-after'), true, 'a row edge can target another container’s sibling stack');
  dispatch(handle, 'pointerup', { clientX: 8, clientY: 150, pointerId: 16 });
  assert.equal(callbacks.before, 1);
  assert.equal(callbacks.changed, 1);
  assert.equal(findNode(document, bottom.id)?.parent, otherContainer);
  assert.deepEqual(container.children.map(node => node.name), ['Middle', 'Top']);
  assert.equal(top.name, 'Top');
});
