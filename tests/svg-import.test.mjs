import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, parseDocument, serializeDocument } from '../src/model.js';
import { importSvgToLayers, SvgImportError } from '../src/svg-import.js';

function allNodes(nodes, output = []) {
  for (const node of nodes) {
    output.push(node);
    allNodes(node.children || [], output);
  }
  return output;
}

function importFailure(markup, code) {
  assert.throws(() => importSvgToLayers(markup), error => {
    assert.ok(error instanceof SvgImportError);
    assert.equal(error.code, code);
    return true;
  });
}

test('imports safe primitive geometry, editable groups, inherited paint and deterministic IDs', () => {
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90" viewBox="0 0 160 90">
    <g id="card-group" transform="translate(12,8)" fill="#336699" fill-opacity=".5" opacity=".8">
      <rect id="card" x="-2" y="4" width="40" height="24" rx="4" stroke="#112233" stroke-width="2"/>
      <circle id="dot" cx="60" cy="20" r="8" fill="rgb(255, 0, 128)"/>
      <ellipse cx="82" cy="18" rx="12" ry="5" fill="none" stroke="#ff0000"/>
      <line x1="2" y1="50" x2="40" y2="60" stroke="#123456"/>
      <polyline points="50,40 60,50 70,40" fill="none" stroke="#222222"/>
      <polygon points="90,40 110,40 100,58" fill="#abc"/>
    </g>
  </svg>`;
  const first = importSvgToLayers(markup);
  const second = importSvgToLayers(markup);
  assert.deepEqual(first, second);
  assert.equal(first.width, 160);
  assert.equal(first.height, 90);
  const nodes = allNodes(first.nodes);
  assert.ok(nodes.some(node => node.type === 'group' && node.name === 'card-group'));
  const card = nodes.find(node => node.name === 'card fill');
  assert.equal(card.type, 'path');
  assert.equal(card.fill, '#336699');
  assert.equal(card.fillOpacity, 0.5);
  assert.equal(nodes.find(node => node.name === 'card-group').opacity, 0.8);
  assert.equal(nodes.find(node => node.name === 'card stroke').strokeWidth, 2);
  assert.ok(nodes.some(node => node.name === 'dot' && node.fill === '#ff0080'));
  assert.ok(nodes.some(node => node.name === 'ellipse 4' && node.stroke === '#ff0000'));
  assert.ok(nodes.some(node => node.name === 'line 5' && node.stroke === '#123456'));
  assert.ok(nodes.some(node => node.name === 'polyline 6' && node.closed === false));
  assert.ok(nodes.some(node => node.name === 'polygon 7' && node.closed === true));
});

test('maps viewBox, preserveAspectRatio and transforms into path points, including negative coordinates', () => {
  const result = importSvgToLayers(`<svg width="200" height="100" viewBox="-10 -10 100 100" preserveAspectRatio="xMaxYMin meet" transform="translate(3 4)">
    <path d="M -10 -10 C 0 -10 0 0 10 0 L 10 10 Z" fill="#0f0"/>
  </svg>`);
  const path = allNodes(result.nodes).find(node => node.type === 'path');
  assert.equal(path.x, 103);
  assert.equal(path.y, 4);
  assert.equal(path.width, 20);
  assert.equal(path.height, 20);
  assert.equal(path.closed, true);
  assert.deepEqual(result.viewBox, [-10, -10, 100, 100]);

  const nonUniform = importSvgToLayers(`<svg width="200" height="100" viewBox="0 0 100 100" preserveAspectRatio="none"><rect x="0" y="0" width="10" height="10" fill="#000"/></svg>`);
  const stretched = allNodes(nonUniform.nodes).find(node => node.type === 'path');
  assert.equal(stretched.width, 20);
  assert.equal(stretched.height, 10);
});

test('imports SVG path line, cubic, smooth, quadratic, and arc commands as editable cubic vectors', () => {
  const path = allNodes(importSvgToLayers(`<svg viewBox="0 0 120 100"><path d="M 5 10 h 20 v 10 l -20 0 C 5 40 20 40 25 30 S 45 20 50 30 Q 60 40 70 30 T 90 30 A 12 8 20 0 1 110 45 Z" fill="#abcdef"/></svg>`).nodes)
    .find(node => node.type === 'path');
  assert.equal(path.closed, true);
  assert.equal(path.fill, '#abcdef');
  assert.equal(path.points.length, 10);
  assert.ok(path.points.some(point => point.out));
  assert.ok(path.points.some(point => point.in));
  assert.ok(path.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));

  const compactArc = allNodes(importSvgToLayers(`<svg><path d="M0 0 A10 10 0 0110 20" fill="#000"/></svg>`).nodes)
    .find(node => node.type === 'path');
  assert.equal(compactArc.points.length, 3, 'adjacent arc flags are tokenized as separate SVG flags');
});

test('preserves fill/stroke opacity, element opacity, inherited styles and uniform stroke scaling', () => {
  const result = importSvgToLayers(`<svg width="400" height="200" viewBox="0 0 100 50">
    <g opacity=".5" fill="#ff000080" fill-opacity=".5" stroke="#0000ff" stroke-opacity=".25" stroke-width="2">
      <path opacity=".5" d="M0 0 L10 0 L10 10 Z"/>
    </g>
  </svg>`);
  const nodes = allNodes(result.nodes);
  const fill = nodes.find(node => node.name === 'path 2 fill');
  const stroke = nodes.find(node => node.name === 'path 2 stroke');
  assert.equal(fill.fillOpacity, 0.25098039215686274);
  assert.equal(fill.opacity, 1);
  assert.equal(nodes.find(node => node.name === 'g 1').opacity, 0.5);
  assert.equal(nodes.find(node => node.name === 'path 2').opacity, 0.5);
  assert.equal(stroke.stroke, '#0000ff');
  assert.equal(stroke.strokeWidth, 8);
  assert.equal(stroke.opacity, 0.25);
  const rootOpacity = importSvgToLayers(`<svg opacity=".4"><g opacity=".5"><rect width="10" height="10" fill="#000"/></g></svg>`);
  assert.equal(rootOpacity.nodes[0].opacity, 0.4);
  assert.equal(rootOpacity.nodes[0].children[0].opacity, 0.5);
});

test('maps affine transforms to editable vector geometry and rejects distorted stroke widths', () => {
  const skewed = importSvgToLayers(`<svg width="100" height="100"><path transform="matrix(1 0 .5 1 5 6)" d="M0 0 L10 0 L10 10 Z" fill="#fff"/></svg>`);
  const skewedPath = allNodes(skewed.nodes).find(node => node.type === 'path');
  assert.equal(skewedPath.x, 5);
  assert.equal(skewedPath.y, 6);
  assert.equal(skewedPath.width, 15);
  assert.equal(skewedPath.height, 10);
  importFailure(`<svg><path transform="scale(2 1)" d="M0 0 L10 10" stroke="#000"/></svg>`, 'non-uniform-stroke-transform');
});

test('requires an explicit viewport for percentage dimensions', () => {
  importFailure(`<svg width="100%" height="100%"><rect width="10" height="10"/></svg>`, 'viewport-required');
  const result = importSvgToLayers(`<svg width="100%" height="50%"><rect width="10" height="10"/></svg>`, { viewportWidth: 300, viewportHeight: 200 });
  assert.equal(result.width, 300);
  assert.equal(result.height, 100);
  const half = importSvgToLayers(`<svg width="50%" height="25%"/>`, { viewportWidth: 300, viewportHeight: 200 });
  assert.equal(half.width, 150);
  assert.equal(half.height, 50);
});

test('fills open subpaths by SVG rules and honors visibility overrides and nested opacity properties', () => {
  const result = importSvgToLayers(`<svg opacity=".4"><g opacity=".5" visibility="hidden" fill="#ff0000">
    <polyline id="hidden-line" points="0,0 10,0 10,10"/>
    <path id="visible-fill" visibility="visible" d="M0 0 L10 0 L10 10"/>
  </g></svg>`);
  const nodes = allNodes(result.nodes);
  assert.equal(result.nodes[0].opacity, 0.4);
  const group = nodes.find(node => node.type === 'group');
  assert.equal(group.opacity, 0.5);
  assert.equal(group.children.length, 1, 'a child can override inherited visibility:hidden');
  const fill = nodes.find(node => node.name === 'visible-fill');
  assert.equal(fill.closed, true, 'an open SVG path is implicitly closed for fill rendering');
  assert.equal(fill.fill, '#ff0000');
});

test('rejects active content, external references, declarations, and unresolved paint features', () => {
  importFailure(`<svg><script>alert(1)</script></svg>`, 'active-content');
  importFailure(`<svg><foreignObject><div/></foreignObject></svg>`, 'active-content');
  importFailure(`<svg><rect onload="alert(1)" width="10" height="10"/></svg>`, 'active-content');
  importFailure(`<svg><text display="none" dominant-baseline="text-before-edge"><script>alert(1)</script></text></svg>`, 'active-content');
  importFailure(`<svg><image href="https://example.test/a.png" width="10" height="10"/></svg>`, 'external-reference');
  importFailure(`<svg><use href="#shape"/></svg>`, 'external-reference');
  importFailure(`<!DOCTYPE svg [<!ENTITY x SYSTEM "https://example.test/x">]><svg>&x;</svg>`, 'unsafe-declaration');
  importFailure(`<svg><rect width="10" height="10" style="fill:url(https://example.test/a.svg#x)"/></svg>`, 'external-reference');
  importFailure(`<svg><rect width="10" height="10" filter="url(#blur)"/></svg>`, 'unsupported-attribute');
});

test('reports model-incompatible geometry and paint explicitly', () => {
  importFailure(`<svg><text x="0" y="0">hello</text></svg>`, 'unsupported-text-baseline');
  importFailure(`<svg><g><marker/></g></svg>`, 'unsupported-element');
});

test('imports compound paths with independent closure and even-odd fill into editable contour data', () => {
  const result = importSvgToLayers(`<svg width="120" height="100">
    <path id="donut" d="M 5 5 L 95 5 L 95 95 L 5 95 Z M 25 25 L 25 75 L 75 75 L 75 25 Z M 105 10 L 115 10 L 110 20" fill="#336699" fill-rule="evenodd" stroke="#102030"/>
  </svg>`);
  const nodes = allNodes(result.nodes);
  const fill = nodes.find(node => node.type === 'path' && node.name === 'donut fill');
  const stroke = nodes.find(node => node.type === 'path' && node.name === 'donut stroke');
  assert.ok(fill);
  assert.ok(stroke);
  assert.equal(fill.fillRule, 'evenodd');
  assert.equal(fill.closed, true);
  assert.deepEqual(fill.subpaths.map(contour => contour.closed), [true, true], 'fill geometry implicitly closes every source contour');
  assert.equal(stroke.closed, true);
  assert.deepEqual(stroke.subpaths.map(contour => contour.closed), [true, false], 'stroke geometry preserves source closure per contour');
  assert.ok(fill.points.every(point => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1));
  assert.ok(fill.subpaths.flatMap(contour => contour.points).every(point => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1));
});

test('imports a plain SVG text run as an editable native text layer with inherited supported styles', () => {
  const result = importSvgToLayers(`<svg width="300" height="120">
    <g transform="translate(10 20)" fill="#336699" fill-opacity=".5" font-family="Inter, Arial, sans-serif"
       font-size="20" font-weight="700" font-style="italic" text-anchor="middle" dominant-baseline="text-before-edge">
      <text id="headline" x="100" y="5" letter-spacing="1" text-decoration="underline">Hello &amp; world</text>
    </g>
  </svg>`);
  const headline = allNodes(result.nodes).find(node => node.type === 'text');
  assert.ok(headline, 'SVG text imports as a native text layer');
  assert.equal(headline.name, 'headline');
  assert.equal(headline.text, 'Hello & world');
  assert.equal(headline.fontFamily, 'Inter, Arial, sans-serif');
  assert.equal(headline.fontSize, 20);
  assert.equal(headline.fontWeight, 700);
  assert.equal(headline.fontStyle, 'italic');
  assert.equal(headline.letterSpacing, 1);
  assert.equal(headline.color, '#336699');
  assert.equal(headline.fillOpacity, 0.5);
  assert.equal(headline.align, 'center');
  assert.equal(headline.textDecoration, 'underline');
  assert.equal(headline.textFit, 'auto-width');
  const group = allNodes(result.nodes).find(node => node.type === 'group');
  assert.equal(headline.x + group.x + headline.width / 2, 110, 'text-anchor=middle keeps the transformed SVG anchor centered');
  assert.equal(headline.y + group.y, 25, 'text-before-edge maps to the native text top edge');
});

test('imports ordered SVG tspan styles as editable mixed text runs', () => {
  const result = importSvgToLayers(`<svg width="240" height="80">
    <text x="12" y="8" font-size="16" fill="#123456" dominant-baseline="text-before-edge">Hi <tspan style="font-weight:700;fill:#ff0000;font-size:24px;line-height:36px;letter-spacing:1px;text-decoration:underline">there</tspan>!</text>
  </svg>`);
  const text = allNodes(result.nodes).find(node => node.type === 'text');
  assert.equal(text.text, 'Hi there!');
  assert.equal(text.fontSize, 16);
  assert.equal(text.color, '#123456');
  assert.deepEqual(text.textRuns, [
    { text: 'Hi ' },
    { text: 'there', fontSize: 24, fontWeight: 700, lineHeight: 1.5, letterSpacing: 1, textDecoration: 'underline', color: '#ff0000' },
    { text: '!' }
  ]);
  assert.equal(text.textRuns.map(run => run.text).join(''), text.text);
  assert.ok(text.width > 0 && text.width < 300, 'auto-width bounds account for mixed run sizes');
  const document = createDocument();
  document.pages[0].children = result.nodes;
  const restored = allNodes(parseDocument(serializeDocument(document)).pages[0].children).find(node => node.type === 'text');
  assert.deepEqual(restored.textRuns, text.textRuns, 'imported run order and formatting survive local save/reload');
});

test('SVG whitespace collapses across tspan boundaries and keeps the originating run style', () => {
  const text = allNodes(importSvgToLayers(`<svg><text dominant-baseline="text-before-edge">A <tspan fill="#ff0000"> B </tspan> C</text></svg>`).nodes)
    .find(node => node.type === 'text');
  assert.equal(text.text, 'A B C');
  assert.equal(text.textRuns.map(run => run.text).join(''), 'A B C');
  assert.ok(text.textRuns.some(run => run.color === '#ff0000' && run.text === 'B '), 'the collapsed space after a tspan keeps its source formatting');
});

test('imports positively scaled and rotated text without changing its anchor', () => {
  const result = importSvgToLayers(`<svg width="100" height="100"><text id="rotated" x="10" y="20" transform="translate(5 6) rotate(90) scale(2)"
      font-size="12" dominant-baseline="text-before-edge">Hi</text></svg>`);
  const text = allNodes(result.nodes).find(node => node.type === 'text');
  assert.equal(text.rotation, 90);
  assert.equal(text.fontSize, 24);
  assert.equal(text.width, Math.ceil((2 * 12 * 1.25 + 2) * 2));
  const angle = text.rotation * Math.PI / 180;
  const topLeftAfterRotation = {
    x: text.x + text.width / 2 - Math.cos(angle) * text.width / 2 + Math.sin(angle) * text.height / 2,
    y: text.y + text.height / 2 - Math.sin(angle) * text.width / 2 - Math.cos(angle) * text.height / 2
  };
  assert.ok(Math.abs(topLeftAfterRotation.x - (-35)) < 1e-8);
  assert.ok(Math.abs(topLeftAfterRotation.y - 26) < 1e-8);
});

test('uses SVG default x/y coordinates and preserves valid non-BMP text characters', () => {
  const text = allNodes(importSvgToLayers(`<svg><text dominant-baseline="text-before-edge">&#x1f680;</text></svg>`).nodes)
    .find(node => node.type === 'text');
  assert.equal(text.text, '🚀');
  assert.equal(text.x, 0);
  assert.equal(text.y, 0);
});

