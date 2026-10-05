import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, applyTypographyStyle, createComponent, createComponentInstance, createDocument, createNode,
  createTypographyStyle, createVariable, createVariableCollection, bindVariable, findNode,
  parseDocument, serializeDocument, validateDocument } from '../src/model.js';
import { applyAppearance, snapshotAppearance } from '../src/appearance-clipboard.js';
import { planScaleTransform } from '../src/scale-transform.js';
import { convertTextLayerLetterSpacingUnit, convertTextRunLetterSpacingUnit } from '../src/text-run-editing.js';
import { inheritedTextLetterSpacing, resolvedLetterSpacing } from '../src/text-letter-spacing.js';
import { isCollaborationSetPropertyRoot } from '../src/collaboration/set-property-roots.js';

test('new layers default to pixel spacing and legacy missing units remain pixel-compatible', () => {
  const node=createNode('text');
  assert.deepEqual([node.letterSpacing,node.letterSpacingUnit],[0,'pixels']);
  assert.deepEqual(inheritedTextLetterSpacing({letterSpacing:20,letterSpacingUnit:'percent'},{letterSpacing:3}),{
    letterSpacing:3,letterSpacingUnit:'pixels'
  });
  assert.deepEqual(inheritedTextLetterSpacing({letterSpacing:20,letterSpacingUnit:'percent'},{}),{
    letterSpacing:20,letterSpacingUnit:'percent'
  });
  const document=createDocument(); addNode(document,node); delete node.letterSpacingUnit;
  const loaded=parseDocument(serializeDocument(document));
  assert.equal(findNode(loaded,node.id).node.letterSpacingUnit,undefined);
  assert.equal(validateDocument(loaded),true);
  assert.equal(isCollaborationSetPropertyRoot('letterSpacingUnit'),true);
});

test('authored units validate strictly and persist through text styles and component overrides', () => {
  const document=createDocument();
  const source=createNode('text',{text:'source',letterSpacing:8,letterSpacingUnit:'percent'}); addNode(document,source);
  const style=createTypographyStyle(document,source.id,'Percent tracking');
  assert.deepEqual([style.letterSpacing,style.letterSpacingUnit],[8,'percent']);
  const component=createComponent(document,source.id);
  const instance=createComponentInstance(document,component.id);
  const instanceNode=findNode(document,instance.id).node;
  const sourceId=source.componentSourceId || source.id;
  instanceNode.componentOverrides[sourceId]={letterSpacing:12,letterSpacingUnit:'percent'};
  assert.equal(validateDocument(document),true);
  const loaded=parseDocument(serializeDocument(document));
  assert.deepEqual(loaded.components?.length,1);
  assert.equal(validateDocument(loaded),true);

  const unitOnly=structuredClone(loaded);
  findNode(unitOnly,instance.id).node.componentOverrides[sourceId]={letterSpacingUnit:'pixels'};
  assert.equal(validateDocument(unitOnly),true,'a unit-only edit inherits the source scalar');

  const invalid=structuredClone(loaded);
  findNode(invalid,source.id).node.letterSpacingUnit='em';
  assert.throws(()=>validateDocument(invalid),/letter-spacing unit/u);
  const invalidOverride=structuredClone(loaded);
  findNode(invalidOverride,instance.id).node.componentOverrides[sourceId].letterSpacingUnit='em';
  assert.throws(()=>validateDocument(invalidOverride),/letter-spacing unit override/u);
  const invalidRun=structuredClone(loaded);
  const loadedSource=findNode(invalidRun,source.id).node;
  loadedSource.text='range';
  loadedSource.textRuns=[{text:'range',letterSpacing:4,letterSpacingUnit:'em'}];
  assert.throws(()=>validateDocument(invalidRun),/Invalid rich text/u);
  const invalidStyle=structuredClone(loaded);
  invalidStyle.typographyStyles[0].letterSpacingUnit='em';
  assert.throws(()=>validateDocument(invalidStyle),/Invalid or duplicate text style/u);
  const invalidLayer=structuredClone(loaded);
  const rectangle=createNode('rectangle',{letterSpacingUnit:'percent'});
  invalidLayer.pages[0].children.push(rectangle);
  assert.throws(()=>validateDocument(invalidLayer),/letter-spacing unit/u);
});

test('applying a legacy typography style without a unit clears stale percentage units to pixel fallback', () => {
  const document=createDocument();
  const source=createNode('text',{text:'source',letterSpacing:3,letterSpacingUnit:'pixels'}); addNode(document,source);
  const style=createTypographyStyle(document,source.id,'Legacy');
  delete style.letterSpacingUnit;
  const target=createNode('text',{text:'target',letterSpacing:10,letterSpacingUnit:'percent'}); addNode(document,target);
  assert.equal(applyTypographyStyle(document,target.id,style.id),true);
  assert.equal(target.letterSpacing,3);
  assert.equal(target.letterSpacingUnit,undefined);
  assert.deepEqual(inheritedTextLetterSpacing(target,{}),{letterSpacing:3,letterSpacingUnit:'pixels'});
});

