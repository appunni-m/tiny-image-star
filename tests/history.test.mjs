import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from '../src/model.js';
import { History } from '../src/history.js';

test('history transactions leave stacks untouched until commit and preserve undo/redo on cancel', () => {
  const history = new History();
  const document = createDocument();
  const originalName = document.name;
  history.checkpoint(document, 'Previous edit');
  const redoDocument = history.undo(document);
  assert.ok(redoDocument);
  assert.equal(history.canRedo, true);

  const transaction = history.beginTransaction(document, 'Canvas gesture');
  document.name = 'Mutated during gesture';
  assert.equal(history.undoStack.length, 0);
  assert.equal(history.canRedo, true);
  const restored = history.cancelTransaction(transaction);
  assert.equal(restored.name, originalName);
  assert.equal(history.undoStack.length, 0);
  assert.equal(history.canRedo, true);
  assert.equal(history.commitTransaction(transaction), false);
});

test('committed history transactions undo the full pre-gesture document exactly once', () => {
  const history = new History();
  const original = createDocument();
  const transaction = history.beginTransaction(original, 'Move layers');
  const edited = structuredClone(original);
  edited.name = 'Moved';
  assert.equal(history.commitTransaction(transaction), true);
  assert.equal(history.canUndo, true);
  assert.equal(history.undo(edited).name, original.name);
  assert.equal(history.canRedo, true);
  assert.equal(history.commitTransaction(transaction), false);
});

test('no-op canvas transactions preserve redo history instead of adding an empty undo step', () => {
  const history = new History();
  const document = createDocument();
  history.checkpoint(document, 'Previous edit');
  const redoDocument = history.undo(document);
  assert.ok(redoDocument);
  const transaction = history.beginTransaction(document, 'Canvas gesture');
  document.name = 'Temporary movement';
  document.name = redoDocument.name;

  assert.equal(history.commitTransaction(transaction, document), false);
  assert.equal(transaction.active, false, 'a no-op transaction is consumed');
  assert.equal(history.undoStack.length, 0, 'a no-op does not add an undo step');
  assert.equal(history.canRedo, true, 'a no-op does not erase the redo branch');
});
