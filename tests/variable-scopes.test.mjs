import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addNode, bindColorVariable, createColorVariable, createDocument, createNode, createVariable, createVariableCollection, parseDocument, serializeDocument, setVariableScopes, validateDocument } from '../src/model.js';
import { colorVariableScope, isValidVariableScopes, normalizeVariableScopes, variablePropertyScope, variableScopeAllows, variableScopeGroups, variableScopesFor } from '../src/variable-scopes.js';

const editorSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const stylesheetSource = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('variable scopes validate by type and preserve Figma special-scope rules', () => {
  assert.deepEqual(normalizeVariableScopes('color', ['SHAPE_FILL', 'ALL_FILLS']), null,
    'ALL_FILLS cannot be combined with individual fill scopes');
  assert.deepEqual(normalizeVariableScopes('color', ['ALL_SCOPES', 'STROKE_COLOR']), null,
    'ALL_SCOPES is exclusive');
  assert.deepEqual(normalizeVariableScopes('number', ['FRAME_FILL']), null,
    'a color-only scope cannot be assigned to a number variable');
  assert.deepEqual(normalizeVariableScopes('boolean', []), null,
    'Figma scopes are available only to number, string, and color variables');
  assert.deepEqual(normalizeVariableScopes('color', ['STROKE_COLOR', 'ALL_FILLS']), ['ALL_FILLS', 'STROKE_COLOR']);
  assert.equal(isValidVariableScopes('string', ['FONT_FAMILY', 'FONT_STYLE', 'TEXT_CONTENT']), true);
  assert.equal(isValidVariableScopes('number', ['WIDTH_HEIGHT', 'GAP', 'OPACITY', 'COLOR_OPACITY']), true);
  assert.equal(variableScopeGroups.color.flatMap(group => group.scopes.map(([scope]) => scope)).includes('EFFECT_COLOR'), true);
});

test('variable scopes filter property pickers without changing binding authorization', () => {
  const scoped = { type: 'color', scopes: ['FRAME_FILL', 'ALL_FILLS'] };
  assert.equal(variableScopeAllows(scoped, 'FRAME_FILL'), false, 'invalid definitions are not accidentally exposed');
  const allFills = { type: 'color', scopes: ['ALL_FILLS'] };
  assert.equal(variableScopeAllows(allFills, 'FRAME_FILL'), true);
  assert.equal(variableScopeAllows(allFills, 'SHAPE_FILL'), true);
  assert.equal(variableScopeAllows(allFills, 'TEXT_FILL'), true);
  assert.equal(variableScopeAllows(allFills, 'STROKE_COLOR'), false);
  assert.equal(variableScopeAllows({ type: 'color', scopes: ['SHAPE_FILL'] }, 'FRAME_FILL'), false);
  assert.equal(variableScopeAllows({ type: 'color' }, 'EFFECT_COLOR'), true, 'older variables default to all scopes');
  assert.equal(variableScopeAllows({ type: 'boolean' }, null), true, 'boolean variables remain unscoped');
  assert.equal(colorVariableScope('fill', { type: 'frame' }), 'FRAME_FILL');
  assert.equal(colorVariableScope('fill', { type: 'rectangle' }), 'SHAPE_FILL');
  assert.equal(colorVariableScope('text', { type: 'text' }), 'TEXT_FILL');
  assert.equal(colorVariableScope('stroke', { type: 'path' }), 'STROKE_COLOR');
  assert.equal(variablePropertyScope('width'), 'WIDTH_HEIGHT');
  assert.equal(variablePropertyScope('autoLayout.padding.left'), 'GAP');
  assert.equal(variablePropertyScope('autoLayout.columnGap'), 'GAP');
  assert.equal(variablePropertyScope('fontSize'), 'FONT_SIZE');
  assert.equal(variablePropertyScope('fontFamily'), 'FONT_FAMILY');
  assert.equal(variablePropertyScope('fontWeight'), 'FONT_WEIGHT');
  assert.equal(variablePropertyScope('fontStyle'), 'FONT_STYLE');
  assert.equal(variablePropertyScope('paragraphSpacing'), 'PARAGRAPH_SPACING');
  assert.equal(variablePropertyScope('firstLineIndent'), 'PARAGRAPH_INDENT');
  assert.equal(variablePropertyScope('text'), 'TEXT_CONTENT');
  assert.equal(variablePropertyScope('x'), null, 'properties with no Figma scope require an All properties token');
});

