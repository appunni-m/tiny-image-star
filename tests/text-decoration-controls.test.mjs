import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createNode, findNode, parseDocument, validateDocument } from '../src/model.js';
import { textDecorationDefaults } from '../src/text-decoration-style.js';
import { applyTextDecorationControlRange, textDecorationControlPatch, textDecorationCss } from '../src/text-decoration-controls.js';
import { applyAppearance, snapshotAppearance } from '../src/appearance-clipboard.js';
import { planScaleTransform } from '../src/scale-transform.js';
import { buildInspectOutput } from '../src/inspect.js';
import { planGuestOperationSnapshots } from '../src/collaboration/guest-operation-planner.js';
import { createHostOperationEngine } from '../src/collaboration/host-operation-engine.js';

const custom = {
  textDecoration: 'underline', textDecorationStyle: 'wavy',
  textDecorationThickness: { unit: 'pixels', value: 2.5 },
  textDecorationOffset: { unit: 'percent', value: -15 },
  textDecorationColor: { type: 'solid', color: '#113355', opacity: .35 },
  textDecorationSkipInk: true
};

test('underline unit changes keep the same physical value, including signed offsets', () => {
  const source = { ...custom, fontSize: 20 };
  const thickness = textDecorationControlPatch(source, 'thicknessUnit', 'percent');
  assert.deepEqual(thickness.value, { unit: 'percent', value: 12.5 });
  assert.deepEqual(textDecorationControlPatch({ ...source, [thickness.property]: thickness.value }, 'thicknessUnit', 'pixels').value,
    source.textDecorationThickness);
  assert.deepEqual(textDecorationControlPatch(source, 'offsetUnit', 'pixels').value, { unit: 'pixels', value: -3 });
  assert.deepEqual(textDecorationControlPatch(source, 'offsetUnit', 'auto').value, { unit: 'auto' });
  assert.equal(source.textDecorationOffset.value, -15, 'UI planning cannot mutate authored settings');
});

test('invalid or incomplete UI values never create an invalid underline mutation', () => {
  for (const value of ['', ' ', 'NaN', 'Infinity', '-1', '100001']) assert.equal(textDecorationControlPatch(custom, 'thicknessValue', value), null);
  for (const value of ['', 'Infinity', '-100001', '100001']) assert.equal(textDecorationControlPatch(custom, 'offsetValue', value), null);
  assert.equal(textDecorationControlPatch(custom, 'skipInk', 'true'), null);
  assert.equal(textDecorationControlPatch(custom, 'color', '#fff'), null);
  assert.equal(textDecorationControlPatch(custom, 'opacity', '101'), null);
  assert.equal(textDecorationControlPatch(custom, 'thicknessUnit', '__proto__'), null);
  assert.equal(textDecorationControlPatch({}, 'thicknessValue', '2'), null, 'Auto must first become a numeric unit');
  assert.equal(textDecorationControlPatch(custom, 'unknown', 'wavy'), null);
});

test('selected color edits retain each run opacity and only split at selection boundaries', () => {
  const runs = [{ text: 'abcd', textDecorationColor: { type: 'solid', color: '#112233', opacity: .2 } },
    { text: 'efgh', textDecorationColor: { type: 'solid', color: '#445566', opacity: .8, visible: false } }];
  const before = structuredClone(runs);
  const result = applyTextDecorationControlRange(runs, 2, 6, { fontSize: 20 }, 'color', '#ABCDEF');
  assert.deepEqual(result.map(run => run.text), ['ab', 'cd', 'ef', 'gh']);
  assert.deepEqual(result[1].textDecorationColor, { type: 'solid', color: '#abcdef', opacity: .2 });
  assert.deepEqual(result[2].textDecorationColor, { type: 'solid', color: '#abcdef', opacity: .8, visible: false });
  assert.deepEqual(runs, before);
  result[0].textDecorationColor.opacity = 1;
  assert.deepEqual(runs, before, 'results cannot retain mutable nested aliases to the editor source');
});

test('range unit conversion follows each run font size and preserves other overrides', () => {
  const runs = [{ text: 'abc', fontSize: 10, textDecorationThickness: { unit: 'pixels', value: 2 } },
    { text: 'def', fontSize: 20, textDecorationThickness: { unit: 'pixels', value: 2 }, textDecorationSkipInk: true }];
  const result = applyTextDecorationControlRange(runs, 0, 6, { fontSize: 16 }, 'thicknessUnit', 'percent');
  assert.deepEqual(result.map(run => run.textDecorationThickness), [{ unit: 'percent', value: 20 }, { unit: 'percent', value: 10 }]);
  assert.equal(result[1].textDecorationSkipInk, true);
  assert.equal(applyTextDecorationControlRange(runs, 0, 7, {}, 'style', 'solid'), null);
});

