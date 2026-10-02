import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode, applyTypographyStyle, createComponent, createComponentInstance, createDocument, createNode,
  createTypographyStyle, findNode, parseDocument, serializeDocument, syncComponentInstances, validateDocument
} from '../src/model.js';
import { applyAppearance, snapshotAppearance } from '../src/appearance-clipboard.js';
import { exportNodeToSvg } from '../src/svg-export.js';
import { importSvgToLayers } from '../src/svg-import.js';
import { buildInspectOutput } from '../src/inspect.js';
import { applyHostTypedOperation } from '../src/collaboration/host-operation-engine.js';
import { planGuestOperationSnapshots } from '../src/collaboration/guest-operation-planner.js';

function allNodes(nodes) {
  return nodes.flatMap(node => [node, ...allNodes(node.children || [])]);
}

test('variable axes and OpenType features persist through text runs, styles, components, clipboard, and local saves', () => {
  const document = createDocument();
  const text = createNode('text', {
    text: 'AB', fontFamily: 'Variable Sans', fontAxes: { wght: 640, wdth: 93 }, fontFeatures: { liga: 0, ss01: 1 },
    textRuns: [{ text: 'A', fontAxes: { wght: 710, opsz: 18 }, fontFeatures: { dlig: 1 } }, { text: 'B' }]
  });
  document.pages[0].children.push(text);

  const style = createTypographyStyle(document, text.id, 'Variable heading');
  assert.deepEqual(style.fontAxes, { wght: 640, wdth: 93 });
  assert.deepEqual(style.fontFeatures, { liga: 0, ss01: 1 });
  const styledText = createNode('text', { text: 'Copy', fontAxes: { wght: 400, wdth: 100 }, fontFeatures: { liga: 1 } });
  document.pages[0].children.push(styledText);
  assert.equal(applyTypographyStyle(document, styledText.id, style.id), true);
  assert.deepEqual(styledText.fontAxes, { wght: 640, wdth: 93 });
  assert.deepEqual(styledText.fontFeatures, { liga: 0, ss01: 1 });

  const appearance = snapshotAppearance(text);
  const pasted = applyAppearance(createNode('text', { text: 'Paste target' }), appearance);
  assert.deepEqual(pasted.node.fontAxes, { wght: 640, wdth: 93 });
  assert.deepEqual(pasted.node.fontFeatures, { liga: 0, ss01: 1 });
  assert.deepEqual(pasted.node.textRuns, undefined, 'appearance clipboard does not copy content-bound rich runs');

  const master = createNode('frame', { children: [createNode('text', {
    text: 'Master', fontAxes: { wght: 500, opsz: 16 }, fontFeatures: { kern: 0 }
  })] });
  document.pages[0].children.push(master);
  const component = createComponent(document, master.id);
  const instance = createComponentInstance(document, component.id);
  const instanceRoot = findNode(document, instance.id).node;
  const instanceText = instanceRoot.children.find(child => child.type === 'text');
  instanceRoot.componentOverrides ||= {};
  instanceRoot.componentOverrides[instanceText.componentSourceId] = { fontAxes: { wght: 730, opsz: 20 }, fontFeatures: { liga: 0, kern: 1 } };
  syncComponentInstances(document, component.id);
  assert.deepEqual(findNode(document, instance.id).node.children.find(child => child.type === 'text').fontAxes,
    { wght: 730, opsz: 20 });
  assert.deepEqual(findNode(document, instance.id).node.children.find(child => child.type === 'text').fontFeatures,
    { liga: 0, kern: 1 });

  assert.equal(validateDocument(document), true);
  const restored = parseDocument(serializeDocument(document));
  assert.deepEqual(findNode(restored, text.id).node.textRuns[0].fontAxes, { wght: 710, opsz: 18 });
  assert.deepEqual(findNode(restored, text.id).node.textRuns[0].fontFeatures, { dlig: 1 });
  assert.deepEqual(restored.typographyStyles.find(item => item.id === style.id).fontAxes, { wght: 640, wdth: 93 });
  assert.deepEqual(restored.typographyStyles.find(item => item.id === style.id).fontFeatures, { liga: 0, ss01: 1 });
  assert.deepEqual(findNode(restored, instance.id).node.children.find(child => child.type === 'text').fontAxes,
    { wght: 730, opsz: 20 });
  assert.deepEqual(findNode(restored, instance.id).node.children.find(child => child.type === 'text').fontFeatures,
    { liga: 0, kern: 1 });
  const inspect = buildInspectOutput(restored, [findNode(restored, text.id)]);
  assert.deepEqual(inspect.layers[0].typography.fontAxes, { wght: 640, wdth: 93 });
  assert.deepEqual(inspect.layers[0].typography.fontFeatures, { liga: 0, ss01: 1 });
  assert.match(inspect.css, /font-feature-settings: "liga" 0, "ss01" 1;/);
  assert.match(inspect.json, /"fontAxes": \{/);

  const invalid = structuredClone(restored);
  const invalidInstance = findNode(invalid, instance.id).node;
  invalidInstance.componentOverrides[instanceText.componentSourceId].fontAxes = { wght: Infinity };
  assert.throws(() => validateDocument(invalid), /Invalid component font axes override/);
  invalidInstance.componentOverrides[instanceText.componentSourceId].fontAxes = { wght: 730, opsz: 20 };
  invalidInstance.componentOverrides[instanceText.componentSourceId].fontFeatures = { liga: 1.5 };
  assert.throws(() => validateDocument(invalid), /Invalid component OpenType features override/);
});

test('SVG export and import preserve layer and per-run axes and OpenType feature settings', () => {
  const node = createNode('text', {
    name: 'Variable sample', width: 180, height: 40, text: 'AB', fontFamily: 'Variable Sans',
    fontAxes: { wght: 620, wdth: 96.5 }, fontFeatures: { liga: 0, ss01: 1 },
    textRuns: [
      { text: 'A', fontAxes: { wght: 710, opsz: 18 }, fontFeatures: { dlig: 1 } },
      { text: 'B', fontAxes: { wght: 500, wdth: 85 }, fontFeatures: { kern: 0 } }
    ]
  });
  const svg = exportNodeToSvg(node, { measureText: (value, style) => String(value).length * style.fontSize * .5 });
  assert.match(svg, /font-variation-settings="&quot;wdth&quot; 96\.5, &quot;wght&quot; 620"/);
  assert.match(svg, /font-variation-settings="&quot;opsz&quot; 18, &quot;wght&quot; 710"/);
  assert.match(svg, /font-feature-settings="&quot;liga&quot; 0, &quot;ss01&quot; 1"/);
  assert.match(svg, /font-feature-settings="&quot;dlig&quot; 1"/);
  const imported = allNodes(importSvgToLayers(svg).nodes).find(layer => layer.type === 'text');
  assert.deepEqual(imported.fontAxes, { wdth: 96.5, wght: 620 });
  assert.deepEqual(imported.textRuns.map(run => run.fontAxes), [
    { opsz: 18, wght: 710 }, { wdth: 85, wght: 500 }
  ]);
  assert.deepEqual(imported.fontFeatures, { liga: 0, ss01: 1 });
  assert.deepEqual(imported.textRuns.map(run => run.fontFeatures), [{ dlig: 1 }, { kern: 0 }]);
});

test('guest collaboration plans and host validates variable-axis and feature edits, including clears', () => {
  const before = createDocument();
  const text = createNode('text', { text: 'Shared typography' });
  addNode(before, text);
  const after = structuredClone(before);
  findNode(after, text.id).node.fontAxes = { wght: 680, opsz: 17 };
  const plan = planGuestOperationSnapshots(before, after);
  assert.equal(plan?.length, 1);
  assert.equal(plan[0].operation.property, 'fontAxes');
  const applied = applyHostTypedOperation(before, plan[0].operation);
  assert.deepEqual(findNode(applied, text.id).node.fontAxes, { wght: 680, opsz: 17 });

  const cleared = structuredClone(applied);
  delete findNode(cleared, text.id).node.fontAxes;
  const clearPlan = planGuestOperationSnapshots(applied, cleared);
  assert.equal(clearPlan?.[0].operation.value, null);
  const clearApplied = applyHostTypedOperation(applied, clearPlan[0].operation);
  assert.equal(Object.hasOwn(findNode(clearApplied, text.id).node, 'fontAxes'), false);

  const featuresSet = structuredClone(clearApplied);
  findNode(featuresSet, text.id).node.fontFeatures = { liga: 0, ss01: 1 };
  const featurePlan = planGuestOperationSnapshots(clearApplied, featuresSet);
  assert.equal(featurePlan?.length, 1);
  assert.equal(featurePlan[0].operation.property, 'fontFeatures');
  const featureApplied = applyHostTypedOperation(clearApplied, featurePlan[0].operation);
  assert.deepEqual(findNode(featureApplied, text.id).node.fontFeatures, { liga: 0, ss01: 1 });
  const featureCleared = structuredClone(featureApplied);
  delete findNode(featureCleared, text.id).node.fontFeatures;
  const featureClearPlan = planGuestOperationSnapshots(featureApplied, featureCleared);
  assert.equal(featureClearPlan?.[0].operation.value, null);
  const featureClearApplied = applyHostTypedOperation(featureApplied, featureClearPlan[0].operation);
  assert.equal(Object.hasOwn(findNode(featureClearApplied, text.id).node, 'fontFeatures'), false);
});