test('accepts valid literal Unicode in XML and rejects lone surrogates and forbidden numeric characters', () => {
  const literal = allNodes(importSvgToLayers(`<svg><text dominant-baseline="text-before-edge">🚀 café</text></svg>`).nodes)
    .find(node => node.type === 'text');
  assert.equal(literal.text, '🚀 café');
  importFailure(`<svg><text dominant-baseline="text-before-edge">\ud83d</text></svg>`, 'invalid-xml-character');
  importFailure(`<svg><text dominant-baseline="text-before-edge">&#xFFFE;</text></svg>`, 'invalid-xml-character');
  importFailure(`<svg id="bad\udc80"/>`, 'invalid-xml-character');
});

test('rejects SVG text features the native text model cannot represent', () => {
  importFailure(`<svg><text x="0 10" y="0" dominant-baseline="text-before-edge">A</text></svg>`, 'unsupported-text-positioning');
  importFailure(`<svg><text x="0" y="0" dx="2" dominant-baseline="text-before-edge">A</text></svg>`, 'unsupported-text-positioning');
  importFailure(`<svg><text x="0" y="0" dominant-baseline="alphabetic">A</text></svg>`, 'unsupported-text-baseline');
  importFailure(`<svg><text x="0" y="0" dominant-baseline="text-before-edge" stroke="#000">A</text></svg>`, 'unsupported-text-paint');
  importFailure(`<svg><defs><linearGradient id="g"><stop/><stop offset="1"/></linearGradient></defs><text x="0" y="0" dominant-baseline="text-before-edge" fill="url(#g)">A</text></svg>`, 'unsupported-text-paint');
  importFailure(`<svg><text x="0" y="0" dominant-baseline="text-before-edge" textLength="100">A</text></svg>`, 'unsupported-text-feature');
  importFailure(`<svg><text dominant-baseline="text-before-edge">A<tspan x="10">B</tspan></text></svg>`, 'unsupported-text-positioning');
  importFailure(`<svg><text dominant-baseline="text-before-edge">A<tspan opacity=".5">B</tspan></text></svg>`, 'unsupported-text-opacity');
  importFailure(`<svg><text dominant-baseline="text-before-edge">A<tspan fill="#ff000080">B</tspan></text></svg>`, 'unsupported-text-paint');
  importFailure(`<svg><text dominant-baseline="text-before-edge">A<tspan text-transform="uppercase">B</tspan></text></svg>`, 'unsupported-text-feature');
  importFailure(`<svg><text dominant-baseline="text-before-edge">A<tspan transform="translate(4 0)">B</tspan></text></svg>`, 'unsupported-text-transform');
  importFailure(`<svg><text dominant-baseline="text-before-edge">A<g>B</g></text></svg>`, 'unsupported-text-feature');
  importFailure(`<svg><text x="0" y="0" transform="scale(2 1)" dominant-baseline="text-before-edge">A</text></svg>`, 'unsupported-text-transform');
  importFailure(`<svg><text x="0" y="0" transform="scale(10000)" font-size="100" dominant-baseline="text-before-edge">A</text></svg>`, 'resource-limit');
  importFailure(`<svg><text x="0" y="0" dominant-baseline="text-before-edge" xml:space="preserve">A  B</text></svg>`, 'unsupported-text-whitespace');
  importFailure(`<svg><text x="0" y="0" dominant-baseline="text-before-edge"><script/></text></svg>`, 'active-content');
  importFailure(`<svg><text x="0" y="0" dominant-baseline="text-before-edge">A\u0001B</text></svg>`, 'invalid-xml-character');
  importFailure(`<svg>stray</svg>`, 'unsupported-text');
  importFailure(`<svg><text><![CDATA[A&B]]></text></svg>`, 'unsupported-text-feature');
});

