import { cloneDocument } from './model.js';

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
