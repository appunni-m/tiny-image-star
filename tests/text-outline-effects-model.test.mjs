import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode, cloneDocument, createComponent, createComponentInstance, createDocument, createFillLayer, createNode,
  duplicateNode, findNode, validateDocument
} from '../src/model.js';

function stagedGroup() {
  const glyph=createNode('path',{name:'Glyph',width:20,height:20,closed:true,
    points:[{x:.1,y:.1},{x:.8,y:.1},{x:.8,y:.8},{x:.1,y:.8}],fill:'#112233',stroke:null,strokeWidth:0});
  const stroke=createNode('path',{name:'Outline stroke',width:20,height:20,closed:true,
    points:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],fill:'#445566',stroke:null,strokeWidth:0,effectPaintPhase:'stroke'});
  return createNode('group',{name:'Outlined text',width:20,height:20,effectPaintMode:'staged',effectFillMode:'legacy',children:[glyph,stroke]});
}

test('staged effect markers validate, serialize, duplicate and survive component source/instance overrides', () => {
  const document=createDocument(); document.pages[0].children=[];
  const group=stagedGroup(); addNode(document,group);
  validateDocument(document);
  const encoded=JSON.parse(JSON.stringify(document));
  validateDocument(encoded);
  assert.equal(findNode(encoded,group.id).node.effectPaintMode,'staged');
  assert.equal(findNode(encoded,group.id).node.effectFillMode,'legacy');
  assert.equal(findNode(encoded,group.children[1].id).node.effectPaintPhase,'stroke');
  assert.equal(findNode(cloneDocument(document),group.id).node.children[1].effectPaintPhase,'stroke');

  const copy=duplicateNode(document,group.id);
  assert.equal(copy.effectPaintMode,'staged'); assert.equal(copy.effectFillMode,'legacy');
  assert.equal(copy.children[1].effectPaintPhase,'stroke');
  validateDocument(document);

  const component=createComponent(document,group.id,'Outlined text component');
  const instance=createComponentInstance(document,component.id);
  const instanceRoot=findNode(document,instance.id).node;
  const sourceStroke=group.children[1];
  instanceRoot.componentOverrides ||= {};
  instanceRoot.componentOverrides[group.id]={effectPaintMode:'staged',effectFillMode:'legacy'};
  instanceRoot.componentOverrides[sourceStroke.id]={effectPaintPhase:'stroke'};
  validateDocument(document);
  assert.ok(instanceRoot.children.some(child=>child.effectPaintPhase==='stroke'));

  const noneRoot=createNode('group',{width:10,height:10,effectPaintMode:'staged',effectFillMode:'none',children:[createNode('path',{closed:true,
    points:[{x:.1,y:.1},{x:.9,y:.1},{x:.9,y:.9}],fills:[],fill:'transparent',stroke:null,strokeWidth:0})]});
  addNode(document,noneRoot); validateDocument(document);
  noneRoot.children[0].fills=[createFillLayer('solid',{color:'#ff0000'})];
  validateDocument(document);
  assert.equal(noneRoot.effectFillMode,'none','paint edits remain live; the marker does not snapshot or freeze original no-fill state');
});

test('invalid staged effect markers fail closed without constraining moved stroke children', () => {
  const document=createDocument(); document.pages[0].children=[];
  const group=stagedGroup(); addNode(document,group); validateDocument(document);
  const moved=group.children.pop(); document.pages[0].children.push(moved);
  validateDocument(document,'a marked child outside the staged scope is ordinary editable content');
  moved.effectPaintPhase='fill';
  assert.throws(()=>validateDocument(document),/staged effect paint phase/);
  moved.effectPaintPhase='stroke';
  group.effectFillMode='opaque';
  assert.throws(()=>validateDocument(document),/staged effect fill mode/);
  group.effectFillMode='legacy'; group.effectPaintMode='legacy';
  assert.throws(()=>validateDocument(document),/staged effect paint mode/);
});