test('imports editable SVG stroke caps, joins, and standard dash patterns', () => {
  const result = importSvgToLayers(`<svg><g stroke="#123456" stroke-width="2" stroke-linecap="round" stroke-linejoin="bevel" stroke-dasharray="8 4">
    <path id="dashed" d="M0 0L20 0" fill="none"/>
    <path id="dotted" d="M0 10L20 10" fill="none" stroke-dasharray="0 4"/>
  </g></svg>`);
  const nodes = allNodes(result.nodes);
  const dashed = nodes.find(node => node.name === 'dashed');
  assert.equal(dashed.strokeCap, 'round');
  assert.equal(dashed.strokeJoin, 'bevel');
  assert.equal(dashed.strokePattern, 'dashed');
  const dotted = nodes.find(node => node.name === 'dotted');
  assert.equal(dotted.strokePattern, 'dotted');
  assert.equal(dotted.strokeCap, 'round');
  importFailure(`<svg><path d="M0 0L20 0" stroke="#000" stroke-width="2" stroke-dasharray="3 5"/></svg>`, 'unsupported-stroke-style');
  importFailure(`<svg><path d="M0 0L20 0" stroke="#000" stroke-width="2" stroke-dasharray="0 4"/></svg>`, 'unsupported-stroke-style');
});