test('matching range values merge despite object key order, and reset retains an explicit Auto override', () => {
  const runs = [{ text: 'a', textDecorationColor: { type: 'solid', color: '#113355', opacity: .5 } },
    { text: 'b', textDecorationColor: { opacity: .5, color: '#113355', type: 'solid' } }];
  assert.equal(applyTextDecorationControlRange(runs, 0, 2, {}, 'skipInk', false).length, 1);
  const result = applyTextDecorationControlRange(runs, 0, 2, { ...custom }, 'colorMode', 'auto');
  assert.deepEqual(result, [{ text: 'ab', textDecorationColor: 'auto' }]);
});

test('appearance paste retains custom underline settings and a plain source resets custom target settings', () => {
  const source = createNode('text', { ...custom, text: 'source' });
  const target = createNode('text', { text: 'target', textRuns: [{ text: 'target', fontWeight: 700 }] });
  const result = applyAppearance(target, snapshotAppearance(source));
  assert.deepEqual(textDecorationDefaults(result.node), textDecorationDefaults(source));
  assert.equal(result.node.text, 'target'); assert.deepEqual(result.node.textRuns, target.textRuns);
  const reset = applyAppearance(result.node, snapshotAppearance(createNode('text'))).node;
  assert.deepEqual(textDecorationDefaults(reset), textDecorationDefaults({}));
  const forged = snapshotAppearance(source); forged.textStyle.textDecorationColor.opacity = Infinity;
  assert.throws(() => applyAppearance(target, forged), /underline settings/);
});

test('Scale changes pixel underline metrics exactly once and leaves relative units and colors intact', () => {
  const source = createNode('text', { ...custom, text: 'abcd', textRuns: [{ text: 'ab', fontSize: 12,
    textDecorationOffset: { unit: 'pixels', value: -3 } }, { text: 'cd', fontSize: 18,
    textDecorationThickness: { unit: 'percent', value: 10 } }] });
  const before = structuredClone(source);
  const patch = planScaleTransform([{ node: source, ancestors: [] }], 2).patches[0];
  assert.deepEqual(patch.textDecorationThickness, { unit: 'pixels', value: 5 });
  assert.equal(patch.textDecorationOffset, undefined, 'percentage offset scales with the font');
  assert.deepEqual(patch.textRuns[0].textDecorationOffset, { unit: 'pixels', value: -6 });
  assert.deepEqual(patch.textRuns[1].textDecorationThickness, { unit: 'percent', value: 10 });
  assert.deepEqual(source, before);
  source.textDecorationThickness = { unit: 'pixels', value: 60_000 };
  assert.throws(() => planScaleTransform([{ node: source, ancestors: [] }], 2), /100,000/);
});

test('Inspect exposes exact stored underline settings and actionable CSS units and alpha', () => {
  const document = createDocument(); const node = createNode('text', custom); document.pages[0].children.push(node);
  const output = buildInspectOutput(document, [findNode(document, node.id)]);
  assert.deepEqual(output.layers[0].typography.textDecorationThickness, custom.textDecorationThickness);
  assert.deepEqual(output.layers[0].typography.textDecorationColor, custom.textDecorationColor);
  assert.match(output.css, /text-decoration-style: wavy;/);
  assert.match(output.css, /text-decoration-thickness: 2.5px;/);
  assert.match(output.css, /text-underline-offset: -0.15em;/);
  assert.match(output.css, /text-decoration-color: rgba\(17, 51, 85, 0.35\);/);
  assert.match(output.css, /text-decoration-skip-ink: auto;/);
  assert.equal(textDecorationCss(custom, { zoom: 2 }).textDecorationThickness, '5px');
  assert.deepEqual(textDecorationCss({ ...custom, textDecoration: 'line-through' }), {});
});

test('guest underline edits reach the persisted host snapshot through validated property operations', async () => {
  const before = createDocument(); const node = createNode('text', { text: 'Shared' }); before.pages[0].children.push(node);
  const after = structuredClone(before); Object.assign(findNode(after, node.id).node, custom); validateDocument(after);
  const plan = planGuestOperationSnapshots(before, after);
  assert.ok(plan.length >= 5, 'each saved setting must be represented in the operation stream');
  const committed = []; const canonical = parseDocument(JSON.parse(JSON.stringify(before)));
  const engine = createHostOperationEngine({ designId: before.id, sessionId: 'session', hostActorId: 'host',
    guestActorIds: ['guest'], snapshot: canonical, revision: 0, headHash: 'a'.repeat(64),
    commit: async input => { committed.push(input.snapshot); return { headHash: input.revision.toString(16).padStart(64, '0') }; } });
  for (const [index, { operation, snapshot }] of plan.entries()) {
    assert.equal(operation.type, 'SetProperty');
    const response = await engine.apply({ v: 2, kind: 'OPERATION', designId: before.id, sessionId: 'session', actorId: 'guest',
      operation: { ...operation, opId: `underline-${index}`, baseRevision: index } });
    assert.equal(response.kind, 'ACK', JSON.stringify(response));
    assert.deepEqual(committed[index], snapshot);
  }
  assert.deepEqual(engine.getSnapshot(), parseDocument(JSON.parse(JSON.stringify(after))));
});
