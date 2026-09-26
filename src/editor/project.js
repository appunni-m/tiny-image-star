import { canonicalJSON, clone, createLegacyProject, upgradeProjectRenderer, assertEngineCompatibility } from "../project/model.js";
import { ProjectHistory } from "../project/history.js";
import { buildEditorSessionSnapshot, writeEditorSession } from "../session.js";
import { withLegacyStyle } from "../styles/legacy.js";

export function attachEditorProject(editor) {
  const { state } = editor;
  const nodeId = () => state.projectHistory?.document.slides[0].nodeIds[0];
  const syncHistory = () => {
    state.history = state.projectHistory?.past ?? [];
    state.future = state.projectHistory?.future ?? [];
  };
  editor.resetProject = (saved = null) => {
    if (!state.file || !state.image || !state.operations) { state.projectHistory = null; syncHistory(); return; }
    const prior = state.projectHistory?.document;
    const project = saved ? upgradeProjectRenderer(saved) : prior ? clone(prior) : createLegacyProject({ files: [{ ...state.file,
      width: state.image.naturalWidth, height: state.image.naturalHeight }], operations: [editor.cloneOperations()], name: state.file.name });
    if (project.slides.length !== 1 || project.slides[0].nodeIds.length !== 1 || project.nodes[project.slides[0].nodeIds[0]]?.kind !== "legacy-image") {
      throw new Error("This project needs the story workspace. Its saved data has been preserved.");
    }
    assertEngineCompatibility(project);
    if (!saved && prior) {
      project.nodes[project.slides[0].nodeIds[0]].operations = editor.cloneOperations();
      project.revision += 1;
    }
    if (!saved && state.editorContext?.style) project.recipe = { kind: "legacy-recipes", revision: 1, definitions: [withLegacyStyle(state.editorContext.style)] };
    else if (!saved && state.editorContext?.kind === "preset-edit") project.recipe = null;
    state.projectHistory = new ProjectHistory(project);
    state.operations = clone(project.nodes[nodeId()].operations);
    syncHistory();
  };
  editor.syncProjectPreview = () => {
    if (!state.projectHistory) editor.resetProject();
    if (!state.projectHistory) return;
    const node = state.projectHistory.document.nodes[nodeId()];
    if (canonicalJSON(node.operations) !== canonicalJSON(state.operations)) {
      state.projectHistory.preview({ type: "node", id: node.id, value: { ...node, operations: editor.cloneOperations() } });
    }
  };
  editor.commitProjectEdit = () => {
    editor.syncProjectPreview();
    state.projectHistory?.commit("Image edit");
    syncHistory();
  };
  editor.projectUndo = () => {
    editor.commitProjectEdit();
    const changed = state.projectHistory?.undo();
    if (changed) state.operations = clone(state.projectHistory.document.nodes[nodeId()].operations);
    syncHistory();
    return changed;
  };
  editor.projectRedo = () => {
    const changed = state.projectHistory?.redo();
    if (changed) state.operations = clone(state.projectHistory.document.nodes[nodeId()].operations);
    syncHistory();
    return changed;
  };
  editor.projectSnapshot = () => {
    editor.syncProjectPreview();
    return state.projectHistory ? clone(state.projectHistory.document) : null;
  };
  editor.projectOperations = () => state.projectHistory ? clone(state.projectHistory.document.nodes[nodeId()].operations) : editor.cloneOperations();

  let saveTimer;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const snapshot = window.tinyImageStarEditor?.getSnapshot?.();
      if (!snapshot?.file?.bytes || snapshot.context?.kind === "batch") return;
      const built = buildEditorSessionSnapshot({ file: snapshot.file, operations: snapshot.operations, project: snapshot.project });
      if (!built.reason) await writeEditorSession(built.snapshot);
    }, 150);
  };
  window.addEventListener("tinystar:editor-loaded", save);
  window.addEventListener("tinystar:editor-changed", save);
  window.addEventListener("tinystar:local-data-clearing", () => clearTimeout(saveTimer));
}
