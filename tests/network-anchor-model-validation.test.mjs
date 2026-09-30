import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, createDocument, createNode, parseDocument, serializeDocument, validateDocument } from '../src/model.js';

function networkDocument() {
  const document = createDocument();
  addNode(document, createNode('network', {
    vertices: [
      { id: 'v1', x: 0, y: 0 },
      { id: 'v2', x: 1, y: 1, mode: 'smooth' }
    ],
    edges: [{ id: 'e1', from: 'v1', to: 'v2' }],
    faces: []
  }));
  return document;
}

test('network vertex anchor modes round-trip and malformed persisted modes are rejected', () => {
  const document = networkDocument();
  assert.equal(validateDocument(document), true);
  const restored = parseDocument(serializeDocument(document));
  assert.equal(restored.pages[0].children[0].vertices[0].mode, undefined,
    'missing mode remains the legacy Corner representation');
  assert.equal(restored.pages[0].children[0].vertices[1].mode, 'smooth');

  for (const mode of ['automatic', null, 1]) {
    const invalid = structuredClone(restored);
    invalid.pages[0].children[0].vertices[1].mode = mode;
    assert.throws(() => validateDocument(invalid), /Invalid vector network/);
  }
});