test('rechecks inherited SVG dash lengths against each element width and lets none clear them', () => {
  importFailure(`<svg><g stroke="#123456" stroke-width="1" stroke-dasharray="4 2"><path d="M0 0L20 0" stroke-width="2"/></g></svg>`, 'unsupported-stroke-style');
  const result = importSvgToLayers(`<svg><g stroke="#123456" stroke-width="1" stroke-dasharray="4 2">
    <path id="cleared" d="M0 0L20 0" stroke-width="2" stroke-dasharray="none"/>
    <path id="redeclared" d="M0 10L20 10" stroke-width="2" stroke-dasharray="8 4"/>
  </g></svg>`);
  const nodes = allNodes(result.nodes);
  assert.equal(nodes.find(node => node.name === 'cleared stroke').strokePattern, 'solid');
  assert.equal(nodes.find(node => node.name === 'redeclared stroke').strokePattern, 'dashed');
});

test('preserves the SVG default, explicit, and inherited miter limits on editable strokes', () => {
  const result = importSvgToLayers(`<svg>
    <path id="default-limit" d="M0 0L20 0L10 1Z" fill="none" stroke="#000000"/>
    <path id="custom-limit" d="M0 10L20 10L10 11Z" fill="none" stroke="#000000" stroke-miterlimit="7"/>
    <g stroke-miterlimit="6"><path id="inherited-limit" d="M0 20L20 20L10 21Z" fill="none" stroke="#000000"/></g>
  </svg>`);
  const nodes = allNodes(result.nodes);
  assert.equal(nodes.find(node => node.name === 'default-limit').strokeMiterLimit, 4);
  assert.equal(nodes.find(node => node.name === 'custom-limit').strokeMiterLimit, 7);
  assert.equal(nodes.find(node => node.name === 'inherited-limit').strokeMiterLimit, 6);
});

