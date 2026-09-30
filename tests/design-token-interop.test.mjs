import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DesignTokenInteropError, exportDtcgTokens, importDtcgTokens, mergeDtcgTokens, stringifyDtcgTokens,
  TINY_IMAGE_STAR_DTCG_EXTENSION
} from '../src/design-token-interop.js';
import { createColorVariable, createDocument, createVariableCollection, validateDocument } from '../src/model.js';

function makeVariableDocument() {
  const collections = [
    {
      id: 'collection-brand', name: 'Brand', defaultModeId: 'mode-light',
      modes: [{ id: 'mode-light', name: 'Light' }, { id: 'mode-dark', name: 'Dark' }]
    },
    {
      id: 'collection-layout', name: 'Layout', defaultModeId: 'mode-layout',
      modes: [{ id: 'mode-layout', name: 'Default' }]
    }
  ];
  const variables = [
    { id: 'var-brand-base', collectionId: 'collection-brand', name: 'color.base', type: 'color', valuesByMode: { 'mode-light': '#336699', 'mode-dark': '#111827' } },
    { id: 'var-brand-accent', collectionId: 'collection-brand', name: 'color.accent', type: 'color', valuesByMode: { 'mode-light': '#336699', 'mode-dark': '#0ea5e9' } },
    { id: 'var-brand-primary', collectionId: 'collection-brand', name: 'color.primary', type: 'color', valuesByMode: { 'mode-light': '#336699', 'mode-dark': '#0ea5e9' }, aliasesByMode: { 'mode-light': 'var-brand-base', 'mode-dark': 'var-brand-accent' } },
    { id: 'var-brand-title', collectionId: 'collection-brand', name: 'copy.title', type: 'string', valuesByMode: { 'mode-light': 'Welcome', 'mode-dark': 'Welcome back' } },
    { id: 'var-brand-enabled', collectionId: 'collection-brand', name: 'feature.enabled', type: 'boolean', valuesByMode: { 'mode-light': true, 'mode-dark': false } },
    { id: 'var-layout-gap', collectionId: 'collection-layout', name: 'space.gap', type: 'number', valuesByMode: { 'mode-layout': 12.5 } },
    { id: 'var-layout-semantic', collectionId: 'collection-layout', name: 'space.semantic', type: 'number', valuesByMode: { 'mode-layout': 12.5 }, aliasesByMode: { 'mode-layout': 'var-layout-gap' } }
  ];
  return { variableCollections: collections, variables };
}

function code(error, expected) {
  assert.ok(error instanceof DesignTokenInteropError, error?.stack || String(error));
  assert.equal(error.code, expected);
  return true;
}

