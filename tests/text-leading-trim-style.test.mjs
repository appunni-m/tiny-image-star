import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, applyTypographyStyle, createComponent, createComponentInstance, createDocument,
  createNode, createTypographyStyle, findNode, parseDocument, serializeDocument, syncComponentInstances, validateDocument } from '../src/model.js';
import { isValidLeadingTrim } from '../src/text-leading-trim-style.js';
import { applyAppearance, snapshotAppearance } from '../src/appearance-clipboard.js';
import { isCollaborationSetPropertyRoot } from '../src/collaboration/set-property-roots.js';
import { prepareOutlineStroke, applyOutlineStroke } from '../src/outline-stroke.js';

test('leading trim accepts only the exact canonical object shape', () => {
  assert.equal(isValidLeadingTrim({type:'NONE'}),true);
  assert.equal(isValidLeadingTrim({type:'CAP_HEIGHT'}),true);
  for (const value of [undefined,null,'CAP_HEIGHT',{},[],{type:'cap-height'},{type:'NONE',extra:true},{type:'OTHER'}]) {
    assert.equal(isValidLeadingTrim(value),false,JSON.stringify(value));
  }
  assert.equal(isCollaborationSetPropertyRoot('leadingTrim'),true);
});

test('leading trim persists through layers, rich runs, typography styles, component overrides, and serialization', () => {
  const document=createDocument();
  const master=createNode('frame',{children:[createNode('text',{text:'AB',leadingTrim:{type:'CAP_HEIGHT'},
    textRuns:[{text:'A',leadingTrim:{type:'NONE'}},{text:'B',leadingTrim:{type:'CAP_HEIGHT'}}]})]});
  addNode(document,master); const source=master.children[0];
  const style=createTypographyStyle(document,source.id,'Trimmed');
  const component=createComponent(document,master.id); const instance=createComponentInstance(document,component.id);
  const instanceNode=findNode(document,instance.id).node;
  instanceNode.componentOverrides[source.id]={leadingTrim:{type:'NONE'},
    textRuns:[{text:'A',leadingTrim:{type:'CAP_HEIGHT'}},{text:'B'}]};
  syncComponentInstances(document,component.id);
  assert.equal(validateDocument(document),true);
  const restored=parseDocument(serializeDocument(document));
  const restoredInstance=findNode(restored,instance.id).node.children[0];
  assert.deepEqual(restoredInstance.leadingTrim,{type:'NONE'});
  assert.deepEqual(restoredInstance.textRuns,[{text:'A',leadingTrim:{type:'CAP_HEIGHT'}},{text:'B'}]);
  assert.deepEqual(restored.typographyStyles.find(value=>value.id===style.id).leadingTrim,{type:'CAP_HEIGHT'});
  assert.equal(restored.components[0].id,component.id);

  const invalidLayer=structuredClone(document); findNode(invalidLayer,source.id).node.leadingTrim={type:'NONE',extra:1};
  assert.throws(()=>validateDocument(invalidLayer),/Invalid text leading trim/u);
  const invalidRun=structuredClone(document); findNode(invalidRun,source.id).node.textRuns[0].leadingTrim='CAP_HEIGHT';
  assert.throws(()=>validateDocument(invalidRun),/Invalid rich text runs/u);
  const invalidStyle=structuredClone(document); invalidStyle.typographyStyles.find(value=>value.id===style.id).leadingTrim={type:'OTHER'};
  assert.throws(()=>validateDocument(invalidStyle),/Invalid or duplicate text style/u);
  const invalid=structuredClone(document); const invalidInstance=findNode(invalid,instance.id).node;
  invalidInstance.componentOverrides[source.id].leadingTrim={type:'NONE',ignored:true};
  assert.throws(()=>validateDocument(invalid),/component text leading trim override/u);
});

test('typography styles and appearance from older sources clear stale leading trim', () => {
  const document=createDocument(); const target=createNode('text',{text:'Target',leadingTrim:{type:'CAP_HEIGHT'}}); addNode(document,target);
  document.typographyStyles.push({id:'old',name:'Old',fontFamily:'Arial',fontSize:20,fontWeight:400,fontStyle:'normal',
    lineHeight:1.25,letterSpacing:0});
  assert.equal(applyTypographyStyle(document,target.id,'old'),true);
  assert.equal(target.leadingTrim,undefined);

  target.leadingTrim={type:'CAP_HEIGHT'};
  const snapshot=snapshotAppearance({type:'text',opacity:1,blendMode:'normal',text:'Legacy'});
  assert.deepEqual(snapshot.textStyle.leadingTrim,{type:'NONE'});
  const pasted=applyAppearance(target,snapshot).node;
  assert.deepEqual(pasted.leadingTrim,{type:'NONE'});
});

test('Outline Stroke removes semantic leading trim from the generated vector root', async () => {
  const document=createDocument(); const node=createNode('text',{text:'A',width:10,height:10,leadingTrim:{type:'CAP_HEIGHT'}}); addNode(document,node);
  const shape={fillGroups:[{fillRule:'nonzero',contours:[{closed:true,start:{x:1,y:1},commands:[
    {type:'line',start:{x:1,y:1},end:{x:8,y:1}},{type:'line',start:{x:8,y:1},end:{x:8,y:8}},
    {type:'line',start:{x:8,y:8},end:{x:1,y:8}},{type:'line',start:{x:1,y:8},end:{x:1,y:1}}
  ]}]}]};
  const result={commands:new Float32Array([0,0,0,1,9,0,1,9,9,1,0,9,5]),fillRule:'nonzero',bounds:{left:0,top:0,right:9,bottom:9}};
  const plan=await prepareOutlineStroke(document,[node.id],{getTextOutline:async()=>({width:10,height:10,geometry:shape,glyphGeometry:shape,
    glyphs:[{geometry:shape,paint:{color:'#000000',opacity:1}}],decorations:[]}),outline:async()=>result});
  applyOutlineStroke(document,plan);
  assert.equal(node.leadingTrim,undefined);
  assert.ok(node.children.every(child=>child.leadingTrim===undefined));
  assert.equal(validateDocument(document),true);
});