test('imports gradients that map faithfully to editable linear and radial fills', () => {
  const result = importSvgToLayers(`<svg width="100" height="100">
    <defs>
      <linearGradient id="horizontal"><stop offset="0" stop-color="#ff0000"/><stop offset="100%" style="stop-color:#0000ff"/></linearGradient>
      <linearGradient id="vertical" gradientTransform="rotate(90 .5 .5)"><stop stop-color="#ffffff"/><stop offset="1" stop-color="#000000"/></linearGradient>
      <linearGradient id="shifted" x1="25%" x2="75%"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient>
      <radialGradient id="radial" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ff0000" stop-opacity=".5"/><stop offset="1" stop-color="#0000ff" stop-opacity=".5"/></radialGradient>
    </defs>
    <rect id="wide" width="100" height="40" fill="url(#horizontal)"/>
    <rect id="tall" y="45" width="20" height="40" fill="url(#vertical)"/>
    <rect id="square" x="50" y="50" width="40" height="40" fill="url(#radial)"/>
    <rect id="shifted-fill" y="90" width="20" height="10" fill="url(#shifted)"/>
  </svg>`);
  const nodes = allNodes(result.nodes);
  const wide = nodes.find(node => node.name === 'wide');
  assert.equal(wide.fillGradient.type, 'linear');
  assert.equal(wide.fillGradient.angle, 0);
  assert.deepEqual(wide.fillGradient.stops.map(({ color, position }) => [color, position]), [['#ff0000', 0], ['#0000ff', 1]]);
  assert.equal(new Set(wide.fillGradient.stops.map(stop => stop.id)).size, 2);
  const tall = nodes.find(node => node.name === 'tall');
  assert.equal(tall.fillGradient.type, 'linear');
  assert.ok(Math.abs(tall.fillGradient.angle - 90) < 1e-6);
  const square = nodes.find(node => node.name === 'square');
  assert.equal(square.fillGradient.type, 'radial');
  assert.equal(square.fillOpacity, 0.5);
  assert.ok(square.fillGradient.stops[1].position < 1, 'radial stop positions scale to the editor’s larger circle');
  const shifted = nodes.find(node => node.name === 'shifted-fill');
  assert.deepEqual(shifted.fillGradient.stops.map(stop => stop.position), [0, 0.25, 0.75, 1]);
});

