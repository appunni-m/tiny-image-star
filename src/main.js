import { getEditorElements } from "./editor/dom.js";
import { createEditor } from "./editor/core.js";
import { attachEditorView } from "./editor/view.js";
import { attachEditorCanvas } from "./editor/canvas.js";
import { attachEditorOperations } from "./editor/operations.js";
import { attachEditorProject } from "./editor/project.js";
import { attachEditorText } from "./editor/text.js";
import { attachEditorProcessing } from "./editor/processing.js";
import { bindEditorEvents } from "./editor/events.js?v=20260928-figma-slice-2";
import { attachMobileShell } from "./editor/mobile-shell.js?v=20260927-responsive";
import { attachProcessingControls } from "./processing/controls.js?v=20260928-figma-slice-2";
import { attachLocalDataControls } from "./local-data.js";
import { attachStoryWorkspace } from "./story/workspace.js";

// Composition only: feature code lives under src/editor/ and the companion
// batch surface remains in src/batch.js.
const editor = createEditor(getEditorElements());
attachEditorView(editor);
attachEditorCanvas(editor);
attachEditorOperations(editor);
attachEditorProject(editor);
attachEditorText(editor);
attachEditorProcessing(editor);
bindEditorEvents(editor);
attachMobileShell(editor);
attachProcessingControls();
attachLocalDataControls();
attachStoryWorkspace();

editor.setCapabilities(editor.state.capabilities);
editor.renderAll();
editor.startWorker();

window.tinyImageStarEditor = {
  loadFile: (file, operations, context, project) => editor.importImage(file, operations, context, project),
  clearFile: () => editor.clearImage(),
  getSnapshot: () => ({
    file: editor.state.file
      ? { ...editor.state.file, bytes: editor.state.file.bytes ? editor.state.file.bytes.slice() : null }
      : null,
    operations: editor.cloneOperations(),
    imageWidth: editor.state.image?.naturalWidth ?? 0,
    imageHeight: editor.state.image?.naturalHeight ?? 0,
    context: editor.state.editorContext,
    project: editor.projectSnapshot(),
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
    editor.resetProject();
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
    editor.syncActiveText?.();
    editor.state.savedOperations = editor.cloneOperations();
    editor.state.history = [];
    editor.state.future = [];
    editor.state.editorContext = context;
    editor.resetProject();
    editor.renderAll();
    editor.scheduleProcessing();
  },
};

import("./batch.js?v=20260928-figma-slice-2").catch(() => {
  window.dispatchEvent(new CustomEvent("tinystar:batch-error"));
});
