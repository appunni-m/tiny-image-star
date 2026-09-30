import test from 'node:test';
import assert from 'node:assert/strict';
import { deepestContainerAtPagePoint, drawTextDecoration, drawTextRuns, drawTrackedText, hitTestPage, measureTrackedText, SceneRenderer, selectionGroupHandles, selectionOverlayGeometry, textVerticalOffset, wrapText } from '../src/renderer.js';
import { addNode, addVariableMode, bindVariable, createDocument, createNode, createVariable, createVariableCollection, setFrameVariableMode, setVariableValue } from '../src/model.js';
import { nodeLocalToPage } from '../src/transform-geometry.js';

function textContext({ nativeTracking = false } = {}) {
  const calls = [];
  const context = {
    calls,
    measureText(value) {
      const width = [...String(value)].reduce((total, character) => total + (character === ' ' ? 5 : 10), 0);
      return { width: value === 'AV' ? width - 1 : width };
    },
    fillText(...args) { calls.push(args); }
  };
  if (nativeTracking) context.letterSpacing = '';
  return context;
}

test('group transform handles follow non-zero selection bounds while keeping rotation available', () => {
  const regular = selectionGroupHandles({ x: 10, y: 20, width: 30, height: 40 });
  assert.deepEqual(Object.keys(regular.resize), ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
  assert.deepEqual(regular.rotate, { x: 25, y: -4 });

  const horizontal = selectionGroupHandles({ x: 10, y: 20, width: 30, height: 0 });
  assert.deepEqual(horizontal.resize, {
    e: { x: 40, y: 20 },
    w: { x: 10, y: 20 }
  });
  assert.deepEqual(horizontal.rotate, { x: 25, y: -4 });

  const vertical = selectionGroupHandles({ x: 10, y: 20, width: 0, height: 40 });
  assert.deepEqual(vertical.resize, {
    n: { x: 10, y: 20 },
    s: { x: 10, y: 60 }
  });
  assert.deepEqual(vertical.rotate, { x: 10, y: -4 });

  const point = selectionGroupHandles({ x: 10, y: 20, width: 0, height: 0 });
  assert.deepEqual(point.resize, {});
  assert.deepEqual(point.rotate, { x: 10, y: -4 });
});

test('inner-shadow raster composition clips a shifted blurred mask back to the source alpha', () => {
  const created = [];
  class RecordingCanvas {
    constructor(width, height) {
      this.width = width; this.height = height; this.operations = [];
      this.context = {
        globalAlpha: 1, globalCompositeOperation: 'source-over', filter: 'none',
        save: () => this.operations.push(['save']),
        restore: () => this.operations.push(['restore']),
        setTransform: (...args) => this.operations.push(['transform', ...args]),
        clearRect: (...args) => this.operations.push(['clearRect', ...args]),
        fillRect: (...args) => this.operations.push(['fillRect', ...args]),
        drawImage: (...args) => this.operations.push(['drawImage', ...args])
      };
      created.push(this);
    }
    getContext() { return this.context; }
  }
  const previousCanvas = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = RecordingCanvas;
  try {
    const source = new RecordingCanvas(160, 80);
    const renderer = Object.create(SceneRenderer.prototype);
    renderer.applyInnerShadows(source, [
      { type: 'inner-shadow', visible: true, color: '#123456', opacity: 0.4, offsetX: 4, offsetY: -2, blur: 3 }
    ], 2, 160, 80);
    const overlay = created[1];
    assert.deepEqual(overlay.operations.find(operation => operation[0] === 'transform'), ['transform', 1, 0, 0, 1, 0, 0]);
    assert.ok(overlay.operations.some(operation => operation[0] === 'drawImage' && operation[1] === source && operation[2] === 8 && operation[3] === -4));
    assert.equal(overlay.context.filter, 'none');
    assert.equal(overlay.context.globalCompositeOperation, 'destination-in');
    assert.equal(source.context.globalAlpha, 0.4);
    assert.ok(source.operations.some(operation => operation[0] === 'drawImage' && operation[1] === overlay));
  } finally {
    if (previousCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousCanvas;
  }
});

test('layer opacity is applied once after the completed effect surface', () => {
  const document = createDocument();
  const node = createNode('rectangle', {
    id: 'partially-transparent-card', width: 40, height: 24, opacity: 0.8,
    effects: [{ type: 'inner-shadow', visible: true, color: '#000000', opacity: 1, offsetX: 1, offsetY: 0, blur: 0 }]
  });
  addNode(document, node);
  const collection = createVariableCollection(document, 'Opacity');
  const opacity = createVariable(document, collection.id, 'Card opacity', 'number', 0.35);
  assert.equal(bindVariable(document, node.id, opacity.id, 'opacity'), true);

  const canvases = [];
  class RecordingCanvas {
    constructor(width, height) {
      this.width = width; this.height = height;
      const stack = [];
      this.context = {
        globalAlpha: 1, globalCompositeOperation: 'source-over', filter: 'none',
        save() { stack.push({ globalAlpha: this.globalAlpha, globalCompositeOperation: this.globalCompositeOperation, filter: this.filter }); },
        restore() { Object.assign(this, stack.pop()); },
        setTransform() {},
        drawImage: (...args) => this.draws.push({ args, alpha: this.context.globalAlpha })
      };
      this.draws = [];
      canvases.push(this);
    }
    getContext() { return this.context; }
  }

  const previousCanvas = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = RecordingCanvas;
  try {
    const parent = new RecordingCanvas(80, 48);
    parent.context.getTransform = () => ({ a: 1, b: 0 });
    const renderer = Object.create(SceneRenderer.prototype);
    renderer.getState = () => ({ document, zoom: 1 });
    let sourceNode;
    renderer.drawNode = (_context, renderedNode) => { sourceNode = renderedNode; };
    renderer.applyInnerShadows = () => {};

    renderer.drawNodeWithEffects(parent.context, node, 0, 0, new Map(), node.effects);

    assert.equal(sourceNode.opacity, 1, 'node opacity stays out of the pixels used to build its effects');
    assert.equal(sourceNode.variableBindings.opacity, undefined, 'resolved opacity binding is applied only at final composition');
    const finalComposite = parent.draws.at(-1);
    assert.equal(finalComposite.alpha, 0.35);
    assert.equal(finalComposite.args[0], canvases[1], 'the finished effect surface is composited once');
  } finally {
    if (previousCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousCanvas;
  }
});

test('group selection overlay renders degenerate line and point bounds safely', () => {
  const context = {
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
    stroke() {}, rect() {}, fill() {}, arc() {}
  };
  const cases = [
    [
      createNode('line', { x: 0, y: 10, width: 20, height: 0 }),
      createNode('line', { x: 30, y: 10, width: 20, height: 0 })
    ],
    [
      createNode('line', { x: 10, y: 0, width: 0, height: 20 }),
      createNode('line', { x: 10, y: 30, width: 0, height: 20 })
    ],
    [
      createNode('line', { x: 10, y: 10, width: 0, height: 0 }),
      createNode('line', { x: 10, y: 10, width: 0, height: 0 })
    ]
  ];

  for (const lines of cases) {
    const document = createDocument();
    for (const line of lines) addNode(document, line);
    const renderer = Object.create(SceneRenderer.prototype);
    renderer.getState = () => ({ document, selectedIds: lines.map(line => line.id), zoom: 1 });
    assert.doesNotThrow(() => renderer.drawSelection(context, document.pages[0].children, lines.map(line => line.id), 0, 0));
  }
});

test('text tracking affects measured line width and wrapping', () => {
  const context = textContext();
  assert.equal(measureTrackedText(context, 'ab cd', 0), 45);
  assert.equal(measureTrackedText(context, 'ab cd', 2), 53);
  assert.deepEqual(wrapText(context, 'ab cd', 46, 0), ['ab cd']);
  assert.deepEqual(wrapText(context, 'ab cd', 46, 2), ['ab', 'cd']);
});

test('shape rendering applies editable stroke cap, join, and dash patterns', () => {
  const document = createDocument();
  const shape = createNode('rectangle', {
    stroke: '#123456', strokeWidth: 3, strokeCap: 'round', strokeJoin: 'bevel', strokePattern: 'dashed', strokeMiterLimit: 4
  });
  addNode(document, shape);
  const calls = [];
  const context = {
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
    save() {}, restore() {}, beginPath() {}, rect() {}, fill() {},
    setLineDash(value) { calls.push(['dash', [...value]]); },
    stroke() { calls.push(['stroke', this.lineCap, this.lineJoin, this.miterLimit, this.lineWidth, this.strokeStyle]); }
  };
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => ({ document, assets: new Map(), outlineMode: false, presenting: false, zoom: 1 });
  renderer.drawNode(context, shape, 0, 0, new Map());
  assert.deepEqual(calls, [['dash', [12, 6]], ['stroke', 'round', 'bevel', 4, 3, '#123456']]);

  shape.strokePattern = 'dotted';
  shape.strokeCap = undefined;
  calls.length = 0;
  renderer.drawNode(context, shape, 0, 0, new Map());
  assert.deepEqual(calls, [['dash', [0, 6]], ['stroke', 'round', 'bevel', 4, 3, '#123456']], 'dots need a round cap to keep zero-length dash segments visible');
});

test('shape rendering paints ordered stroke layers with independent opacity and presentation', () => {
  const document = createDocument();
  const shape = createNode('rectangle', { strokes: [
    { id: 'inner', color: '#123456', width: 2, opacity: .5, visible: true, cap: 'square', join: 'bevel', pattern: 'dashed', miterLimit: 4 },
    { id: 'hidden', color: '#ffffff', width: 99, opacity: 1, visible: false, cap: 'butt', join: 'miter', pattern: 'solid', miterLimit: 10 },
    { id: 'outer', color: '#abcdef', width: 8, opacity: .25, visible: true, cap: 'round', join: 'round', pattern: 'dotted', miterLimit: 7 }
  ] });
  addNode(document, shape);
  const calls = [];
  const stack = [];
  const context = {
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
    save() { stack.push({ globalAlpha: this.globalAlpha, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, lineCap: this.lineCap, lineJoin: this.lineJoin, miterLimit: this.miterLimit }); },
    restore() { Object.assign(this, stack.pop()); }, beginPath() {}, rect() {}, fill() {},
    setLineDash(value) { calls.push(['dash', [...value]]); },
    stroke() { calls.push(['stroke', this.globalAlpha, this.lineWidth, this.strokeStyle, this.lineCap, this.lineJoin, this.miterLimit]); }
  };
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => ({ document, assets: new Map(), outlineMode: false, presenting: false, zoom: 1 });
  renderer.drawNode(context, shape, 0, 0, new Map());
  assert.deepEqual(calls, [
    ['dash', [8, 4]], ['stroke', .5, 2, '#123456', 'square', 'bevel', 4],
    ['dash', [0, 16]], ['stroke', .25, 8, '#abcdef', 'round', 'round', 7]
  ]);
});

test('compound path rendering keeps separate contours and applies the even-odd fill rule', () => {
  const document = createDocument();
  const path = createNode('path', {
    width: 100, height: 80, closed: true, fillRule: 'evenodd', fill: '#123456', stroke: null, strokeWidth: 0,
    points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
    subpaths: [{ closed: true, points: [{ x: .25, y: .25 }, { x: .75, y: .25 }, { x: .75, y: .75 }] }]
  });
  addNode(document, path);
  const calls = { moves: 0, closes: 0, fills: [] };
  const context = {
    globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '',
    save() {}, restore() {}, beginPath() {},
    moveTo() { calls.moves += 1; }, lineTo() {}, bezierCurveTo() {}, closePath() { calls.closes += 1; },
    fill(rule) { calls.fills.push(rule); }
  };
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => ({ document, assets: new Map(), outlineMode: false, presenting: false, zoom: 1 });
  renderer.drawNode(context, path, 0, 0, new Map());
  assert.deepEqual(calls, { moves: 2, closes: 2, fills: ['evenodd'] });
});

test('fallback text tracking retains pair kerning and native tracking restores canvas state', () => {
  const fallback = textContext();
  drawTrackedText(fallback, 'AV', 4, 8, 2);
  assert.deepEqual(fallback.calls, [['A', 4, 8], ['V', 15, 8]]);

  const native = textContext({ nativeTracking: true });
  drawTrackedText(native, 'AV', 4, 8, 2, 100);
  assert.deepEqual(native.calls, [['AV', 4, 8, 100]]);
  assert.equal(native.letterSpacing, '');
});

test('text decorations draw a style-colored line below or through the measured text', () => {
  const calls = [];
  const context = {
    fillStyle: '#123456', strokeStyle: '', lineWidth: 0,
    save() { calls.push(['save']); }, restore() { calls.push(['restore']); },
    beginPath() { calls.push(['begin']); }, moveTo(x, y) { calls.push(['move', x, y]); },
    lineTo(x, y) { calls.push(['line', x, y]); }, stroke() { calls.push(['stroke']); }
  };
  assert.equal(drawTextDecoration(context, 12, 8, 40, 20, 'underline'), true);
  assert.deepEqual(calls.slice(0, 4), [['save'], ['begin'], ['move', 12, 28.6], ['line', 52, 28.6]]);
  assert.equal(context.strokeStyle, '#123456');
  assert.equal(context.lineWidth, 1.25);
  calls.length = 0;
  drawTextDecoration(context, 4, 10, 25, 20, 'line-through');
  assert.deepEqual(calls.filter(call => ['move', 'line'].includes(call[0])), [['move', 4, 21], ['line', 29, 21]]);
  assert.equal(drawTextDecoration(context, 0, 0, 0, 20, 'underline'), false);
  assert.equal(drawTextDecoration(context, 0, 0, 20, 20, 'none'), false);
});

function richContext() {
  const calls = [];
  const stack = [];
  const context = {
    calls, font: '400 10px Arial', fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1,
    textAlign: 'left', textBaseline: 'alphabetic',
    save() { stack.push({ font: this.font, fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, textAlign: this.textAlign, textBaseline: this.textBaseline }); },
    restore() { Object.assign(this, stack.pop()); },
    translate(x, y) { calls.push({ transform: 'translate', x, y }); },
    scale(x, y) { calls.push({ transform: 'scale', x, y }); },
    beginPath() { calls.push({ path: 'begin' }); },
    moveTo(x, y) { calls.push({ path: 'move', x, y }); },
    lineTo(x, y) { calls.push({ path: 'line', x, y }); },
    stroke() { calls.push({ path: 'stroke', strokeStyle: this.strokeStyle, lineWidth: this.lineWidth }); },
    measureText(text) {
      const size = Number(this.font.match(/(\d+(?:\.\d+)?)px/)?.[1] || 10);
      return { width: [...String(text)].length * size * .5 };
    },
    fillText(text, x, y) { calls.push({ text, x, y, font: this.font, fillStyle: this.fillStyle }); }
  };
  return context;
}

const defaultRunStyle = {
  fontFamily: 'Arial, sans-serif', fontSize: 10, fontWeight: 400, fontStyle: 'normal',
  lineHeight: 1.25, letterSpacing: 0, color: '#000000', textDecoration: 'none', align: 'left', fillOpacity: 1
};

test('rich text draws each run with inherited or overridden font, color, and decoration', () => {
  const context = richContext();
  const result = drawTextRuns(context, [
    { text: 'Tiny ' },
    { text: 'Star', fontWeight: 700, color: '#ff0000', textDecoration: 'underline' }
  ], 4, 8, 100, defaultRunStyle);

  assert.equal(result.lines.length, 1);
  const draws = context.calls.filter(call => call.text);
  assert.deepEqual(draws.map(({ text }) => text), ['Tiny ', 'Star']);
  assert.equal(draws[0].font, '400 10px Arial, sans-serif');
  assert.equal(draws[0].fillStyle, 'rgba(0, 0, 0, 1)');
  assert.equal(draws[1].font, '700 10px Arial, sans-serif');
  assert.equal(draws[1].fillStyle, 'rgba(255, 0, 0, 1)');
  assert.ok(context.calls.some(call => call.transform === 'translate' && call.x === 4 && call.y === 8));
  assert.ok(context.calls.some(call => call.path === 'stroke' && call.strokeStyle === 'rgba(255, 0, 0, 1)'), 'run decoration should inherit its run color');
});

test('rich text wraps using each run font and advances lines for larger styles', () => {
  const context = richContext();
  const result = drawTextRuns(context, [
    { text: 'red words ' },
    { text: 'split', fontSize: 20, fontWeight: 700 }
  ], 0, 2, 55, defaultRunStyle);

  assert.deepEqual(result.lines.map(line => line.map(part => part.text).join('')), ['red words', 'split']);
  assert.ok(context.calls.some(call => call.transform === 'translate' && call.y === 2 + 12.5), 'second line should follow the first line’s 10px font metrics');
  assert.equal(result.height, 37.5, 'the second line contributes its 20px font metrics');
});

test('plain and rich text align their complete line stacks within fixed-height boxes', () => {
  assert.equal(textVerticalOffset(50, 20, 'top'), 0);
  assert.equal(textVerticalOffset(50, 20, 'middle'), 15);
  assert.equal(textVerticalOffset(50, 20, 'bottom'), 30);
  assert.equal(textVerticalOffset(10, 20, 'bottom'), 0, 'overflowing text remains anchored at the top instead of shifting out of view');

  for (const [verticalAlign, expectedY] of [['top', 2], ['middle', 14.5], ['bottom', 27]]) {
    const context = richContext();
    const result = drawTextRuns(context, [{ text: 'one\ntwo' }], 4, 2, 100, {
      ...defaultRunStyle, height: 50, verticalAlign
    });
    const firstLine = context.calls.find(call => call.transform === 'translate');
    assert.equal(firstLine.y, expectedY, `${verticalAlign} rich text should offset the first line correctly`);
    assert.equal(result.height, 25);
  }

  const document = createDocument();
  const draws = [];
  const context = {
    font: '', fillStyle: '', textAlign: 'left', textBaseline: 'top',
    save() {}, restore() {}, beginPath() {}, rect() {},
    measureText(value) { return { width: String(value).length * 5 }; },
    fillText(text, x, y) { draws.push({ text, x, y }); }
  };
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => ({ document, outlineMode: false, presenting: false, zoom: 1 });
  for (const [verticalAlign, expectedY] of [['top', 12], ['middle', 30], ['bottom', 48]]) {
    draws.length = 0;
    renderer.drawNode(context, createNode('text', {
      x: 4, y: 10, width: 80, height: 60, text: 'a\nb', textFit: 'fixed',
      fontSize: 10, lineHeight: 1.2, verticalAlign
    }), 0, 2, new Map());
    assert.deepEqual(draws.map(draw => draw.y), [expectedY, expectedY + 12], `${verticalAlign} plain text should offset each line consistently`);
  }
});

test('paragraph spacing and first-line indentation affect rich and plain canvas layout', () => {
  const rich = richContext();
  const result = drawTextRuns(rich, [{ text: 'one two\n\nnext' }], 3, 4, 50, {
    ...defaultRunStyle, paragraphSpacing: 7, firstLineIndent: 20
  });
  const richLines = rich.calls.filter(call => call.transform === 'translate');
  assert.deepEqual(richLines.map(({ x, y }) => [x, y]), [[23, 4], [3, 16.5], [3, 36], [23, 55.5]]);
  assert.deepEqual(result.lines.map(line => line.map(part => part.text).join('')), ['one', 'two', '', 'next']);
  assert.equal(result.height, 64, 'paragraph gaps contribute to rich text height');

  const document = createDocument();
  const draws = [];
  const context = {
    font: '', fillStyle: '', textAlign: 'left', textBaseline: 'top', globalAlpha: 1,
    save() {}, restore() {}, beginPath() {}, rect() {},
    measureText(value) { return { width: [...String(value)].length * 5 }; },
    fillText(text, x, y) { draws.push({ text, x, y }); }
  };
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => ({ document, outlineMode: false, presenting: false, zoom: 1 });
  renderer.drawNode(context, createNode('text', {
    x: 4, y: 10, width: 50, height: 90, text: 'one two\n\nnext', textFit: 'fixed',
    fontSize: 10, lineHeight: 1.25, paragraphSpacing: 7, firstLineIndent: 20
  }), 0, 0, new Map());
  assert.deepEqual(draws.map(({ text, x, y }) => [text, x, y]), [
    ['one', 24, 10], ['two', 4, 22.5], ['', 4, 42], ['next', 24, 61.5]
  ]);
});

test('rich canvas text paints styled list markers once, outside alignment and wrapped text transforms', () => {
  const context = richContext();
  drawTextRuns(context, [
    { text: 'alpha beta gamma\n', fontSize: 12, fontWeight: 700, color: '#ff0000' },
    { text: 'delta', fontSize: 8, fontWeight: 400, color: '#0000ff' }
  ], 5, 7, 75, {
    ...defaultRunStyle, align: 'right', fillOpacity: 0.4, listSpacing: 6,
    paragraphStyles: [
      { listStyle: 'bulleted', listLevel: 0 },
      { listStyle: 'numbered', listLevel: 0 }
    ]
  });

  const markers = context.calls.filter(call => call.text === '•' || call.text === '1.');
  assert.deepEqual(markers.map(({ text, x, y, font, fillStyle }) => [text, x, y, font, fillStyle]), [
    ['•', 5, 7, '700 12px Arial, sans-serif', 'rgba(255, 0, 0, 0.4)'],
    ['1.', 5, 43, '400 8px Arial, sans-serif', 'rgba(0, 0, 255, 0.4)']
  ]);
  const textLines = context.calls.filter(call => call.transform === 'translate');
  assert.deepEqual(textLines.map(({ x, y }) => [x, y]), [
    [5 + 13 + (62 - 60), 7],
    [5 + 13 + (62 - 30), 22],
    [5 + 18 + (57 - 20), 43]
  ], 'right alignment moves the text inside its available line width while markers stay in the list gutter');
  assert.equal(context.calls.filter(call => call.text === '•').length, 1, 'wrapped continuation lines must not repeat the marker');
});

test('plain canvas text passes paragraph list metadata through layout and paints hanging markers with node color and opacity', () => {
  const document = createDocument();
  const draws = [];
  const context = {
    font: '', fillStyle: '', textAlign: 'left', textBaseline: 'top', globalAlpha: 1,
    save() {}, restore() {}, beginPath() {}, rect() {},
    measureText(value) { return { width: [...String(value)].length * 5 }; },
    fillText(text, x, y) { draws.push({ text, x, y, font: this.font, fillStyle: this.fillStyle }); }
  };
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => ({ document, outlineMode: false, presenting: false, zoom: 1 });
  renderer.drawNode(context, createNode('text', {
    x: 10, y: 20, width: 75, height: 90, text: 'alpha beta gamma\nnext', textFit: 'fixed',
    fontSize: 10, lineHeight: 1.25, align: 'left', listSpacing: 6, fillOpacity: 0.4,
    color: '#112233',
    paragraphStyles: [
      { listStyle: 'bulleted', listLevel: 0 },
      { listStyle: 'numbered', listLevel: 0 }
    ]
  }), 0, 0, new Map());

  const markers = draws.filter(draw => draw.text === '•' || draw.text === '1.');
  assert.deepEqual(markers.map(({ text, x, y, font, fillStyle }) => [text, x, y, font, fillStyle]), [
    ['•', 10, 20, '400 10px Inter, Arial, sans-serif', 'rgba(17, 34, 51, 0.4)'],
    ['1.', 10, 51, '400 10px Inter, Arial, sans-serif', 'rgba(17, 34, 51, 0.4)']
  ]);
  assert.ok(draws.some(draw => draw.text === 'alpha beta' && draw.x === 23), 'first list line starts after the marker gutter');
  assert.ok(draws.some(draw => draw.text === 'gamma' && draw.x === 23), 'wrapped continuation keeps the hanging indent');
  assert.equal(markers.filter(draw => draw.text === '•').length, 1, 'continuation line is marker-free');
});

test('justified canvas text distributes extra space between words and keeps final paragraph lines natural', () => {
  const rich = richContext();
  drawTextRuns(rich, [{ text: 'aa ' }, { text: 'bb cc', fontWeight: 700 }], 0, 0, 35, {
    ...defaultRunStyle, align: 'justify'
  });
  const richDraws = rich.calls.filter(call => call.text);
  assert.deepEqual(richDraws.slice(0, 3).map(({ text, x }) => [text, x]), [['aa', 0], [' ', 10], ['bb', 25]]);
  assert.deepEqual(richDraws.slice(3).map(({ text, x }) => [text, x]), [['cc', 0]], 'the final line does not receive expanded spacing');

  const document = createDocument();
  const draws = [];
  const context = {
    font: '', fillStyle: '', textAlign: 'left', textBaseline: 'top', globalAlpha: 1,
    save() {}, restore() {}, beginPath() {}, rect() {},
    measureText(value) { return { width: [...String(value)].length * 5 }; },
    fillText(text, x, y) { draws.push({ text, x, y }); }
  };
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => ({ document, outlineMode: false, presenting: false, zoom: 1 });
  renderer.drawNode(context, createNode('text', {
    x: 0, y: 0, width: 35, height: 40, text: 'aa bb cc', textFit: 'fixed', align: 'justify', fontSize: 10, lineHeight: 1.25
  }), 0, 0, new Map());
  assert.deepEqual(draws.slice(0, 3).map(({ text, x }) => [text, x]), [['aa', 0], [' ', 10], ['bb', 25]]);
  assert.deepEqual(draws.slice(3).map(({ text, x }) => [text, x]), [['cc', 0]]);
});

test('rich and plain canvas text position each paragraph using its own alignment', () => {
  const rich = richContext();
  drawTextRuns(rich, [{ text: 'one\ntwo' }], 3, 4, 50, {
    ...defaultRunStyle, align: 'left',
    paragraphStyles: [{ align: 'center' }, { align: 'right' }]
  });
  assert.deepEqual(rich.calls.filter(call => call.transform === 'translate').map(({ x, y }) => [x, y]), [
    [3 + (50 - 15) / 2, 4], [3 + 50 - 15, 16.5]
  ]);

  const document = createDocument();
  const draws = [];
  const context = {
    font: '', fillStyle: '', textAlign: 'left', textBaseline: 'top', globalAlpha: 1,
    save() {}, restore() {}, beginPath() {}, rect() {},
    measureText(value) { return { width: [...String(value)].length * 5 }; },
    fillText(text, x, y) { draws.push({ text, x, y }); }
  };
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => ({ document, outlineMode: false, presenting: false, zoom: 1 });
  renderer.drawNode(context, createNode('text', {
    x: 3, y: 4, width: 50, height: 60, text: 'one\ntwo', textFit: 'fixed',
    fontSize: 10, lineHeight: 1.25, align: 'left',
    paragraphStyles: [{ align: 'center' }, { align: 'right' }]
  }), 0, 0, new Map());
  assert.deepEqual(draws.filter(draw => draw.text).map(({ text, x, y }) => [text, x, y]), [
    ['one', 3 + (50 - 15) / 2, 4], ['two', 3 + 50 - 15, 16.5]
  ]);
});

test('justified canvas text retains letter spacing at token boundaries', () => {
  const context = richContext();
  drawTextRuns(context, [{ text: 'aa bb cc' }], 0, 0, 35, {
    ...defaultRunStyle, align: 'justify', letterSpacing: 2
  });
  const b = context.calls.find(call => call.text === 'b');
  assert.equal(b.x, 23, 'the tracking between text and whitespace tokens remains part of the natural line width');

  const document = createDocument();
  const draws = [];
  const canvas = {
    font: '', fillStyle: '', textAlign: 'left', textBaseline: 'top', globalAlpha: 1,
    save() {}, restore() {}, beginPath() {}, rect() {},
    measureText(value) { return { width: [...String(value)].length * 5 }; },
    fillText(text, x, y) { draws.push({ text, x, y }); }
  };
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => ({ document, outlineMode: false, presenting: false, zoom: 1 });
  renderer.drawNode(canvas, createNode('text', {
    width: 35, height: 40, text: 'aa bb cc', textFit: 'fixed', align: 'justify',
    fontSize: 10, lineHeight: 1.25, letterSpacing: 2
  }), 0, 0, new Map());
  const plainB = draws.find(call => call.text === 'b');
  assert.equal(plainB.x, 23);
});

test('rich justified gaps keep their source run style and decoration width', () => {
  const context = richContext();
  drawTextRuns(context, [
    { text: 'aa', color: '#ff0000' },
    { text: '   ', color: '#0000ff', textDecoration: 'underline' },
    { text: 'bb cc', color: '#00aa00' }
  ], 0, 0, 45, { ...defaultRunStyle, align: 'justify' });
  const spaces = context.calls.filter(call => call.text === '   ');
  assert.equal(spaces.length, 1);
  assert.equal(spaces[0].fillStyle, 'rgba(0, 0, 255, 1)', 'expanded spaces retain the color of their source run');
  assert.deepEqual(context.calls.filter(call => call.path === 'line').map(call => call.x), [35],
    'the underline for the styled repeated-space run includes its expanded width');
});

test('rich text case changes preserve run boundaries even when Unicode casing expands', () => {
  const context = richContext();
  const result = drawTextRuns(context, [
    { text: 'straße' },
    { text: ' mix', fontWeight: 700 }
  ], 0, 0, 200, { ...defaultRunStyle, textCase: 'uppercase' });

  assert.equal(result.lines.map(line => line.map(part => part.text).join('')).join(''), 'STRASSE MIX');
  assert.deepEqual(context.calls.filter(call => call.text).map(call => call.text), ['straße'.toUpperCase(), ' MIX']);
  assert.equal(context.calls.filter(call => call.text)[1].font, '700 10px Arial, sans-serif');
});

test('hit testing follows mode-resolved geometry and rotation', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Layout');
  const compact = collection.defaultModeId;
  const expanded = addVariableMode(document, collection.id, 'Expanded');
  const x = createVariable(document, collection.id, 'X', 'number', 0);
  const y = createVariable(document, collection.id, 'Y', 'number', 0);
  const width = createVariable(document, collection.id, 'Width', 'number', 20);
  const height = createVariable(document, collection.id, 'Height', 'number', 10);
  const rotation = createVariable(document, collection.id, 'Rotation', 'number', 0);
  for (const [variable, value] of [[x, 40], [y, 20], [width, 40], [height, 20], [rotation, 90]]) assert.equal(setVariableValue(document, variable.id, value, expanded.id), true);
  const frame = createNode('frame');
  const card = createNode('rectangle', { x: 5, y: 5, width: 5, height: 5 });
  addNode(document, frame); addNode(document, card, { parentId: frame.id });
  for (const [property, variable] of Object.entries({ x, y, width, height, rotation })) assert.equal(bindVariable(document, card.id, variable.id, property), true);
  assert.equal(hitTestPage(document.pages[0], { x: 10, y: 10 }, null, document)?.id, card.id);
  assert.equal(hitTestPage(document.pages[0], { x: 50, y: 10 }, null, document)?.id, frame.id);
  assert.equal(setFrameVariableMode(document, frame.id, collection.id, expanded.id), true);
  assert.equal(hitTestPage(document.pages[0], { x: 10, y: 10 }, null, document)?.id, frame.id);
  assert.equal(hitTestPage(document.pages[0], { x: 60, y: 45 }, null, document)?.id, card.id);
  assert.equal(hitTestPage(document.pages[0], { x: 45, y: 15 }, null, document)?.id, frame.id, 'rotated resolved bounds should reject an unrotated-only hit');
  assert.equal(compact, collection.defaultModeId);
});

test('hit testing follows nested frame and group rotations to the deepest visible child', () => {
  const document = createDocument();
  const frame = createNode('frame', { x: 120, y: -90, width: 300, height: 220, rotation: 37 });
  const group = createNode('group', { x: 32, y: 24, width: 160, height: 110, rotation: -26 });
  const child = createNode('rectangle', { x: 22, y: 18, width: 64, height: 42, rotation: 19 });
  addNode(document, frame);
  addNode(document, group, { parentId: frame.id });
  addNode(document, child, { parentId: group.id });

  // Independent center transform: apply each local-to-parent rotation from
  // the leaf up to the page, as the canvas does while recursively drawing.
  const transformNodePoint = (point, node) => {
    const x = point.x + node.x;
    const y = point.y + node.y;
    const center = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
    const radians = node.rotation * Math.PI / 180;
    const dx = x - center.x;
    const dy = y - center.y;
    return {
      x: center.x + dx * Math.cos(radians) - dy * Math.sin(radians),
      y: center.y + dx * Math.sin(radians) + dy * Math.cos(radians)
    };
  };
  const childCenter = [child, group, frame].reduce(
    (point, node) => transformNodePoint(point, node),
    { x: child.width / 2, y: child.height / 2 }
  );

  assert.equal(hitTestPage(document.pages[0], childCenter, null, document)?.id, child.id,
    'a click at the nested child’s rendered center should hit that child through both ancestor rotations.');
});

test('hit testing excludes nested children outside a rotated frame clip', () => {
  const document = createDocument();
  const frame = createNode('frame', { x: 100, y: 50, width: 100, height: 100, rotation: 35, clip: true });
  const group = createNode('group', { x: 100, y: 20, width: 80, height: 60, rotation: -15 });
  const child = createNode('rectangle', { x: 5, y: 5, width: 30, height: 30 });
  addNode(document, frame);
  addNode(document, group, { parentId: frame.id });
  addNode(document, child, { parentId: group.id });
  const childCenter = nodeLocalToPage(child, { x: 15, y: 15 }, [frame, group]);

  assert.equal(hitTestPage(document.pages[0], childCenter, null, document), null,
    'a child center outside its rotated clipping frame should not be selectable.');
  frame.clip = false;
  assert.equal(hitTestPage(document.pages[0], childCenter, null, document)?.id, child.id,
    'the nested child should be hittable when the ancestor clip is disabled.');
});

test('container placement falls back from a group in a rotated rounded frame clip corner', () => {
  const document = createDocument();
  const frame = createNode('frame', { x: 100, y: 50, width: 100, height: 100, rotation: 35, radius: 24, clip: true });
  const group = createNode('group', { x: -12, y: -12, width: 28, height: 28, rotation: -15 });
  addNode(document, frame);
  addNode(document, group, { parentId: frame.id });
  const groupCenter = nodeLocalToPage(group, { x: group.width / 2, y: group.height / 2 }, [frame]);

  assert.equal(deepestContainerAtPagePoint(document.pages[0].children, groupCenter, document)?.node.id, frame.id,
    'a rounded clipped-away group should not become the Pen destination.');
  frame.clip = false;
  assert.equal(deepestContainerAtPagePoint(document.pages[0].children, groupCenter, document)?.node.id, group.id,
    'the group should become the deepest destination when clipping is disabled.');
});

test('selection overlay corners and transform handles include nested ancestor rotations', () => {
  const parent = { x: 100, y: 50, width: 100, height: 80, rotation: 90 };
  const node = { x: 10, y: 20, width: 40, height: 20, rotation: 90 };
  const overlay = selectionOverlayGeometry(node, [parent], { zoom: 2 });
  const closePoint = (actual, expected) => assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-9,
    `Expected (${actual.x}, ${actual.y}) to equal (${expected.x}, ${expected.y}).`);

  closePoint(overlay.corners[0], { x: 180, y: 80 });
  closePoint(overlay.corners[1], { x: 140, y: 80 });
  closePoint(overlay.handles.resize.nw, overlay.corners[0]);
  closePoint(overlay.handles.resize.se, overlay.corners[2]);
  assert.ok(Math.abs(Math.hypot(overlay.handles.rotate.x - overlay.handles.resize.n.x, overlay.handles.rotate.y - overlay.handles.resize.n.y) - 12) < 1e-9,
    'The rotation handle offset should remain 24 screen pixels at 200% zoom.');
});
