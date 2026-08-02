import { DEFAULT_CAPABILITIES, normalizeCapabilities } from "../formats.js";

export const CROP_PRESETS = [
  { id: "original", label: "Original", aspect: null },
  { id: "square", label: "Square", aspect: 1 },
  { id: "4:3", label: "4:3", aspect: 4 / 3 },
  { id: "3:4", label: "3:4", aspect: 3 / 4 },
  { id: "16:9", label: "16:9", aspect: 16 / 9 },
  { id: "9:16", label: "9:16", aspect: 9 / 16 },
];

export function createEditorState() {
  return {
    enginePhase: "starting",
    capabilities: normalizeCapabilities(DEFAULT_CAPABILITIES),
    worker: null,
    readyTimer: null,
    fonts: new Map(),
    fontsReady: Promise.resolve(),
    activeTextId: null,
    textComposition: null,
    file: null,
    image: null,
    sourceUrl: null,
    loadToken: 0,
    operations: null,
    savedOperations: null,
    history: [],
    future: [],
    result: null,
    processingError: null,
    revision: 0,
    tool: "move",
    inspectorOpen: false,
    spacePressed: false,
    preview: "edited",
    cropDraft: null,
    cropAspect: null,
    zoom: 1,
    panX: 0,
    panY: 0,
    drag: null,
    controlEditBefore: null,
    scheduleTimer: null,
    editorContext: null,
    previewRequest: null,
  };
}