test('DTCG round-trip preserves collections, all modes, primitive types, and per-mode aliases', () => {
  const source = makeVariableDocument();
  const exported = exportDtcgTokens(source);
  const json = stringifyDtcgTokens(source);
  const imported = importDtcgTokens(json);

  assert.deepEqual(imported.variableCollections, source.variableCollections);
  assert.deepEqual(imported.variables, source.variables);
  assert.equal(exported.Brand.color.primary.$ref, '#/Brand/color/base/$value');
  assert.equal(exported.Brand.feature.enabled.$type, 'string', 'DTCG has no standard boolean token type');
  assert.equal(exported.Brand.feature.enabled.$value, 'true');
  assert.equal(exported.$extensions[TINY_IMAGE_STAR_DTCG_EXTENSION].version, 1);
  assert.match(json, /"colorSpace": "srgb"/);
  assert.doesNotMatch(json, /https?:\/\//, 'the adapter does not upload or reference remote data');
});

test('plain DTCG groups flatten into one collection and support inherited types and both token alias syntaxes', () => {
  const input = {
    palette: {
      $type: 'color',
      blue: { $value: { colorSpace: 'srgb', components: [0, 0.4, 0.8], hex: '#0066cc' } },
      deep: { blue: { $value: { colorSpace: 'srgb', components: [0, 0.4, 0.8], hex: '#0066cc' } } }
    },
    semantic: {
      primary: { $type: 'color', $value: '{palette.blue}' },
      secondary: { $type: 'color', $ref: '#/palette/deep/blue/$value' }
    },
    content: { title: { $type: 'string', $value: 'Welcome' } },
    metrics: { ratio: { $type: 'number', $value: 1.25 } }
  };
  const result = importDtcgTokens(input, { collectionName: 'Imported' });
  assert.equal(result.variableCollections[0].name, 'Imported');
  const variables = Object.fromEntries(result.variables.map(variable => [variable.name, variable]));
  assert.equal(variables['palette.blue'].type, 'color');
  assert.equal(variables['palette.blue'].valuesByMode[result.variableCollections[0].defaultModeId], '#0066cc');
  assert.equal(variables['semantic.primary'].aliasesByMode[result.variableCollections[0].defaultModeId], variables['palette.blue'].id);
  assert.equal(variables['semantic.secondary'].aliasesByMode[result.variableCollections[0].defaultModeId], variables['palette.deep.blue'].id);
  assert.equal(variables['content.title'].type, 'string');
  assert.equal(variables['metrics.ratio'].type, 'number');
  assert.equal(result.warnings.length, 0);
});

test('invalid JSON, unsupported types, lossy colors, and unsupported DTCG group inheritance fail explicitly', () => {
  assert.throws(() => importDtcgTokens('{not json'), error => code(error, 'INVALID_JSON'));
  assert.throws(() => importDtcgTokens({ x: { $type: 'dimension', $value: { value: 8, unit: 'px' } } }), error => code(error, 'UNSUPPORTED_TYPE'));
  assert.throws(() => importDtcgTokens({ x: { $type: 'boolean', $value: true } }), error => code(error, 'UNSUPPORTED_TYPE'));
  assert.throws(() => importDtcgTokens({ x: { $type: 'color', $value: { colorSpace: 'display-p3', components: [1, 0, 0], hex: '#ff0000' } } }), error => code(error, 'UNSUPPORTED_COLOR_SPACE'));
  assert.throws(() => importDtcgTokens({ x: { $type: 'color', $value: { colorSpace: 'srgb', components: [1, 0, 0], alpha: 0.5 } } }), error => code(error, 'UNSUPPORTED_ALPHA'));
  assert.throws(() => importDtcgTokens({ group: { $extends: '{base}', token: { $type: 'number', $value: 1 } } }), error => code(error, 'UNSUPPORTED_GROUP_EXTENSION'));
});

test('missing, cyclic, malformed, and type-incompatible aliases are rejected', () => {
  assert.throws(() => importDtcgTokens({ a: { $type: 'number', $value: '{missing}' } }), error => code(error, 'UNRESOLVED_REFERENCE'));
  assert.throws(() => importDtcgTokens({ a: { $type: 'number', $value: '{b}' }, b: { $type: 'number', $value: '{a}' } }), error => code(error, 'ALIAS_CYCLE'));
  assert.throws(() => importDtcgTokens({ a: { $type: 'number', $value: '{b}' }, b: { $type: 'string', $value: 'x' } }), error => code(error, 'TYPE_MISMATCH'));
  assert.throws(() => importDtcgTokens({ a: { $type: 'string', $value: '{not.valid' } }), error => code(error, 'INVALID_REFERENCE'));
  assert.throws(() => importDtcgTokens({ a: { $type: 'number', $ref: 'https://example.test/tokens.json#/x/$value' } }), error => code(error, 'UNSUPPORTED_REFERENCE'));
});

test('DTCG path validation rejects invalid names and preserves imported input objects', () => {
  const source = { color: { $type: 'color', ink: { $value: { colorSpace: 'srgb', components: [0, 0, 0], hex: '#000000' } } } };
  const before = structuredClone(source);
  const imported = importDtcgTokens(source);
  imported.variableCollections[0].name = 'Changed locally';
  assert.deepEqual(source, before, 'import creates independent local data');
  assert.throws(() => importDtcgTokens({ 'bad.name': { $type: 'number', $value: 1 } }), error => code(error, 'UNSUPPORTED_NAME'));
  assert.throws(() => importDtcgTokens(source, { collectionName: 'bad.name' }), error => code(error, 'UNSUPPORTED_NAME'));
  assert.throws(() => importDtcgTokens({ group: { $type: null, child: { $type: 'number', $value: 1 } } }), error => code(error, 'INVALID_TYPE'));
});

test('ambiguous name paths, token/group collisions, and malformed local extension fail safely', () => {
  assert.throws(() => importDtcgTokens({ 'Palette': { x: { $type: 'number', $value: 1 } }, 'palette': { x: { $type: 'number', $value: 2 } } }), error => code(error, 'AMBIGUOUS_VARIABLE_NAME'));
  assert.throws(() => importDtcgTokens({ token: { $type: 'number', $value: 1, nested: { $type: 'number', $value: 2 } } }), error => code(error, 'AMBIGUOUS_TOKEN_GROUP'));
  const malformed = exportDtcgTokens(makeVariableDocument());
  malformed.$extensions[TINY_IMAGE_STAR_DTCG_EXTENSION].variables[0].valuesByMode['mode-dark'] = 'not a color';
  assert.throws(() => importDtcgTokens(malformed), error => code(error, 'INVALID_LOCAL_VALUE'));
});

test('export refuses local names and values that cannot map to valid DTCG paths or values', () => {
  const invalidName = makeVariableDocument();
  invalidName.variables[0].name = 'color.primary.bad';
  assert.throws(() => exportDtcgTokens(invalidName), error => code(error, 'AMBIGUOUS_VARIABLE_PATH'));

  const braces = makeVariableDocument();
  braces.variables[3].valuesByMode['mode-light'] = '{a.reference}';
  assert.throws(() => exportDtcgTokens(braces), error => code(error, 'AMBIGUOUS_STRING'));

  const invalidCollection = makeVariableDocument();
  invalidCollection.variableCollections[0].name = 'Brand.colors';
  assert.throws(() => exportDtcgTokens(invalidCollection), error => code(error, 'UNSUPPORTED_NAME'));
});

test('merging imported tokens remaps identities and aliases without mutating either input', () => {
  const importedSource = makeVariableDocument();
  const imported = importDtcgTokens(stringifyDtcgTokens(importedSource));
  const target = createDocument();
  const localCollection = createVariableCollection(target, 'Local');
  localCollection.id = 'collection-brand';
  localCollection.modes[0].id = 'mode-light';
  localCollection.defaultModeId = 'mode-light';
  const localVariable = createColorVariable(target, localCollection.id, 'local.color');
  localVariable.id = 'var-brand-base';
  const targetBefore = structuredClone(target);
  const importedBefore = structuredClone(imported);

  const result = mergeDtcgTokens(target, imported);
  const merged = result.document;
  const mergedBrand = merged.variableCollections.find(collection => collection.name === 'Brand');
  const mergedBase = merged.variables.find(variable => variable.name === 'color.base' && variable.collectionId === mergedBrand.id);
  const mergedPrimary = merged.variables.find(variable => variable.name === 'color.primary' && variable.collectionId === mergedBrand.id);
  const sourceBase = imported.variables.find(variable => variable.name === 'color.base');
  const sourceBrand = imported.variableCollections.find(collection => collection.name === 'Brand');

  assert.notEqual(mergedBrand.id, sourceBrand.id, 'collection IDs should not overwrite existing local identities');
  assert.notEqual(mergedBrand.modes[0].id, sourceBrand.modes[0].id, 'mode IDs should be remapped too');
  assert.notEqual(mergedBase.id, sourceBase.id, 'variable IDs should not overwrite existing local identities');
  assert.equal(mergedPrimary.aliasesByMode[mergedBrand.modes[0].id], mergedBase.id, 'aliases should point to the remapped imported variable');
  assert.equal(merged.variableCollections.length, targetBefore.variableCollections.length + importedBefore.variableCollections.length);
  assert.equal(target.variableCollections[0].name, targetBefore.variableCollections[0].name, 'the original document remains unchanged');
  assert.equal(imported.variableCollections[0].id, importedBefore.variableCollections[0].id, 'the parsed import remains unchanged');
  assert.deepEqual(result.warnings, imported.warnings);
  assert.equal(validateDocument(merged), true);
});

test('merging rejects collection-name conflicts atomically', () => {
  const target = createDocument();
  const existing = createVariableCollection(target, 'Brand');
  const imported = importDtcgTokens(stringifyDtcgTokens(makeVariableDocument()));
  const before = structuredClone(target);
  assert.throws(() => mergeDtcgTokens(target, imported), error => code(error, 'COLLECTION_NAME_CONFLICT'));
  assert.deepEqual(target, before, 'failed imports do not partially mutate the current design');
  assert.throws(() => mergeDtcgTokens(target, {}), error => code(error, 'INVALID_MERGE_INPUT'));
  assert.ok(existing.id);
});