test('rejects SVG gradients the editable fill model would render differently', () => {
  importFailure(`<svg><rect width="10" height="10" fill="url(#missing)"/></svg>`, 'missing-gradient');
  importFailure(`<svg><rect width="20" height="10" fill="url(#repeat)"/><defs><linearGradient id="repeat" spreadMethod="repeat"><stop/><stop offset="1"/></linearGradient></defs></svg>`, 'unsupported-gradient');
  importFailure(`<svg><rect width="20" height="10" fill="url(#alpha)"/><defs><linearGradient id="alpha"><stop stop-opacity=".2"/><stop offset="1" stop-opacity=".8"/></linearGradient></defs></svg>`, 'unsupported-gradient');
  importFailure(`<svg><rect width="20" height="10" fill="url(#focus)"/><defs><radialGradient id="focus" fx="20%"><stop/><stop offset="1"/></radialGradient></defs></svg>`, 'unsupported-gradient');
  importFailure(`<svg><rect width="20" height="10" fill="url(#bad)"/><defs><linearGradient id="bad" href="#other"><stop/><stop offset="1"/></linearGradient></defs></svg>`, 'external-reference');
});

test('rejects oversized path point counts during bounded preflight before building point arrays', () => {
  const repeatedSegments = 'L1 1'.repeat(240_000);
  const oversized = `<svg><path d="M0 0${repeatedSegments}" fill="#000" stroke="#f00"/></svg>`;
  assert.ok(oversized.length < 1_000_000, 'regression input is the review-sized ~960 KB path');
  assert.throws(() => importSvgToLayers(oversized), error => {
    assert.ok(error instanceof SvgImportError);
    assert.equal(error.code, 'resource-limit');
    assert.match(error.message, /20000 points/);
    return true;
  });
});

test('applies a cumulative point budget across paths, not only a per-path cap', () => {
  const path = `M0 0${'L1 1'.repeat(10_000)}`;
  const markup = `<svg><path d="${path}" fill="#000"/><path d="${path}" fill="#000"/></svg>`;
  assert.throws(() => importSvgToLayers(markup), error => error instanceof SvgImportError
    && error.code === 'resource-limit' && /20000 points/.test(error.message));
});
