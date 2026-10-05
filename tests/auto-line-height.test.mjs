import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, applyTypographyStyle, createDocument, createNode, createTypographyStyle,
  bindVariable, createVariable, createVariableCollection, findNode, parseDocument,
  serializeDocument, validateDocument } from '../src/model.js';
import { buildInspectOutput } from '../src/inspect.js';

test('new text layers default to Auto while a bare explicit lineHeight remains the historical ratio', () => {
  const automatic=createNode('text');
  assert.equal(automatic.lineHeight,1);
  assert.equal(automatic.lineHeightUnit,'auto');
  assert.equal(createNode('text',{lineHeight:1.4}).lineHeightUnit,'ratio');
  assert.equal(createNode('text',{lineHeight:20,lineHeightUnit:'pixels'}).lineHeightUnit,'pixels');
  assert.equal(createNode('text',{lineHeight:135,lineHeightUnit:'percent'}).lineHeightUnit,'percent');
  const document=createDocument(); addNode(document,automatic);
  assert.equal(validateDocument(document),true);
});

test('loading old documents with no lineHeightUnit preserves ratio interpretation', () => {
  const document=createDocument(); const oldText=createNode('text',{text:'Old',lineHeight:1.25});
  delete oldText.lineHeightUnit; addNode(document,oldText);
  const loaded=parseDocument(serializeDocument(document)); const text=findNode(loaded,oldText.id).node;
  assert.equal(text.lineHeight,1.25);
  assert.equal(text.lineHeightUnit,undefined,'loading does not migrate an old authored ratio to Auto');
  assert.equal(validateDocument(loaded),true);
});

test('legacy Auto line-height quantities remain valid and survive save/load', () => {
  const document=createDocument();
  const text=createNode('text',{text:'Legacy Auto',lineHeight:1.25,lineHeightUnit:'auto'});
  addNode(document,text);
  const loaded=parseDocument(serializeDocument(document));
  assert.deepEqual([findNode(loaded,text.id).node.lineHeight,findNode(loaded,text.id).node.lineHeightUnit],[1.25,'auto']);
  assert.equal(validateDocument(loaded),true);
});

test('binding a numeric line-height to a new Auto text layer records ratio semantics', () => {
  const document=createDocument();
  const collection=createVariableCollection(document,'Type');
  const leading=createVariable(document,collection.id,'Leading','number',1.35);
  const text=createNode('text'); addNode(document,text);
  assert.equal(bindVariable(document,text.id,leading.id,'lineHeight'),true);
  assert.equal(text.lineHeightUnit,'ratio');
  assert.equal(validateDocument(document),true);
});

test('Auto and explicit line-height units survive styles, components, serialization, and Inspector CSS', () => {
  const document=createDocument(); const automatic=createNode('text',{text:'Auto\nline'}); addNode(document,automatic);
  const style=createTypographyStyle(document,automatic.id,'Auto');
  assert.deepEqual([style.lineHeight,style.lineHeightUnit],[1,'auto']);
  const target=createNode('text',{text:'Target',lineHeight:28,lineHeightUnit:'pixels'}); addNode(document,target);
  applyTypographyStyle(document,target.id,style.id);
  assert.deepEqual([target.lineHeight,target.lineHeightUnit],[1,'auto']);
  const restored=parseDocument(serializeDocument(document));
  assert.deepEqual([findNode(restored,automatic.id).node.lineHeight,findNode(restored,automatic.id).node.lineHeightUnit],[1,'auto']);
  assert.deepEqual([findNode(restored,target.id).node.lineHeight,findNode(restored,target.id).node.lineHeightUnit],[1,'auto']);

  const output=buildInspectOutput(restored,[findNode(restored,automatic.id)]);
  assert.match(output.css,/line-height: normal;/u);
  assert.doesNotMatch(output.css,/line-height: 28\.8px;|min-height: 28\.8px;/u);
  assert.doesNotMatch(output.css,/__paragraph \{[^}]*min-height:/su,'Auto paragraphs should use native CSS font metrics without an invented metric');
  assert.deepEqual([output.layers[0].typography.lineHeight,output.layers[0].typography.lineHeightUnit],[1,'auto']);

  const restoredAuto=findNode(restored,automatic.id).node;
  restoredAuto.lineHeight=24; restoredAuto.lineHeightUnit='pixels';
  const px=buildInspectOutput(restored,[findNode(restored,automatic.id)]);
  assert.match(px.css,/line-height: 24px;/u);
  assert.equal(px.layers[0].typography.lineHeightUnit,'pixels');
});
