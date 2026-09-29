import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialProject, createNode, descendants, validateProject } from '../src/model.js';

test('new design starts with a local page and a centered desktop frame', () => {
  const project = createInitialProject();
  assert.equal(project.pages.length, 1);
  assert.equal(project.pages[0].nodes[0].type, 'frame');
  assert.equal(project.pages[0].nodes[0].w, 1440);
  assert.equal(validateProject(project), true);
});

test('node creation applies typed defaults and caller overrides', () => {
  const rect = createNode('rect', { x: 12, fill: '#123456' });
  assert.equal(rect.x, 12);
  assert.equal(rect.fill, '#123456');
  assert.equal(rect.w, 240);
  assert.equal(createNode('rect', { name: undefined }).name, 'Rectangle');
  assert.throws(() => createNode('unsupported'), TypeError);
});

test('project validation rejects duplicate ids, missing active pages and invalid geometry', () => {
  const project = createInitialProject();
  const duplicate = structuredClone(project);
  duplicate.pages[0].nodes.push({ ...duplicate.pages[0].nodes[0] });
  assert.equal(validateProject(duplicate), false);
  const badSize = structuredClone(project);
  badSize.pages[0].nodes[0].w = -1;
  assert.equal(validateProject(badSize), false);
  const missingPage = structuredClone(project);
  missingPage.activePageId = 'missing';
  assert.equal(validateProject(missingPage), false);
});

test('descendants returns the nested subtree without including its root', () => {
  const nodes = [{ id: 'a', parentId: null }, { id: 'b', parentId: 'a' }, { id: 'c', parentId: 'b' }, { id: 'd', parentId: null }];
  assert.deepEqual(descendants(nodes, 'a').map(node => node.id).sort(), ['b', 'c']);
});
