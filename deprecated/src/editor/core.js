import { createEditorState } from "./state.js";
import { DEFAULT_QUALITY } from "../quality.js";

export function createEditor(elements) {
  const state = createEditorState();
  const editor = { elements, state };

  editor.cloneRect = (rect) => rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
  editor.cloneTextLayers = (layers) => Array.isArray(layers)
    ? layers.map((layer) => layer && typeof layer === "object" ? { ...layer } : null).filter(Boolean)
    : [];
  editor.cloneOperations = (operations = state.operations) => {
    if (!operations) return null;
    return {
      ...operations,
      crop: editor.cloneRect(operations.crop),
      textLayers: editor.cloneTextLayers(operations.textLayers),
    };
  };
  editor.sameOperations = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  editor.formatBytes = (value) => {
    if (!Number.isFinite(value)) return "—";
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  };
  editor.fullRect = () => ({
    x: 0,
    y: 0,
    width: state.image?.naturalWidth ?? 0,
    height: state.image?.naturalHeight ?? 0,
  });
  editor.defaultOperations = () => {
    const width = state.image.naturalWidth;
    const height = state.image.naturalHeight;
    return {
      crop: null,
      rotation: 0,
      flipX: false,
      flipY: false,
      resizeWidth: width,
      resizeHeight: height,
      resizeMode: "fit",
      aspectLocked: true,
      brightness: 1,
      contrast: 1,
      grayscale: false,
      textLayers: [],
      lossy: false,
      quality: DEFAULT_QUALITY,
      format: state.capabilities.outputFormats[0] ?? "png",
    };
  };

  return editor;
}
