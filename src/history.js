import { cloneDocument } from './model.js';

function historyValuesEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left)) return left.length === right.length && left.every((value, index) => historyValuesEqual(value, right[index]));
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every(key => Object.hasOwn(right, key) && historyValuesEqual(left[key], right[key]));
}

export class History {
  constructor(limit = 100) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
  }

  checkpoint(document, label = 'Edit') {
    this.undoStack.push({ document: cloneDocument(document), label });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  /** Capture an undo snapshot without changing either history stack until commit. */
  beginTransaction(document, label = 'Edit') {
    return { document: cloneDocument(document), label, active: true };
  }

  /** Commit a previously captured snapshot as one undoable edit. */
  commitTransaction(transaction, currentDocument) {
    if (!transaction?.active || !transaction.document) return false;
    if (currentDocument !== undefined && historyValuesEqual(transaction.document, currentDocument)) {
      transaction.active = false;
      return false;
    }
    this.undoStack.push({ document: transaction.document, label: transaction.label || 'Edit' });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    transaction.active = false;
    return true;
  }

  /** Discard an in-progress edit and return its untouched pre-edit snapshot. */
  cancelTransaction(transaction) {
    if (!transaction?.active || !transaction.document) return null;
    transaction.active = false;
    // The transaction is consumed on cancellation, so transfer its snapshot
    // back to the editor instead of allocating a second full-document clone.
    return transaction.document;
  }

  undo(current) {
    const step = this.undoStack.pop();
    if (!step) return null;
    this.redoStack.push({ document: cloneDocument(current), label: step.label });
    return cloneDocument(step.document);
  }

  redo(current) {
    const step = this.redoStack.pop();
    if (!step) return null;
    this.undoStack.push({ document: cloneDocument(current), label: step.label });
    return cloneDocument(step.document);
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
}
