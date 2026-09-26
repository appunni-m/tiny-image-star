/** All frame/crop coordinates are normalized; rotation is clockwise degrees. */
export interface Frame { x: number; y: number; width: number; height: number }
export interface Appearance { brightness?: number; contrast?: number; saturation?: number; grayscaleMix?: number }
export interface Asset {
  id: string; kind: "image" | "mask" | "font" | "texture"; name: string; type: string;
  byteLength: number; sha256: string | null; width?: number | null; height?: number | null;
  orientation: "upright" | "exif-to-upright"; lastModified?: number; license?: unknown;
  /** Copied variable-font descriptors; omitted for legacy font assets. */
  fontFace?: { weight: string; style: "normal" | "italic" };
  /** Explicit reduced source; its original is retained in the same asset map. */
  workingCopy?: { sourceAssetId: string; sourceSha256?: string; maxEdge: 2048; method: "pillow-rs-lanczos-png@1" };
}
interface Layer {
  id: string; frame: Frame; space: "slide" | "story"; anchorSlideId?: string; opacity?: number; rotation?: number;
  /** Persisted layout results, indexed by an existing output variant ID. */
  variantFrames?: Record<string, Frame>;
}
export interface ImageLayer extends Layer {
  kind: "image"; assetId: string; maskId?: string; crop?: Frame; fit?: "cover" | "contain";
  focal?: { x: number; y: number }; appearanceBase?: Appearance; appearance?: Appearance;
  depthTextId?: string; depthBackground?: "photo" | "page";
  connection?: { schema: 1; rightSlideId: string };
  /** Effect distances are fractions of slide height; effects need a source mask. */
  cutoutEffects?: { schema: 1; outline?: { color: string; width: number };
    shadow?: { color: string; opacity: number; blur: number; x: number; y: number } };
}
export interface TextLayer extends Layer {
  kind: "text"; text: string; fontId?: string; color?: string;
  style?: {
    builtinFont?: "system-sans" | "system-serif" | "system-mono" | "system-display";
    /** Relative to the chosen canonical dimension; height is the legacy default. */
    fontSize?: number; minFontSize?: number; fontBasis?: "width" | "height"; weight?: 400 | 600 | 700 | 800; italic?: boolean;
    align?: "left" | "center" | "right"; verticalAlign?: "top" | "middle" | "bottom";
    lineHeight?: number; fit?: "shrink" | "clip";
    shadow?: { color: string; blur: number; x: number; y: number };
  };
}
export interface ShapeLayer extends Layer {
  kind: "shape"; color?: string;
  /** The frame is photo-relative and follows that photo's resolved geometry. */
  attachment?: { schema: 1; imageId: string };
  style?: { shape?: "rectangle" | "rounded" | "ellipse"; radius?: number; strokeColor?: string; strokeWidth?: number };
}
export type SceneLayer = ImageLayer | TextLayer | ShapeLayer;
export interface Slide {
  id: string; name?: string; nodeIds: string[];
  overrides: Record<string, { frame?: Frame; variantFrames?: Record<string, Frame>; crop?: Frame; text?: string; opacity?: number; appearance?: Appearance }>;
}
export interface SceneProject {
  kind: "tiny-image-star/project"; version: 1; id: string; revision: number; name: string; createdAt: number; seed: number;
  engine: Record<string, string>; models: unknown[]; recipe: unknown;
  assets: Record<string, Asset>; nodes: Record<string, SceneLayer>; slides: Slide[];
  shared: { appearance: Appearance; layout?: unknown }; variants: Array<{ id: string; width: number; height: number }>;
}
export interface SceneRequest {
  project: SceneProject; slideId: string; variantId?: string;
  assets: Array<{ id: string; bytes: ArrayBuffer | Uint8Array }>;
  format?: "png" | "jpeg"; jpegBackground?: [number, number, number]; preview?: boolean; previewEdge?: number;
  memoryEstimate?: { heap: number; transient: number; output: number; cpu: number };
}
export interface SceneResult {
  bytes: Uint8Array; mime: "image/png" | "image/jpeg"; format: "png" | "jpeg";
  width: number; height: number; canonicalWidth: number; canonicalHeight: number; mode: string; outputBytes: number;
  projectId: string; revision: number; slideId: string; variantId: string; preview: boolean;
  warnings: Array<{ code: "TEXT_OVERFLOW" | "DEPTH_SUBJECT_NEEDED" | "CONNECTION_SUBJECT_NEEDED" | "CUTOUT_EFFECTS_SUBJECT_NEEDED"; nodeId: string }>;
}