test('scope changes persist, reject invalid scopes, and never invalidate existing bindings', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Brand');
  const variable = createColorVariable(document, collection.id, 'Surface', '#eeeeee');
  const frame = createNode('frame');
  const shape = createNode('rectangle');
  addNode(document, frame);
  addNode(document, shape, { parentId: frame.id });
  assert.deepEqual(variable.scopes, ['ALL_SCOPES']);
  assert.equal(bindColorVariable(document, shape.id, variable.id, 'fill'), true);
  assert.equal(setVariableScopes(document, variable.id, ['TEXT_FILL']), true);
  assert.equal(variableScopeAllows(variable, 'SHAPE_FILL'), false);
  assert.equal(shape.fillVariableId, variable.id, 'picker scopes must not remove a saved property binding');
  assert.equal(validateDocument(document), true);
  assert.deepEqual(parseDocument(serializeDocument(document)).variables[0].scopes, ['TEXT_FILL']);
  assert.equal(setVariableScopes(document, variable.id, ['FRAME_FILL', 'ALL_SCOPES']), false);
  assert.deepEqual(variable.scopes, ['TEXT_FILL'], 'invalid scope edits leave the previous value unchanged');

  const bool = createVariable(document, collection.id, 'Enabled', 'boolean', true);
  assert.equal(setVariableScopes(document, bool.id, []), false);
  const malformed = structuredClone(document);
  malformed.variables.find(item => item.id === variable.id).scopes = ['UNKNOWN_SCOPE'];
  assert.throws(() => validateDocument(malformed), /Invalid scopes/);

  const legacy = structuredClone(document);
  delete legacy.variables.find(item => item.id === variable.id).scopes;
  assert.equal(variableScopeAllows(legacy.variables.find(item => item.id === variable.id), 'SHAPE_FILL'), true,
    'legacy variables without scope metadata retain their original picker visibility');
});

test('editor pickers use property scopes and expose per-variable scope editing', () => {
  assert.match(editorSource, /variableBindingControl\(node, kind\)[\s\S]*?variableScopeAllows\(variable, scope\)/,
    'color property pickers must filter by fill/text/stroke scope');
  assert.match(editorSource, /variablePropertyBindingControl\(node, property, label\)[\s\S]*?variablePropertyScope\(property\)[\s\S]*?variableScopeAllows\(variable, scope\)/,
    'typed property pickers must filter by their matching Figma scope');
  assert.match(editorSource, /function variableScopesEditorMarkup\(variable,?[^)]*\)[\s\S]*?variableScopeGroups\[variable\.type\][\s\S]*?data-variable-scope=/,
    'number, string, and color variables need an editable scope checklist');
  assert.match(editorSource, /data-variable-scope[\s\S]*?normalizeVariableScopes\(variable\.type, scopes\)[\s\S]*?setVariableScopes\(state\.document, variable\.id, normalized\)/,
    'scope edits must validate, persist, and re-render the variable list');
  assert.match(stylesheetSource, /@media \(max-width: 820px\) and \(pointer: coarse\)[\s\S]*?\.variable-scopes-editor summary \{ min-height: 44px; \}[\s\S]*?\.variable-scope-group label \{ min-height: 44px;/,
    'scope controls need phone-sized hit targets');
  for (const property of ['fontFamily', 'fontWeight', 'fontStyle', 'paragraphSpacing', 'firstLineIndent']) {
    assert.match(editorSource, new RegExp(`variablePropertyBindingControl\\(node, '${property}'`), `${property} needs an inspector variable binding control`);
  }
  assert.match(editorSource, /const sizeProperties = \['text', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'paragraphSpacing', 'firstLineIndent'/,
    'all text-layout variables must trigger auto-sizing when their mode value changes');
  assert.match(editorSource, /boundVariableId && \['text', 'fontFamily', 'fontWeight', 'fontStyle', 'fontSize', 'lineHeight', 'letterSpacing', 'paragraphSpacing', 'firstLineIndent'\]\.includes\(prop\)[\s\S]*?resizeTextLayers/,
    'editing a bound typography property must resize every layer sharing the variable');
});
