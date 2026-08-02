import { getEditorElements } from "./editor/dom.js";
import { createEditor } from "./editor/core.js";
import { attachEditorView } from "./editor/view.js";
import { attachEditorCanvas } from "./editor/canvas.js";
import { attachEditorOperations } from "./editor/operations.js";
import { attachEditorProcessing } from "./editor/processing.js";
import { bindEditorEvents } from "./editor/events.js";
import { attachLocalDataControls } from "./local-data.js";
import { buildEditorSessionSnapshot, clearEditorSession, writeEditorSession } from "./session.js";

// Composition only: feature code lives under src/editor/ and the companion
// batch surface remains in src/batch.js.
const editor = createEditor(getEditorElements());
attachEditorView(editor);
attachEditorCanvas(editor);
attachEditorOperations(editor);
attachEditorProcessing(editor);
bindEditorEvents(editor);
attachLocalDataControls();

editor.setCapabilities(editor.state.capabilities);
editor.renderAll();
editor.startWorker();

let editorSessionTimer = null;
function scheduleEditorSessionSave() {
  clearTimeout(editorSessionTimer);
  editorSessionTimer = setTimeout(async () => {
    editorSessionTimer = null;
    const snapshot = window.tinyImageStarEditor?.getSnapshot?.();
    if (!snapshot?.file?.bytes || snapshot.context?.kind === "batch") return;
    const built = buildEditorSessionSnapshot({ file: snapshot.file, operations: snapshot.operations });
    if (built.reason === "empty") {
      await clearEditorSession();
      return;
    }
    if (built.reason === "too-large") return;
    await writeEditorSession(built.snapshot);
  }, 150);
}

window.addEventListener("tinystar:editor-loaded", scheduleEditorSessionSave);
window.addEventListener("tinystar:editor-changed", scheduleEditorSessionSave);

window.tinyImageStarEditor = {
  loadFile: (file, operations, context) => editor.importImage(file, operations, context),
  clearFile: () => editor.clearImage(),
  getSnapshot: () => ({
    file: editor.state.file
      ? { ...editor.state.file, bytes: editor.state.file.bytes ? editor.state.file.bytes.slice() : null }
      : null,
    operations: editor.cloneOperations(),
    imageWidth: editor.state.image?.naturalWidth ?? 0,
    imageHeight: editor.state.image?.naturalHeight ?? 0,
    context: editor.state.editorContext,
  }),
  // Kept as a small composition bridge for capability-aware browser checks
  // and host integrations; the worker remains the production source of truth.
  setCapabilities: (raw) => editor.setCapabilities(raw),
  showEditor: () => window.dispatchEvent(new CustomEvent("tinystar:show-editor")),
  clearContext: () => {
    editor.state.editorContext = null;
    editor.state.savedOperations = editor.cloneOperations();
    editor.state.history = [];
    editor.state.future = [];
    editor.updateEditorAvailability();
    editor.updateDirtyState();
    editor.updateHistoryButtons();
  },
  replaceOperations: (operations, context = null) => {
    if (!editor.state.image) return;
    editor.state.operations = {
      ...editor.defaultOperations(),
      ...editor.cloneOperations(operations),
      crop: editor.cloneRect(operations.crop),
    };
    editor.state.savedOperations = editor.cloneOperations();
    editor.state.history = [];
    editor.state.future = [];
    editor.state.editorContext = context;
    editor.renderAll();
    editor.scheduleProcessing();
  },
};

import("./batch.js").catch(() => {
  window.dispatchEvent(new CustomEvent("tinystar:batch-error"));
});