test('appearance copy retains authored tracking units and scale leaves percentages unchanged', () => {
  const source=createNode('text',{text:'Source',fontSize:20,letterSpacing:10,letterSpacingUnit:'percent'});
  const target=createNode('text',{text:'Target'});
  const pasted=applyAppearance(target,snapshotAppearance(source)).node;
  assert.deepEqual([pasted.letterSpacing,pasted.letterSpacingUnit],[10,'percent']);
  const pixelTarget=createNode('text',{text:'Pixel',fontSize:20,letterSpacing:2,letterSpacingUnit:'pixels'});
  const plan=planScaleTransform([{node:pasted,ancestors:[]},{node:pixelTarget,ancestors:[]}],2);
  const percentPatch=plan.patches.find(item=>item.id===pasted.id);
  const pixelPatch=plan.patches.find(item=>item.id===pixelTarget.id);
  assert.equal(percentPatch.letterSpacing,undefined);
  assert.equal(pixelPatch.letterSpacing,4);
});

test('scaling resolves numeric spacing variables using their authored units', () => {
  const document=createDocument();
  const collection=createVariableCollection(document,'Spacing');
  const percentage=createVariable(document,collection.id,'Percentage','number',7);
  const pixels=createVariable(document,collection.id,'Pixels','number',4);
  const percentNode=createNode('text',{letterSpacing:7,letterSpacingUnit:'percent'});
  const pixelNode=createNode('text',{letterSpacing:4,letterSpacingUnit:'pixels'});
  addNode(document,percentNode); addNode(document,pixelNode);
  assert.equal(bindVariable(document,percentNode.id,percentage.id,'letterSpacing'),true);
  assert.equal(bindVariable(document,pixelNode.id,pixels.id,'letterSpacing'),true);
  const plan=planScaleTransform([{node:percentNode,ancestors:[]},{node:pixelNode,ancestors:[]}],2, 'center', {
    resolveBoundProperty:(node,property)=>node.id===percentNode.id?7:4
  });
  const percentPatch=plan.patches.find(item=>item.id===percentNode.id);
  const pixelPatch=plan.patches.find(item=>item.id===pixelNode.id);
  assert.equal(percentPatch.letterSpacing,undefined);
  assert.equal(percentPatch.variableBindings,undefined,'percent binding remains live as the font size scales');
  assert.equal(pixelPatch.letterSpacing,8);
  assert.equal(pixelPatch.variableBindings,null,'pixel binding is detached when its authored value scales');
});

test('range unit conversion preserves physical spacing across inherited and explicit runs', () => {
  const base={fontSize:20,letterSpacing:10,letterSpacingUnit:'percent'};
  const runs=[{text:'abcd'},{text:'ef',fontSize:12,letterSpacing:4}];
  const selected=convertTextRunLetterSpacingUnit(runs,1,5,base,'pixels');
  assert.deepEqual(selected,[
    {text:'a'},
    {text:'bcd',letterSpacing:2,letterSpacingUnit:'pixels'},
    {text:'e',fontSize:12,letterSpacing:4,letterSpacingUnit:'pixels'},
    {text:'f',fontSize:12,letterSpacing:4}
  ]);
  const patch=convertTextLayerLetterSpacingUnit({type:'text',letterSpacing:10,letterSpacingUnit:'percent',textRuns:runs},base,'pixels');
  assert.deepEqual([patch.letterSpacing,patch.letterSpacingUnit],[2,'pixels']);
  assert.equal(resolvedLetterSpacing(patch.letterSpacing,20,patch.letterSpacingUnit),2);
  assert.throws(()=>convertTextRunLetterSpacingUnit(runs,0,99,base,'pixels'),/range/u);

  const manyRuns=[{text:'AB',fontSize:20},{text:'CD',fontSize:30},{text:'EFGH',fontSize:40}];
  const before=structuredClone(manyRuns);
  const early=convertTextRunLetterSpacingUnit(manyRuns,0,1,{fontSize:20,letterSpacing:2,letterSpacingUnit:'pixels'},'percent');
  assert.equal(early.map(run=>run.text).join(''),'ABCDEFGH');
  assert.deepEqual(early[1],{...before[0],text:'B'},'the unselected remainder of the first run keeps its style');
  assert.deepEqual(early.slice(2),before.slice(1),'unselected later runs stay unchanged');
  const middle=convertTextRunLetterSpacingUnit(manyRuns,2,3,{fontSize:20,letterSpacing:2,letterSpacingUnit:'pixels'},'percent');
  assert.equal(middle.map(run=>run.text).join(''),'ABCDEFGH');
  assert.deepEqual(middle.filter(run=>run.text==='AB'||run.text==='D'||run.text==='EFGH'),[
    before[0],{...before[1],text:'D'},before[2]
  ]);
});

test('unit conversion accepts synthesized effective font size from its resolver', () => {
  const converted=convertTextRunLetterSpacingUnit([{text:'ab',letterSpacing:10,letterSpacingUnit:'percent',textPosition:'subscript'}],0,2,
    {fontSize:20,letterSpacing:0,letterSpacingUnit:'pixels'},'pixels',{
      resolveStyle:style=>({fontSize:style.textPosition==='subscript'?12:style.fontSize})
    });
  assert.equal(converted[0].letterSpacing,1.2);
  const normal=convertTextRunLetterSpacingUnit([{text:'ab',letterSpacing:10,letterSpacingUnit:'percent'}],0,2,
    {fontSize:20,letterSpacing:0,letterSpacingUnit:'pixels'},'pixels',{
      resolveStyle:style=>({fontSize:style.textPosition==='subscript'?12:style.fontSize})
    });
  assert.equal(normal[0].letterSpacing,2,'the non-positioned control uses its authored font size');
});
