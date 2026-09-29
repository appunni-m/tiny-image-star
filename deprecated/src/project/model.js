// Project geometry: slide-local frames are fractions of the selected viewport.
// Story-space frames use slide widths horizontally and one slide height
// vertically, anchored to a stable slide ID. Legacy operations retain their
// original upright-source pixel coordinates and explicit transform order.
import { validatePhotoLook } from "../compositor/photo-look.js";
import { validateCutoutEffects } from "../compositor/cutout-effects-spec.js";
import { WORKING_COPY_EDGE, WORKING_COPY_METHOD, workingCopySize } from "./working-copy.js";
export const PROJECT_VERSION = 1;
export const PROJECT_KIND = "tiny-image-star/project";
export const MAX_PROJECT_BYTES = 2 * 1024 * 1024;
export const LEGACY_ORDER = Object.freeze(["exif", "crop", "rotate", "flip", "resize", "adjust", "text", "encode"]);
export const LEGACY_ENGINE_IDENTITY = Object.freeze({ name: "pillow-rs", version: "12.2.0-alpha.1", adapter: "legacy-v1",
  javascriptSha256: "3d4251ad14e3731e680286d3ea9d8f25af932448596eaa2af09474ebcfd1b5ed",
  wasmSha256: "08dfff0b10424b6ece937574aefd4c07d1d4f8ac95643e7c4d5138ab720d5a96" });
export const ENGINE_IDENTITY = Object.freeze({ ...LEGACY_ENGINE_IDENTITY, compositor: "canvas-rgba-pillow-v1" });
export const clone = (value) => structuredClone(value);
export const newId = (kind) => `${kind}-${crypto.randomUUID()}`;

function fail(message, code = "INVALID_PROJECT") { const error = new Error(message); error.code = code; throw error; }
function check(condition, message) { if (!condition) fail(message); }
function number(value, min, max) { return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max; }
function identifier(value) { return typeof value === "string" && value.length > 0 && value.length <= 512 && !["__proto__", "prototype", "constructor"].includes(value); }
function object(value) { return value && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }
function keys(value, allowed) { check(Object.keys(value).every((key) => allowed.includes(key)), "Unsupported project property."); }
function appearance(value) {
  check(object(value), "Invalid appearance settings.");
  keys(value, ["brightness", "contrast", "saturation", "grayscaleMix"]);
  for (const [key, amount] of Object.entries(value)) check(number(amount, 0, key === "grayscaleMix" ? 1 : 4), "Invalid appearance strength.");
}

export function validateData(value) {
  let count = 0;
  const visit = (item, depth) => {
    if (++count > 100_000 || depth > 20) fail("Project data is too complex.");
    if (item === null || typeof item === "boolean") return;
    if (typeof item === "string") { check(item.length <= 50_000, "Project text is too long."); return; }
    if (typeof item === "number") { check(Number.isFinite(item), "Project numbers must be finite."); return; }
    check(Array.isArray(item) || object(item), "Projects contain parameters and asset references, not executable code or image buffers.");
    for (const [key, child] of Object.entries(item)) {
      check(!["__proto__", "constructor", "prototype"].includes(key), "Unsafe project property.");
      visit(child, depth + 1);
    }
  };
  visit(value, 0);
  check(new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_PROJECT_BYTES, "Project metadata is too large.");
  return value;
}

export function canonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

const COMPONENT_SYNC_FIELDS = ["name", "visible", "locked", "assetId", "maskId", "fontId", "space", "anchorSlideId", "constraints",
  "layoutPositioning", "flowGrid", "flowSizing", "layoutSizing", "layoutSize", "layoutMinMax", "variantFrames", "gridPlacement",
  "gridAlignment", "opacity", "rotation", "flipX", "flipY", "appearance", "appearanceBase", "crop", "text", "style", "color",
  "fit", "focal", "depthTextId", "depthBackground", "connection", "cutoutEffects", "attachment"];
const COMPONENT_OVERRIDE_PATHS = new Set([...COMPONENT_SYNC_FIELDS, "frame.x", "frame.y", "frame.width", "frame.height"]);

/** Keep materialized component instances linked while preserving explicitly edited instance properties. */
export function synchronizeComponentInstances(project, { beforeProject = null, changedNodeIds = [], trackOverrides = false } = {}) {
  if (trackOverrides) for (const id of changedNodeIds) {
    const before = beforeProject?.nodes[id], node = project.nodes[id];
    if (!node?.componentSourceNodeId || !before || !project.nodes[node.componentSourceNodeId]) continue;
    if (before.componentSourceNodeId !== node.componentSourceNodeId || before.componentInstanceOf !== node.componentInstanceOf) continue;
    const source = project.nodes[node.componentSourceNodeId], overrides = new Set(node.componentOverrides ?? []);
    for (const field of COMPONENT_SYNC_FIELDS) {
      if (canonicalJSON(before[field]) === canonicalJSON(node[field])) continue;
      if (canonicalJSON(node[field]) === canonicalJSON(source[field])) overrides.delete(field);
      else overrides.add(field);
    }
    for (const axis of ["x", "y", "width", "height"]) {
      if (canonicalJSON(before.frame?.[axis]) === canonicalJSON(node.frame?.[axis])) continue;
      const path = `frame.${axis}`;
      if (canonicalJSON(node.frame?.[axis]) === canonicalJSON(source.frame?.[axis])) overrides.delete(path);
      else overrides.add(path);
    }
    node.componentOverrides = [...overrides].sort();
  }

  for (const node of Object.values(project.nodes)) {
    const source = node.componentSourceNodeId && project.nodes[node.componentSourceNodeId];
    if (!source) continue;
    const overrides = new Set(node.componentOverrides ?? []);
    for (const field of COMPONENT_SYNC_FIELDS) {
      if (overrides.has(field)) continue;
      if (Object.hasOwn(source, field)) node[field] = clone(source[field]);
      else delete node[field];
    }
    const frame = clone(source.frame);
    for (const axis of ["x", "y", "width", "height"]) if (overrides.has(`frame.${axis}`)) frame[axis] = node.frame[axis];
    node.frame = frame;
  }
  return project;
}

export function validateLegacyOperations(operations) {
  check(object(operations), "Missing legacy operations.");
  keys(operations, ["crop", "cropRelative", "rotation", "flipX", "flipY", "resizeWidth", "resizeHeight", "maxWidth", "maxHeight",
    "resizeMode", "aspectLocked", "brightness", "contrast", "grayscale", "photoLook", "textLayers", "lossy", "quality", "format", "jpegBackground", "presetId", "presetName"]);
  if (operations.photoLook != null) validatePhotoLook(operations.photoLook);
  for (const key of ["brightness", "contrast"]) if (operations[key] != null) check(number(operations[key], 0, 4), `Invalid ${key}.`);
  for (const key of ["resizeWidth", "resizeHeight", "maxWidth", "maxHeight"]) if (operations[key] != null) check(number(operations[key], 0, 80_000_000), `Invalid ${key}.`);
  // Preserve an overlarge edit intent for correction/undo. Render admission
  // separately enforces the actual pixel/memory limits before allocation.
  if (operations.rotation != null) check([0, 90, 180, 270].includes(operations.rotation), "Invalid legacy rotation.");
  if (operations.crop) for (const key of ["x", "y", "width", "height"]) check(number(operations.crop[key], 0, 80_000_000), "Invalid legacy crop.");
  check(!operations.textLayers || Array.isArray(operations.textLayers) && operations.textLayers.length <= 100, "Too many text layers.");
}

function validateFrame(frame) {
  check(object(frame) && number(frame.x, -40, 40) && number(frame.y, -4, 4)
    && number(frame.width, .000001, 40) && number(frame.height, .000001, 8), "Invalid normalized frame.");
  keys(frame, ["x", "y", "width", "height"]);
}
function validateVariantFrames(frames, variants) {
  check(object(frames) && Object.keys(frames).length <= variants.length, "Invalid output-specific frames.");
  for (const [id, frame] of Object.entries(frames)) {
    check(variants.some((variant) => variant.id === id), "A frame references an unknown output shape.");
    validateFrame(frame);
  }
}
function validateCrop(crop) {
  check(object(crop) && ["x", "y", "width", "height"].every((key) => number(crop[key], 0, 1))
    && crop.width > 0 && crop.height > 0 && crop.x + crop.width <= 1 && crop.y + crop.height <= 1, "Invalid normalized source crop.");
  keys(crop, ["x", "y", "width", "height"]);
}

/** Resolve saved grid placements, reserving explicit cells before auto-flow. */
export function gridPlacementsForChildren(childIds, nodes, layout) {
  const columns = layout.columns ?? 2, fixedRows = layout.rows ?? 0;
  check(Number.isInteger(columns) && columns >= 1 && columns <= 24, "Grid columns must be between 1 and 24.");
  check(Number.isInteger(fixedRows) && fixedRows >= 0 && fixedRows <= 24, "Grid rows must be between 0 and 24.");
  childIds = childIds.filter((id) => nodes[id]?.layoutPositioning !== "absolute");
  const placements = new Map(), occupied = new Set();
  let rowCount = Math.max(1, fixedRows);
  const cellsFor = (placement) => {
    const cells = [];
    for (let row = placement.row; row < placement.row + placement.rowSpan; row++)
      for (let column = placement.column; column < placement.column + placement.columnSpan; column++) cells.push(`${row}:${column}`);
    return cells;
  };
  const reserve = (id, placement) => {
    const cells = cellsFor(placement);
    check(cells.every((cell) => !occupied.has(cell)), "Grid cells cannot overlap.");
    for (const cell of cells) occupied.add(cell);
    placements.set(id, placement); rowCount = Math.max(rowCount, placement.row + placement.rowSpan - 1);
  };
  for (const id of childIds) {
    const placement = nodes[id]?.gridPlacement;
    if (!placement) continue;
    check(Number.isInteger(placement.row) && placement.row >= 1 && placement.row <= 200
      && Number.isInteger(placement.column) && placement.column >= 1 && placement.column <= columns
      && Number.isInteger(placement.rowSpan) && placement.rowSpan >= 1 && placement.rowSpan <= 200
      && Number.isInteger(placement.columnSpan) && placement.columnSpan >= 1 && placement.columnSpan <= columns
      && placement.column + placement.columnSpan - 1 <= columns
      && placement.row + placement.rowSpan - 1 <= 200
      && (!fixedRows || placement.row + placement.rowSpan - 1 <= fixedRows), "Grid placement is outside the available tracks.");
    reserve(id, placement);
  }
  for (const id of childIds) {
    if (placements.has(id)) continue;
    let placement = null;
    const lastRow = fixedRows || 200;
    for (let row = 1; row <= lastRow && !placement; row++) for (let column = 1; column <= columns; column++) {
      const candidate = { row, column, rowSpan: 1, columnSpan: 1 };
      if (cellsFor(candidate).every((cell) => !occupied.has(cell))) { placement = candidate; break; }
    }
    check(placement, "Grid has no empty cells. Increase its row count or use auto rows.");
    reserve(id, placement);
  }
  return { placements, rows: fixedRows || rowCount };
}

/** Read the saved track list, filling omitted definitions with Figma-style `1fr` tracks. */
export function gridTrackDefinitions(layout, axis, count) {
  const tracks = axis === "columns" ? layout.columnTracks : axis === "rows" ? layout.rowTracks : null;
  return Array.from({ length: count }, (_, index) => tracks?.[index] ?? { mode: "fill", value: 1 });
}

function constrainLayoutSize(node, width, height) {
  const bounds = node?.layoutMinMax ?? {};
  return { width: Math.max(bounds.minWidth ?? .01, Math.min(bounds.maxWidth ?? Infinity, width)),
    height: Math.max(bounds.minHeight ?? .01, Math.min(bounds.maxHeight ?? Infinity, height)) };
}

function distributeFillSizes(items, available, axis) {
  const sizes = new Map(), pending = new Set(items);
  let remaining = available;
  while (pending.size) {
    const share = Math.max(0, remaining) / pending.size;
    let constrained = false;
    for (const item of pending) {
      const min = item.node.layoutMinMax?.[`min${axis}`] ?? .01;
      const max = item.node.layoutMinMax?.[`max${axis}`] ?? Infinity;
      if (share < min || share > max) {
        const size = share < min ? min : max;
        sizes.set(item.id, size); remaining -= size; pending.delete(item); constrained = true;
      }
    }
    if (!constrained) {
      for (const item of pending) sizes.set(item.id, share);
      break;
    }
  }
  return sizes;
}

function gridTrackSizes(layout, axis, count, available, children, placements, gap, hugParent = false) {
  const tracks = gridTrackDefinitions(layout, axis, count), minima = Array(count).fill(0), sizes = Array(count).fill(0);
  for (const child of children) {
    const placement = placements.get(child.id), start = axis === "columns" ? placement.column : placement.row;
    const span = axis === "columns" ? placement.columnSpan : placement.rowSpan;
    const dimension = axis === "columns" ? child.width : child.height;
    const needed = Math.max(0, dimension - gap * (span - 1)) / span;
    for (let index = start - 1; index < start - 1 + span; index++) {
      if (tracks[index].mode === "hug" || hugParent && tracks[index].mode === "fill")
        minima[index] = Math.max(minima[index], needed);
    }
  }
  for (let index = 0; index < count; index++) {
    const track = tracks[index];
    if (track.mode === "fixed") sizes[index] = track.value;
    else if (track.mode === "hug" || hugParent) sizes[index] = minima[index];
  }
  const fill = tracks.map((track, index) => track.mode === "fill" && !hugParent ? index : -1).filter((index) => index >= 0);
  if (available != null && fill.length) {
    const remaining = Math.max(0, available - sizes.reduce((sum, size) => sum + size, 0));
    const weight = fill.reduce((sum, index) => sum + tracks[index].value, 0);
    for (const index of fill) sizes[index] = Math.max(.01, remaining * tracks[index].value / weight);
  }
  return sizes;
}

/** Resolve the page-pixel positions and sizes of a grid frame's tracks for canvas editing. */
export function resolveGridTrackGeometry(project, slideId, frameId, variantId = project.variants[0].id) {
  validateProject(project);
  const slide = project.slides.find((entry) => entry.id === slideId), node = project.nodes[frameId];
  const layout = node?.style?.layout;
  if (!slide?.nodeIds.includes(frameId) || node?.kind !== "frame" || layout?.direction !== "grid")
    throw new Error("Choose a grid frame to inspect its tracks.");
  const { variant, frames } = layerFrameMap(project, slideId, variantId), resolved = frames.get(frameId);
  if (!resolved) throw new Error("The grid frame is unavailable on this page.");
  const childIds = slide.nodeIds.filter((id) => project.nodes[id]?.parentId === frameId && project.nodes[id]?.visible !== false
    && project.nodes[id]?.layoutPositioning !== "absolute");
  const { placements, rows } = gridPlacementsForChildren(childIds, project.nodes, layout);
  const parentWidth = resolved.frame.width * variant.width, parentHeight = resolved.frame.height * variant.height;
  const padding = { top: 0, right: 0, bottom: 0, left: 0, ...layout.padding };
  const columnGap = layout.columnGap ?? layout.gap ?? 0, rowGap = layout.rowGap ?? layout.gap ?? 0;
  const availableWidth = Math.max(0, parentWidth - padding.left - padding.right - columnGap * (layout.columns - 1));
  const availableHeight = Math.max(0, parentHeight - padding.top - padding.bottom - rowGap * (rows - 1));
  const children = childIds.map((id) => {
    const child = project.nodes[id], patch = slide.overrides[id] ?? {};
    const frame = patch.variantFrames?.[variant.id] ?? patch.frame ?? child.variantFrames?.[variant.id] ?? child.frame;
    const intrinsic = child.kind === "frame" && child.style?.layout ? intrinsicFrameSize(project, slide, id, variant) : { width: 0, height: 0 };
    const size = constrainLayoutSize(child,
      child.layoutSizing?.width === "hug" ? intrinsic.width : child.layoutSize?.width ?? frame.width * parentWidth,
      child.layoutSizing?.height === "hug" ? intrinsic.height : child.layoutSize?.height ?? frame.height * parentHeight);
    return { id, ...size };
  });
  const definitions = {
    columns: gridTrackDefinitions(layout, "columns", layout.columns),
    rows: gridTrackDefinitions(layout, "rows", rows),
  };
  const makeTracks = (axis, count, gap, sizes, start) => {
    let cursor = start;
    return sizes.map((size, index) => {
      const track = { index, start: cursor, size, end: cursor + size, gapAfter: index + 1 < count ? gap : 0,
        ...clone(definitions[axis][index]) };
      cursor += size + track.gapAfter;
      return track;
    });
  };
  const columnSizes = gridTrackSizes(layout, "columns", layout.columns, availableWidth, children, placements, columnGap);
  const rowSizes = gridTrackSizes(layout, "rows", rows, availableHeight, children, placements, rowGap);
  return { frame: clone(resolved.frame), rotation: resolved.rotation, width: parentWidth, height: parentHeight, padding,
    columns: makeTracks("columns", layout.columns, columnGap, columnSizes, padding.left),
    rows: makeTracks("rows", rows, rowGap, rowSizes, padding.top) };
}

function color(value) { return typeof value === "string" && /^#[a-f0-9]{6}([a-f0-9]{2})?$/i.test(value); }

function validateNodeStyle(node) {
  check(node.order == null && node.operations == null, "Scene layers cannot carry legacy operations.");
  if (node.color != null) check(color(node.color), "Invalid layer color.");
  if (node.fit != null) check(node.kind === "image" && ["cover", "contain"].includes(node.fit), "Invalid image fit.");
  if (node.focal != null) {
    check(node.kind === "image" && object(node.focal), "Invalid focal point.");
    keys(node.focal, ["x", "y"]);
    check(number(node.focal.x, 0, 1) && number(node.focal.y, 0, 1), "Invalid focal point.");
  }
  if (node.kind === "image") { check(node.style == null && node.fontId == null && node.text == null && node.color == null, "Unsupported image style."); return; }
  check(node.assetId == null, "Only image layers can reference a source image.");
  check(node.crop == null && node.maskId == null && node.appearance == null, "Only image layers support crop, masks and image adjustments.");
  const style = node.style ?? {};
  check(object(style), "Invalid layer style.");
  if (node.kind === "frame") {
    check(node.text == null && node.fontId == null, "Frames cannot contain text or fonts.");
      keys(style, ["clipContent", "radius", "strokeColor", "strokeWidth", "layout"]);
    if (style.clipContent != null) check(typeof style.clipContent === "boolean", "Invalid frame clipping setting.");
    if (style.radius != null) check(number(style.radius, 0, .5), "Invalid corner radius.");
    if (style.strokeColor != null) check(color(style.strokeColor), "Invalid stroke color.");
    if (style.strokeWidth != null) check(number(style.strokeWidth, 0, .2), "Invalid stroke width.");
    check((style.strokeColor != null) === (style.strokeWidth != null), "A stroke needs both color and width.");
    if (style.layout != null) {
      const layout = style.layout; check(object(layout), "Invalid frame layout.");
      keys(layout, ["direction", "gap", "rowGap", "columnGap", "padding", "justify", "align", "wrap", "columns", "rows", "columnTracks", "rowTracks"]);
      check(["horizontal", "vertical", "grid"].includes(layout.direction), "Invalid frame layout direction.");
      if (layout.direction === "grid") {
        check(Number.isInteger(layout.columns) && layout.columns >= 1 && layout.columns <= 24, "Invalid grid column count.");
        check(Number.isInteger(layout.rows) && layout.rows >= 0 && layout.rows <= 24, "Invalid grid row count.");
        check(layout.wrap !== true, "Grid layouts do not use wrap.");
        if (layout.justify != null) check(["start", "center", "end", "stretch"].includes(layout.justify), "Invalid grid horizontal alignment.");
        for (const [key, maxCount] of [["columnTracks", layout.columns], ["rowTracks", layout.rows || 200]]) {
          const tracks = layout[key];
          if (tracks == null) continue;
          check(Array.isArray(tracks) && tracks.length <= maxCount, "Invalid grid track list.");
          for (const track of tracks) {
            check(object(track), "Invalid grid track.");
            if (track.mode === "hug") {
              keys(track, ["mode"]);
            } else {
              keys(track, ["mode", "value"]);
              if (track.mode === "fixed") check(number(track.value, .01, 16384), "Invalid fixed grid track size.");
              else if (track.mode === "fill") check(number(track.value, .01, 1000), "Invalid grid track fraction.");
              else check(false, "Invalid grid track sizing mode.");
            }
          }
        }
      } else check(layout.columns == null && layout.rows == null && layout.columnTracks == null && layout.rowTracks == null,
        "Grid tracks require a grid layout.");
      if (layout.gap != null) check(number(layout.gap, 0, 16384), "Invalid frame layout gap.");
      for (const key of ["rowGap", "columnGap"]) if (layout[key] != null) check(number(layout[key], 0, 16384), "Invalid frame layout gap.");
      if (layout.wrap != null) check(typeof layout.wrap === "boolean", "Invalid frame wrapping setting.");
      if (layout.padding != null) {
        check(object(layout.padding), "Invalid frame layout padding."); keys(layout.padding, ["top", "right", "bottom", "left"]);
        for (const value of Object.values(layout.padding)) check(number(value, 0, 16384), "Invalid frame layout padding.");
      }
      if (layout.direction !== "grid" && layout.justify != null) check(["start", "center", "end", "space-between", "space-around", "space-evenly"].includes(layout.justify), "Invalid frame layout alignment.");
      if (layout.align != null) check(["start", "center", "end", "stretch"].includes(layout.align), "Invalid frame cross-axis alignment.");
    }
  } else if (node.kind === "shape") {
    check(node.text == null, "Shapes cannot contain caption text.");
    keys(style, ["shape", "radius", "strokeColor", "strokeWidth", "path", "primitive"]);
    check(style.shape == null || ["rectangle", "rounded", "ellipse", "path"].includes(style.shape), "Unsupported shape.");
    if (style.radius != null) check(number(style.radius, 0, .5), "Invalid corner radius.");
    if (style.strokeColor != null) check(color(style.strokeColor), "Invalid stroke color.");
    if (style.strokeWidth != null) check(number(style.strokeWidth, 0, .2), "Invalid stroke width.");
    check((style.strokeColor != null) === (style.strokeWidth != null), "A stroke needs both color and width.");
    if (style.shape === "path") {
      const path = style.path;
      check(object(path), "A vector layer needs path data."); keys(path, ["closed", "points"]);
      check(typeof path.closed === "boolean" && Array.isArray(path.points) && path.points.length >= (path.closed ? 3 : 2)
        && path.points.length <= 512, "Invalid vector path.");
      if (style.primitive != null) {
        const primitive = style.primitive;
        check(object(primitive) && path.closed, "Parametric vector shapes need a closed path.");
        keys(primitive, ["type", "sides", "innerRadius"]);
        check(["polygon", "star"].includes(primitive.type) && Number.isInteger(primitive.sides)
          && primitive.sides >= 3 && primitive.sides <= 24, "Invalid parametric vector shape.");
        if (primitive.type === "star") check(number(primitive.innerRadius, .12, .85), "Invalid star inner radius.");
        else check(primitive.innerRadius == null, "Polygons do not use an inner radius.");
        check(path.points.length === primitive.sides * (primitive.type === "star" ? 2 : 1),
          "Parametric vector point count does not match its saved geometry.");
      }
      if (!path.closed) check(style.strokeColor != null && style.strokeWidth > 0, "An open vector path needs a visible stroke.");
      for (const point of path.points) {
        check(object(point), "Invalid vector point."); keys(point, ["x", "y", "handleIn", "handleOut", "handleMode"]);
        check(number(point.x, 0, 1) && number(point.y, 0, 1), "Invalid vector point position.");
        if (point.handleMode != null) check(["corner", "smooth", "mirrored"].includes(point.handleMode)
          && (point.handleIn != null || point.handleOut != null), "Invalid vector handle mode.");
        for (const key of ["handleIn", "handleOut"]) if (point[key] != null) {
          const handle = point[key]; check(object(handle), "Invalid vector handle."); keys(handle, ["x", "y"]);
          check(number(handle.x, -4, 5) && number(handle.y, -4, 5), "Invalid vector handle position.");
        }
      }
      if (style.radius != null) check(false, "Vector paths do not use a corner radius.");
    } else check(style.path == null && style.primitive == null, "Only vector paths can carry path data or geometry.");
    check(node.fontId == null, "Shapes cannot reference a font.");
  } else if (node.kind === "text") {
    keys(style, ["builtinFont", "fontSize", "minFontSize", "fontBasis", "weight", "italic", "align", "verticalAlign", "lineHeight", "fit", "shadow"]);
    if (style.fontBasis != null) check(["width", "height"].includes(style.fontBasis), "Invalid font sizing basis.");
    if (style.builtinFont != null) check(["system-sans", "system-serif", "system-mono", "system-display"].includes(style.builtinFont), "Unknown built-in font.");
    if (style.fontSize != null) check(number(style.fontSize, .005, 1), "Invalid text size.");
    if (style.minFontSize != null) check(number(style.minFontSize, .005, style.fontSize ?? .05), "Invalid minimum text size.");
    if (style.weight != null) check([400, 600, 700, 800].includes(style.weight), "Invalid text weight.");
    if (style.italic != null) check(typeof style.italic === "boolean", "Invalid text style.");
    if (style.align != null) check(["left", "center", "right"].includes(style.align), "Invalid text alignment.");
    if (style.verticalAlign != null) check(["top", "middle", "bottom"].includes(style.verticalAlign), "Invalid vertical text alignment.");
    if (style.lineHeight != null) check(number(style.lineHeight, .8, 2.5), "Invalid line spacing.");
    if (style.fit != null) check(["shrink", "clip"].includes(style.fit), "Invalid text fit.");
    if (style.shadow != null) {
      check(object(style.shadow), "Invalid text shadow."); keys(style.shadow, ["color", "blur", "x", "y"]);
      check(color(style.shadow.color) && number(style.shadow.blur, 0, .05) && number(style.shadow.x, -.05, .05) && number(style.shadow.y, -.05, .05), "Invalid text shadow.");
    }
  }
}

export function assertEngineCompatibility(project, { allowLegacy = false } = {}) {
  const identity = canonicalJSON(project.engine);
  if (identity !== canonicalJSON(ENGINE_IDENTITY) && !(allowLegacy && identity === canonicalJSON(LEGACY_ENGINE_IDENTITY))) fail("This project needs a different renderer version. Its saved data has been preserved.", "UNSUPPORTED_PROJECT_RENDERER");
}

// Geometry/operations stay intact; the new identity records the change from
// browser final text encoding to the shared Pillow final-encode path.
export function upgradeProjectRenderer(project) {
  validateProject(project);
  assertEngineCompatibility(project, { allowLegacy: true });
  const upgraded = clone(project);
  if (canonicalJSON(project.engine) !== canonicalJSON(ENGINE_IDENTITY)) {
    upgraded.engine = clone(ENGINE_IDENTITY);
    upgraded.revision += 1;
  }
  return upgraded;
}

export function validateProject(project) {
  validateData(project);
  if (project?.kind !== PROJECT_KIND || project.version !== PROJECT_VERSION) fail("This project version is not supported. Its original data has been preserved.", "UNSUPPORTED_PROJECT_VERSION");
  keys(project, ["kind", "version", "id", "revision", "name", "createdAt", "seed", "engine", "models", "recipe", "assets", "nodes", "slides", "shared", "variants"]);
  check(identifier(project.id) && Number.isSafeInteger(project.revision) && project.revision >= 0, "Invalid project identity or revision.");
  check(Number.isInteger(project.seed) && number(project.seed, 0, 0xffffffff), "Invalid deterministic seed.");
  check(object(project.engine) && identifier(project.engine.name) && identifier(project.engine.version), "Missing engine identity.");
  check(Array.isArray(project.models) && project.models.length <= 16, "Invalid model dependencies.");
  check(object(project.assets) && Object.keys(project.assets).length <= 1000, "Invalid asset map.");
  for (const [id, asset] of Object.entries(project.assets)) {
    keys(asset, ["id", "kind", "name", "type", "byteLength", "sha256", "width", "height", "orientation", "lastModified", "license", "fontFace", "workingCopy"]);
    check(identifier(id) && asset.id === id && ["image", "mask", "font", "texture"].includes(asset.kind), "Invalid asset identity.");
    check(asset.sha256 === null || /^[a-f0-9]{64}$/.test(asset.sha256), "Invalid asset digest.");
    check(number(asset.byteLength, 0, 160 * 1024 * 1024), "Invalid asset size.");
    check(asset.orientation === "exif-to-upright" || asset.orientation === "upright", "Missing orientation policy.");
    check(!("url" in asset) && !("bytes" in asset), "Project assets must be local references.");
    if (asset.fontFace != null) {
      check(asset.kind === "font", "Only fonts can declare typeface settings."); keys(asset.fontFace, ["weight", "style"]);
      check(/^[1-9]00 [1-9]00$/.test(asset.fontFace.weight) && ["normal", "italic"].includes(asset.fontFace.style), "Invalid typeface settings.");
      const [minimum, maximum] = asset.fontFace.weight.split(" ").map(Number); check(minimum <= maximum, "Invalid font weight range.");
    }
    if (asset.width != null || asset.height != null) check(number(asset.width, 1, 80_000_000) && number(asset.height, 1, 80_000_000) && asset.width * asset.height <= 80_000_000, "Invalid source dimensions.");
    if (asset.workingCopy != null) {
      keys(asset.workingCopy, ["sourceAssetId", "sourceSha256", "maxEdge", "method"]);
      const { sourceAssetId, maxEdge, method } = asset.workingCopy, original = project.assets[sourceAssetId];
      check(["image", "mask"].includes(asset.kind) && asset.type === "image/png" && asset.orientation === "upright"
        && sourceAssetId !== id && original?.kind === asset.kind && !original.workingCopy
        && original.sha256 && asset.sha256 && maxEdge === WORKING_COPY_EDGE && method === WORKING_COPY_METHOD,
      "Invalid editing copy or missing original source.");
      if (asset.workingCopy.sourceSha256 != null) check(asset.workingCopy.sourceSha256 === original.sha256, "An editing copy's original source changed.");
      if (asset.kind === "mask") check(original.orientation === "upright", "A cutout copy needs an upright original.");
      const size = workingCopySize(original.width, original.height, maxEdge);
      check(Math.max(original.width, original.height) > maxEdge && asset.width === size.width && asset.height === size.height,
        "Editing copy dimensions do not match its original source.");
    }
  }
  check(Array.isArray(project.slides) && project.slides.length > 0 && project.slides.length <= 40, "A project needs 1–40 slides.");
  check(new Set(project.slides.map((slide) => slide.id)).size === project.slides.length, "Slide IDs must be unique.");
  check(object(project.nodes) && Object.keys(project.nodes).length <= 1000, "Invalid layer graph.");
  check(object(project.shared) && Array.isArray(project.variants) && project.variants.length > 0 && project.variants.length <= 8, "Missing shared settings or output variants.");
  keys(project.shared, ["appearance", "layout"]);
  appearance(project.shared.appearance);
  check(new Set(project.variants.map((variant) => variant.id)).size === project.variants.length, "Variant IDs must be unique.");
  for (const variant of project.variants) check(identifier(variant.id) && number(variant.width, 1, 16384) && number(variant.height, 1, 16384) && variant.width * variant.height <= 80_000_000, "Invalid output variant.");
  for (const slide of project.slides) {
    check(identifier(slide.id) && Array.isArray(slide.nodeIds) && slide.nodeIds.length <= 200 && new Set(slide.nodeIds).size === slide.nodeIds.length, "Invalid slide layers.");
    check(object(slide.overrides), "Missing slide overrides.");
    for (const id of slide.nodeIds) check(Object.hasOwn(project.nodes, id), "A slide references a missing layer.");
    for (const [id, patch] of Object.entries(slide.overrides)) {
      check(slide.nodeIds.includes(id) && object(patch), "Invalid local override.");
      check(Object.keys(patch).every((key) => ["frame", "variantFrames", "appearance", "crop", "text", "opacity"].includes(key)), "A local override cannot replace layer identity.");
      const kind = project.nodes[id].kind;
      check(kind !== "legacy-image" || Object.keys(patch).length === 0, "Legacy overrides belong in their operation record.");
      check(patch.text == null || kind === "text", "Only captions support text overrides.");
      check((patch.crop == null && patch.appearance == null) || kind === "image", "Only photos support crop and appearance overrides.");
      if (patch.frame) validateFrame(patch.frame);
      if (patch.variantFrames != null) validateVariantFrames(patch.variantFrames, project.variants);
      if (patch.appearance) appearance(patch.appearance);
      if (patch.crop) validateCrop(patch.crop);
      if (patch.opacity != null) check(number(patch.opacity, 0, 1), "Invalid local opacity.");
      if (patch.text != null) check(typeof patch.text === "string" && patch.text.length <= 5000, "Invalid local caption.");
    }
  }
  const componentDefinitions = new Map(), componentInstanceMembers = new Map(), componentSets = new Map();
  for (const [id, node] of Object.entries(project.nodes)) {
      keys(node, ["id", "kind", "name", "visible", "locked", "assetId", "maskId", "fontId", "order", "operations", "frame", "variantFrames", "space", "anchorSlideId", "parentId", "constraints", "layoutPositioning", "flowGrid", "flowSizing", "layoutSizing", "layoutSize", "layoutMinMax", "gridPlacement", "gridAlignment", "componentDefinition", "componentInstanceOf", "componentSourceNodeId", "componentOverrides", "componentSetId", "componentSetName", "variantProperties", "opacity", "rotation", "flipX", "flipY", "appearance", "appearanceBase", "crop", "text", "style", "color", "fit", "focal", "depthTextId", "depthBackground", "connection", "cutoutEffects", "attachment"]);
      check(identifier(id) && node.id === id && ["legacy-image", "image", "text", "shape", "frame"].includes(node.kind), "Unsupported layer kind.");
    if (node.componentDefinition != null) {
      check(node.componentDefinition === true && node.space === "slide" && node.componentInstanceOf == null && node.componentSourceNodeId == null,
        "Invalid component definition.");
      let parentId = node.parentId;
      while (parentId) {
        const parent = project.nodes[parentId];
        check(!parent.componentDefinition && !parent.componentInstanceOf, "Nested component definitions are not supported.");
        parentId = parent.parentId;
      }
      componentDefinitions.set(node.id, [node.id]);
    }
    if (node.componentSetId != null) {
      check(node.componentDefinition === true && identifier(node.componentSetId) && typeof node.componentSetName === "string"
        && Boolean(node.componentSetName.trim()) && node.componentSetName.length <= 120, "Invalid component set.");
      check(object(node.variantProperties) && Object.keys(node.variantProperties).length > 0 && Object.keys(node.variantProperties).length <= 20,
        "A component variant needs bounded properties.");
      for (const [name, value] of Object.entries(node.variantProperties))
        check(/^[A-Za-z][A-Za-z0-9 _-]{0,79}$/.test(name) && typeof value === "string" && Boolean(value.trim()) && value.length <= 120,
          "Invalid component variant property.");
      componentSets.set(node.componentSetId, [...(componentSets.get(node.componentSetId) ?? []), node]);
    } else check(node.componentSetName == null && node.variantProperties == null, "Variant properties require a component set.");
    if (node.componentInstanceOf != null) {
      const source = project.nodes[node.componentInstanceOf];
      check(node.space === "slide" && source?.componentDefinition === true && node.componentSourceNodeId === source.id,
        "Invalid component instance.");
    }
    let enclosingInstance = node;
    while (enclosingInstance && enclosingInstance.componentInstanceOf == null)
      enclosingInstance = enclosingInstance.parentId ? project.nodes[enclosingInstance.parentId] : null;
    if (enclosingInstance && enclosingInstance.id !== node.id)
      check(node.componentSourceNodeId != null, "Every layer inside a component instance must mirror its definition layer.");
    if (node.componentSourceNodeId != null) {
      const source = project.nodes[node.componentSourceNodeId];
      check(identifier(node.componentSourceNodeId) && source && source.kind === node.kind && node.space === "slide",
        "Invalid component source layer.");
      let instanceRoot = node, ownerId = null;
      while (instanceRoot) {
        if (instanceRoot.componentInstanceOf != null) { ownerId = instanceRoot.id; break; }
        instanceRoot = instanceRoot.parentId ? project.nodes[instanceRoot.parentId] : null;
      }
      let sourceParentId = source.id, sourceOwnerId = null;
      while (sourceParentId) {
        const sourceAncestor = project.nodes[sourceParentId];
        if (sourceAncestor.componentDefinition === true) { sourceOwnerId = sourceAncestor.id; break; }
        sourceParentId = sourceAncestor.parentId;
      }
      check(instanceRoot && sourceOwnerId === instanceRoot.componentInstanceOf,
        "A component instance layer must belong to its referenced definition.");
      componentInstanceMembers.set(instanceRoot.id, [...(componentInstanceMembers.get(instanceRoot.id) ?? []), node]);
      if (node.id === instanceRoot.id) {
        check(source.id === instanceRoot.componentInstanceOf && node.parentId === source.parentId,
          "A component instance root must mirror its definition's parent.");
      } else check(source.parentId != null && project.nodes[node.parentId]?.componentSourceNodeId === source.parentId,
        "A component instance child must mirror its definition's parent.");
      if (node.componentOverrides != null) {
        check(Array.isArray(node.componentOverrides) && node.componentOverrides.length <= COMPONENT_OVERRIDE_PATHS.size
          && new Set(node.componentOverrides).size === node.componentOverrides.length
          && node.componentOverrides.every((path) => COMPONENT_OVERRIDE_PATHS.has(path)), "Invalid component overrides.");
      }
    } else check(node.componentOverrides == null, "Component overrides require a component source layer.");
    if (node.componentInstanceOf == null && node.componentSourceNodeId == null)
      check(node.componentOverrides == null, "Component overrides require a component instance.");
    if (node.name != null) check(typeof node.name === "string" && node.name.trim().length > 0 && node.name.length <= 120, "Invalid layer name.");
    if (node.visible != null) check(typeof node.visible === "boolean", "Invalid layer visibility.");
    if (node.locked != null) check(typeof node.locked === "boolean", "Invalid layer lock state.");
    if (["legacy-image", "image"].includes(node.kind)) check(project.assets[node.assetId]?.kind === "image", "An image layer needs a source asset.");
    if (node.maskId != null) check(project.assets[node.maskId]?.kind === "mask", "A layer mask is missing.");
    if (node.fontId != null) check(project.assets[node.fontId]?.kind === "font", "A layer font is missing.");
    if (node.cutoutEffects != null) { check(node.kind === "image", "Only scene photos support cutout effects."); validateCutoutEffects(node.cutoutEffects); }
    if (node.attachment != null) {
      check(object(node.attachment), "Invalid photo decoration."); keys(node.attachment, ["schema", "imageId"]);
      const photo = project.nodes[node.attachment.imageId];
      check(node.kind === "shape" && node.attachment.schema === 1 && photo?.kind === "image", "A decoration must follow a scene photo.");
      check(node.space === photo.space && node.anchorSlideId === photo.anchorSlideId, "A decoration must share its photo's coordinate space.");
      for (const slide of project.slides) check(slide.nodeIds.includes(id) === slide.nodeIds.includes(photo.id), "A decoration must share its photo's slides.");
    }
    if (node.connection != null) {
      const connection = node.connection, left = project.slides.findIndex((slide) => slide.id === node.anchorSlideId);
      check(object(connection), "Invalid connected cutout."); keys(connection, ["schema", "rightSlideId"]);
      check(node.kind === "image" && node.space === "story" && connection.schema === 1 && left >= 0
        && project.slides[left + 1]?.id === connection.rightSlideId, "A connected cutout needs two neighboring slides.");
      for (const slide of project.slides) {
        check(slide.nodeIds.includes(id) === [node.anchorSlideId, connection.rightSlideId].includes(slide.id), "Both connected slides must share the same cutout.");
        for (const linked of [id, node.depthTextId].filter(Boolean)) check(!Object.keys(slide.overrides[linked] ?? {}).length, "Connected cutout edits must apply to both slides.");
      }
    }
    if (node.depthTextId != null || node.depthBackground != null) {
      const title = project.nodes[node.depthTextId];
      check(node.kind === "image" && title?.kind === "text" && ["photo", "page"].includes(node.depthBackground), "A depth title needs a photo, text layer and background choice.");
      check(title.style?.fontBasis === "width", "Depth title text size is relative to the photo width.");
      check(title.space === node.space && title.anchorSlideId === node.anchorSlideId, "A depth title must follow its photo's coordinate space.");
      check(Object.values(project.nodes).filter((other) => other.depthTextId === title.id).length === 1, "A depth title belongs to one photo.");
      for (const slide of project.slides) {
        const photoIndex = slide.nodeIds.indexOf(id), titleIndex = slide.nodeIds.indexOf(title.id);
        check(photoIndex < 0 ? titleIndex < 0 : titleIndex === photoIndex + 1, "A depth title must immediately follow its photo on each shared slide.");
      }
    }
    if (node.appearance) appearance(node.appearance);
    if (node.appearanceBase != null) { check(node.kind === "image", "Only scene photos support a scoped look."); appearance(node.appearanceBase); }
    if (node.kind === "legacy-image") {
      check(node.variantFrames == null, "Legacy image dimensions belong in their operation record.");
      check(canonicalJSON(node.order) === canonicalJSON(LEGACY_ORDER), "Unknown legacy transform order.");
      validateLegacyOperations(node.operations);
    } else {
      validateFrame(node.frame);
      if (node.variantFrames != null) validateVariantFrames(node.variantFrames, project.variants);
      check(["slide", "story"].includes(node.space), "Unknown coordinate space.");
      if (node.space === "story") check(project.slides.some((slide) => slide.id === node.anchorSlideId), "A connected layer needs its anchor slide.");
      if (node.parentId != null) {
        check(identifier(node.parentId) && node.parentId !== id && node.kind !== "legacy-image", "Invalid frame parent.");
        check(node.space === "slide" && project.nodes[node.parentId]?.kind === "frame" && project.nodes[node.parentId].space === "slide",
          "A nested layer must belong to a frame on the same page.");
        check(object(node.constraints), "A nested layer needs frame constraints.");
        keys(node.constraints, ["horizontal", "vertical"]);
        check(["left", "right", "left-right", "center", "scale"].includes(node.constraints.horizontal)
          && ["top", "bottom", "top-bottom", "center", "scale"].includes(node.constraints.vertical), "Invalid frame constraints.");
      } else check(node.constraints == null, "Frame constraints require a parent frame.");
      if (node.layoutPositioning != null)
        check(node.layoutPositioning === "absolute" && node.parentId != null && Boolean(project.nodes[node.parentId]?.style?.layout),
          "Absolute positioning requires a child of an Auto Layout frame.");
      if (node.flowGrid != null) {
        check(node.layoutPositioning === "absolute" && project.nodes[node.parentId]?.style?.layout?.direction === "grid"
          && object(node.flowGrid), "Saved grid placement requires an absolute child of a grid frame.");
        keys(node.flowGrid, ["placement", "alignment"]);
        if (node.flowGrid.placement != null) {
          const placement = node.flowGrid.placement;
          check(object(placement), "Invalid saved grid placement.");
          keys(placement, ["row", "column", "rowSpan", "columnSpan"]);
          check(Number.isInteger(placement.row) && placement.row >= 1 && placement.row <= 200
            && Number.isInteger(placement.column) && placement.column >= 1 && placement.column <= 24
            && Number.isInteger(placement.rowSpan) && placement.rowSpan >= 1 && placement.rowSpan <= 200
            && Number.isInteger(placement.columnSpan) && placement.columnSpan >= 1 && placement.columnSpan <= 24,
          "Invalid saved grid placement.");
        }
        if (node.flowGrid.alignment != null) {
          check(object(node.flowGrid.alignment), "Invalid saved grid alignment.");
          keys(node.flowGrid.alignment, ["horizontal", "vertical"]);
          check(Object.keys(node.flowGrid.alignment).length > 0
            && Object.values(node.flowGrid.alignment).every((alignment) => ["start", "center", "end"].includes(alignment)),
          "Invalid saved grid alignment.");
        }
      }
      if (node.flowSizing != null) {
        check(node.layoutPositioning === "absolute" && object(node.flowSizing), "Saved Auto Layout sizing requires an absolute child.");
        keys(node.flowSizing, ["width", "height"]);
        check(Object.values(node.flowSizing).every((mode) => ["fixed", "fill", "hug"].includes(mode)), "Invalid saved Auto Layout sizing.");
      }
      if (node.gridPlacement != null) {
        const parentLayout = project.nodes[node.parentId]?.style?.layout;
        check(node.layoutPositioning !== "absolute" && node.parentId != null && parentLayout?.direction === "grid" && object(node.gridPlacement), "Grid placement requires a flow child of a grid frame.");
        keys(node.gridPlacement, ["row", "column", "rowSpan", "columnSpan"]);
        check(Number.isInteger(node.gridPlacement.row) && node.gridPlacement.row >= 1 && node.gridPlacement.row <= 200
          && Number.isInteger(node.gridPlacement.column) && node.gridPlacement.column >= 1 && node.gridPlacement.column <= (parentLayout?.columns ?? 0)
          && Number.isInteger(node.gridPlacement.rowSpan) && node.gridPlacement.rowSpan >= 1 && node.gridPlacement.rowSpan <= 200
          && Number.isInteger(node.gridPlacement.columnSpan) && node.gridPlacement.columnSpan >= 1
          && node.gridPlacement.column + node.gridPlacement.columnSpan - 1 <= parentLayout.columns
          && node.gridPlacement.columnSpan <= parentLayout.columns
          && node.gridPlacement.row + node.gridPlacement.rowSpan - 1 <= 200
          && (!parentLayout.rows || node.gridPlacement.row + node.gridPlacement.rowSpan - 1 <= parentLayout.rows), "Invalid grid placement.");
      }
      if (node.gridAlignment != null) {
        const parentLayout = project.nodes[node.parentId]?.style?.layout;
        check(node.layoutPositioning !== "absolute" && node.parentId != null && parentLayout?.direction === "grid" && object(node.gridAlignment), "Grid alignment requires a flow child of a grid frame.");
        keys(node.gridAlignment, ["horizontal", "vertical"]);
        check(Object.keys(node.gridAlignment).length > 0
          && Object.values(node.gridAlignment).every((alignment) => ["start", "center", "end"].includes(alignment)), "Invalid grid alignment.");
      }
      if (node.layoutSizing != null) {
        check(object(node.layoutSizing), "Invalid layer resizing settings."); keys(node.layoutSizing, ["width", "height"]);
        for (const mode of Object.values(node.layoutSizing)) {
          check(["fixed", "fill", "hug"].includes(mode), "Invalid layer resizing mode.");
          if (mode === "fill") check(node.parentId != null && project.nodes[node.parentId]?.style?.layout,
            "Fill sizing requires a child of an Auto Layout frame.");
          if (mode === "hug") check(node.kind === "frame" && node.style?.layout,
            "Hug sizing requires an Auto Layout frame.");
        }
      }
      if (node.layoutSize != null) {
        check(object(node.layoutSize), "Invalid fixed layer size."); keys(node.layoutSize, ["width", "height"]);
        check(number(node.layoutSize.width, .01, 16384) && number(node.layoutSize.height, .01, 16384), "Invalid fixed layer size.");
      }
      if (node.layoutMinMax != null) {
        const bounds = node.layoutMinMax, parentLayout = node.parentId && project.nodes[node.parentId]?.style?.layout;
        check(object(bounds) && parentLayout, "Min/max sizing requires an Auto Layout child.");
        keys(bounds, ["minWidth", "maxWidth", "minHeight", "maxHeight"]);
        for (const value of Object.values(bounds)) check(number(value, .01, 16384), "Invalid Auto Layout size limit.");
        for (const axis of ["Width", "Height"]) {
          const minimum = bounds[`min${axis}`], maximum = bounds[`max${axis}`];
          check(minimum == null || maximum == null || minimum <= maximum, "Auto Layout minimum size cannot exceed its maximum.");
        }
        check(Object.keys(bounds).length > 0, "Auto Layout size limits cannot be empty.");
      }
      if (node.opacity != null) check(number(node.opacity, 0, 1), "Invalid opacity.");
      if (node.rotation != null) check(number(node.rotation, -360, 360), "Invalid rotation.");
      for (const key of ["flipX", "flipY"]) if (node[key] != null) check(node.kind === "image" && typeof node[key] === "boolean", `Invalid image ${key} transform.`);
      if (node.kind === "text") check(typeof node.text === "string" && node.text.length <= 5000, "Invalid caption.");
      if (node.crop) validateCrop(node.crop);
      validateNodeStyle(node);
    }
  }
  for (const node of Object.values(project.nodes)) {
    if (node.componentDefinition) continue;
    let parent = node.parentId ? project.nodes[node.parentId] : null;
    while (parent) {
      if (parent.componentDefinition) {
        componentDefinitions.set(parent.id, [...(componentDefinitions.get(parent.id) ?? []), node.id]);
        break;
      }
      parent = parent.parentId ? project.nodes[parent.parentId] : null;
    }
  }
  for (const [instanceId, members] of componentInstanceMembers) {
    const definitionId = project.nodes[instanceId]?.componentInstanceOf, expected = componentDefinitions.get(definitionId) ?? [];
    const sourceIds = members.map((node) => node.componentSourceNodeId);
    check(sourceIds.length === expected.length && new Set(sourceIds).size === expected.length
      && expected.every((sourceId) => sourceIds.includes(sourceId)),
    "A component instance must contain every definition layer exactly once.");
  }
  for (const variants of componentSets.values()) {
    const first = variants[0], propertyNames = Object.keys(first.variantProperties).sort(), combinations = variants.map((node) => canonicalJSON(node.variantProperties));
    check(variants.length >= 2 && new Set(combinations).size === variants.length
      && variants.every((node) => node.componentSetName === first.componentSetName
        && canonicalJSON(Object.keys(node.variantProperties).sort()) === canonicalJSON(propertyNames)),
    "A component set needs matching properties and unique variant combinations.");
  }
  for (const slide of project.slides) for (const id of slide.nodeIds) {
    const parent = project.nodes[id], layout = parent?.kind === "frame" ? parent.style?.layout : null;
    if (layout?.direction !== "grid") continue;
    const children = slide.nodeIds.filter((childId) => project.nodes[childId]?.parentId === id && project.nodes[childId]?.visible !== false);
    gridPlacementsForChildren(children, project.nodes, layout);
  }
  for (const [id, node] of Object.entries(project.nodes)) {
    const seen = new Set([id]); let parentId = node.parentId, depth = 0;
    while (parentId != null) {
      check(!seen.has(parentId) && ++depth <= 12, "Frame nesting contains a cycle or is too deep.");
      seen.add(parentId); parentId = project.nodes[parentId]?.parentId;
    }
  }
  for (const slide of project.slides) for (const id of slide.nodeIds) {
    const node = project.nodes[id];
    if (node.parentId == null) continue;
    const parentIndex = slide.nodeIds.indexOf(node.parentId);
    check(parentIndex >= 0 && parentIndex < slide.nodeIds.indexOf(id), "A frame must appear before its child layers on the page.");
  }
  return project;
}

export function createLegacyProject({ id = newId("project"), files, operations, name = "Untitled edit", seed = 1, createdAt = Date.now() }) {
  const project = { kind: PROJECT_KIND, version: PROJECT_VERSION, id, revision: 0, name, createdAt, seed,
    engine: { ...ENGINE_IDENTITY }, models: [], recipe: null, assets: {}, nodes: {}, slides: [], shared: { appearance: {} },
    variants: [{ id: "original", width: 1, height: 1, policy: "legacy-operation-dimensions" }] };
  files.forEach((file, index) => {
    const assetId = file.assetId ?? newId("asset"), nodeId = file.nodeId ?? newId("layer"), slideId = file.slideId ?? newId("slide");
    project.assets[assetId] = { id: assetId, kind: "image", name: file.name, type: file.type || "application/octet-stream",
      byteLength: file.size ?? file.bytes?.byteLength ?? 0, sha256: file.sha256 ?? null, width: file.width ?? null, height: file.height ?? null,
      orientation: "exif-to-upright", lastModified: file.lastModified ?? 0 };
    project.nodes[nodeId] = { id: nodeId, kind: "legacy-image", assetId, order: [...LEGACY_ORDER], operations: clone(operations[index]) };
    project.slides.push({ id: slideId, name: file.name, nodeIds: [nodeId], overrides: {} });
  });
  return validateProject(project);
}

export function createSceneProject({ id = newId("project"), name = "Untitled story", assets = {}, nodes = {}, slides,
  variants = [{ id: "portrait", width: 1080, height: 1350 }, { id: "tall", width: 1080, height: 1920 }], seed = 1, createdAt = Date.now() }) {
  return validateProject({ kind: PROJECT_KIND, version: PROJECT_VERSION, id, revision: 0, name, createdAt, seed,
    engine: clone(ENGINE_IDENTITY), models: [], recipe: null, assets: clone(assets), nodes: clone(nodes),
    slides: clone(slides ?? [{ id: newId("slide"), nodeIds: Object.keys(nodes), overrides: {} }]), shared: { appearance: {} }, variants: clone(variants) });
}

function intrinsicFrameSize(project, slide, nodeId, variant, stack = new Set()) {
  const node = project.nodes[nodeId], layout = node?.style?.layout;
  const fallback = { width: node?.layoutSize?.width ?? (node?.frame?.width ?? 0) * variant.width,
    height: node?.layoutSize?.height ?? (node?.frame?.height ?? 0) * variant.height };
  if (!layout || stack.has(nodeId)) return fallback;
  const nextStack = new Set(stack); nextStack.add(nodeId);
  const childIds = slide.nodeIds.filter((id) => project.nodes[id]?.parentId === nodeId && project.nodes[id]?.visible !== false
    && project.nodes[id]?.layoutPositioning !== "absolute");
  const children = childIds.map((id) => {
    const child = project.nodes[id], patch = slide.overrides[id] ?? {};
    const frame = patch.variantFrames?.[variant.id] ?? patch.frame ?? child.variantFrames?.[variant.id] ?? child.frame;
    const own = child.kind === "frame" && child.style?.layout
      ? intrinsicFrameSize(project, slide, id, variant, nextStack)
      : { width: child.layoutSize?.width ?? frame.width * fallback.width,
        height: child.layoutSize?.height ?? frame.height * fallback.height };
    return { id, ...constrainLayoutSize(child,
      child.layoutSizing?.width === "hug" ? own.width : child.layoutSize?.width ?? frame.width * fallback.width,
      child.layoutSizing?.height === "hug" ? own.height : child.layoutSize?.height ?? frame.height * fallback.height) };
  });
  const padding = { top: 0, right: 0, bottom: 0, left: 0, ...layout.padding };
  if (layout.direction === "grid") {
    const { placements, rows } = gridPlacementsForChildren(childIds, project.nodes, layout), columns = layout.columns;
    const rowGap = layout.rowGap ?? layout.gap ?? 0, columnGap = layout.columnGap ?? layout.gap ?? 0;
    const columnSizes = gridTrackSizes(layout, "columns", columns, null, children, placements, columnGap, true);
    const rowSizes = gridTrackSizes(layout, "rows", rows, null, children, placements, rowGap, true);
    const widthMode = node.layoutSizing?.width ?? "fixed", heightMode = node.layoutSizing?.height ?? "fixed";
    const hasFillWidth = childIds.some((id) => project.nodes[id].layoutSizing?.width === "fill");
    const hasFillHeight = childIds.some((id) => project.nodes[id].layoutSizing?.height === "fill");
    const width = columnSizes.reduce((sum, value) => sum + value, 0) + columnGap * Math.max(0, columns - 1) + padding.left + padding.right;
    const height = rowSizes.reduce((sum, value) => sum + value, 0) + rowGap * Math.max(0, rows - 1) + padding.top + padding.bottom;
    return { width: widthMode === "hug" && !hasFillWidth ? width : fallback.width,
      height: heightMode === "hug" && !hasFillHeight ? height : fallback.height };
  }
  const horizontal = layout.direction === "horizontal", mainGap = horizontal ? (layout.columnGap ?? layout.gap ?? 0) : (layout.rowGap ?? layout.gap ?? 0);
  const crossGap = horizontal ? (layout.rowGap ?? layout.gap ?? 0) : (layout.columnGap ?? layout.gap ?? 0);
  const mainValues = children.map((child) => horizontal ? child.width : child.height);
  const crossValues = children.map((child) => horizontal ? child.height : child.width);
  const mainPadding = horizontal ? padding.left + padding.right : padding.top + padding.bottom;
  const crossPadding = horizontal ? padding.top + padding.bottom : padding.left + padding.right;
  const flowMain = mainValues.reduce((sum, value) => sum + value, 0) + mainGap * Math.max(0, children.length - 1) + mainPadding;
  let flowCross = Math.max(0, ...crossValues) + crossPadding;
  const mainMode = node.layoutSizing?.[horizontal ? "width" : "height"] ?? "fixed";
  const fixedMain = node.layoutSize?.[horizontal ? "width" : "height"];
  if (layout.wrap && fixedMain != null && mainMode !== "hug") {
    const mainAvailable = Math.max(0, fixedMain - mainPadding), lines = [];
    let line = [], occupied = 0, lineCross = 0;
    for (let index = 0; index < children.length; index++) {
      const size = mainValues[index], cross = crossValues[index], addition = size + (line.length ? mainGap : 0);
      if (line.length && occupied + addition > mainAvailable) { lines.push(lineCross); line = []; occupied = 0; lineCross = 0; }
      line.push(index); occupied += size + (line.length > 1 ? mainGap : 0); lineCross = Math.max(lineCross, cross);
    }
    if (line.length) lines.push(lineCross);
    flowCross = lines.reduce((sum, value) => sum + value, 0) + crossGap * Math.max(0, lines.length - 1) + crossPadding;
  }
  const widthMode = node.layoutSizing?.width ?? "fixed", heightMode = node.layoutSizing?.height ?? "fixed";
  const hasFillWidth = childIds.some((id) => project.nodes[id].layoutSizing?.width === "fill");
  const hasFillHeight = childIds.some((id) => project.nodes[id].layoutSizing?.height === "fill");
  const widthIsHug = widthMode === "hug" && !hasFillWidth, heightIsHug = heightMode === "hug" && !hasFillHeight;
  if (horizontal) return { width: widthIsHug ? flowMain : fallback.width, height: heightIsHug ? flowCross : fallback.height };
  return { width: widthIsHug ? flowCross : fallback.width, height: heightIsHug ? flowMain : fallback.height };
}

function layoutChildren(project, slide, parentId, parentFrame, variant, layout) {
  const childIds = slide.nodeIds.filter((id) => project.nodes[id]?.parentId === parentId && project.nodes[id]?.visible !== false), result = new Map();
  const flowChildIds = childIds.filter((id) => project.nodes[id]?.layoutPositioning !== "absolute");
  const absoluteChildIds = childIds.filter((id) => project.nodes[id]?.layoutPositioning === "absolute");
  const parentWidth = parentFrame.width * variant.width, parentHeight = parentFrame.height * variant.height;
  if (!childIds.length || parentWidth <= 0 || parentHeight <= 0) return result;
  const padding = { top: 0, right: 0, bottom: 0, left: 0, ...layout.padding };
  for (const id of absoluteChildIds) {
    const node = project.nodes[id], patch = slide.overrides[id] ?? {};
    const frame = patch.variantFrames?.[variant.id] ?? patch.frame ?? node.variantFrames?.[variant.id] ?? node.frame;
    const intrinsic = node.kind === "frame" && node.style?.layout ? intrinsicFrameSize(project, slide, id, variant) : { width: 0, height: 0 };
    const widthMode = node.layoutSizing?.width ?? "fixed", heightMode = node.layoutSizing?.height ?? "fixed";
    const rawWidth = widthMode === "hug" ? intrinsic.width
      : widthMode === "fill" ? Math.max(.01, parentWidth * (1 - frame.x) - padding.right)
        : node.layoutSize?.width ?? frame.width * parentWidth;
    const rawHeight = heightMode === "hug" ? intrinsic.height
      : heightMode === "fill" ? Math.max(.01, parentHeight * (1 - frame.y) - padding.bottom)
        : node.layoutSize?.height ?? frame.height * parentHeight;
    const { width, height } = constrainLayoutSize(node, rawWidth, rawHeight);
    result.set(id, { x: frame.x, y: frame.y, width: width / parentWidth, height: height / parentHeight });
  }
  if (!flowChildIds.length) return result;
  if (layout.direction === "grid") {
    const columns = layout.columns, { placements, rows } = gridPlacementsForChildren(flowChildIds, project.nodes, layout);
    const rowGap = layout.rowGap ?? layout.gap ?? 0, columnGap = layout.columnGap ?? layout.gap ?? 0;
    const availableWidth = Math.max(0, parentWidth - padding.left - padding.right - columnGap * (columns - 1));
    const availableHeight = Math.max(0, parentHeight - padding.top - padding.bottom - rowGap * (rows - 1));
    const children = flowChildIds.map((id) => {
      const node = project.nodes[id], patch = slide.overrides[id] ?? {};
      const frame = patch.variantFrames?.[variant.id] ?? patch.frame ?? node.variantFrames?.[variant.id] ?? node.frame;
      const intrinsic = node.kind === "frame" && node.style?.layout ? intrinsicFrameSize(project, slide, id, variant) : { width: 0, height: 0 };
      return { id, ...constrainLayoutSize(node,
        node.layoutSizing?.width === "hug" ? intrinsic.width : node.layoutSize?.width ?? frame.width * parentWidth,
        node.layoutSizing?.height === "hug" ? intrinsic.height : node.layoutSize?.height ?? frame.height * parentHeight) };
    });
    const childrenById = new Map(children.map((child) => [child.id, child]));
    const widths = gridTrackSizes(layout, "columns", columns, availableWidth, children, placements, columnGap);
    const heights = gridTrackSizes(layout, "rows", rows, availableHeight, children, placements, rowGap);
    for (const id of flowChildIds) {
      const node = project.nodes[id], child = childrenById.get(id), placement = placements.get(id);
      const cellWidth = widths.slice(placement.column - 1, placement.column - 1 + placement.columnSpan).reduce((sum, size) => sum + size, 0)
        + columnGap * (placement.columnSpan - 1);
      const cellHeight = heights.slice(placement.row - 1, placement.row - 1 + placement.rowSpan).reduce((sum, size) => sum + size, 0)
        + rowGap * (placement.rowSpan - 1);
      const alignX = node.gridAlignment?.horizontal ?? layout.justify;
      const alignY = node.gridAlignment?.vertical ?? layout.align;
      const stretchX = alignX === "stretch" || node.layoutSizing?.width === "fill";
      const stretchY = alignY === "stretch" || node.layoutSizing?.height === "fill";
      const bounded = constrainLayoutSize(node,
        Math.max(.01, stretchX ? cellWidth : Math.min(child.width, cellWidth)),
        Math.max(.01, stretchY ? cellHeight : Math.min(child.height, cellHeight)));
      const childWidth = bounded.width, childHeight = bounded.height;
      const freeX = Math.max(0, cellWidth - childWidth), freeY = Math.max(0, cellHeight - childHeight);
      const offsetX = alignX === "center" ? freeX / 2 : alignX === "end" ? freeX : 0;
      const offsetY = alignY === "center" ? freeY / 2 : alignY === "end" ? freeY : 0;
      const x = padding.left + widths.slice(0, placement.column - 1).reduce((sum, size) => sum + size, 0)
        + columnGap * (placement.column - 1) + offsetX;
      const y = padding.top + heights.slice(0, placement.row - 1).reduce((sum, size) => sum + size, 0)
        + rowGap * (placement.row - 1) + offsetY;
      result.set(id, { x: x / parentWidth, y: y / parentHeight, width: childWidth / parentWidth, height: childHeight / parentHeight });
    }
    return result;
  }
  const horizontal = layout.direction === "horizontal", mainExtent = horizontal ? parentWidth : parentHeight;
  const crossExtent = horizontal ? parentHeight : parentWidth;
  const mainStart = horizontal ? padding.left : padding.top, mainEnd = horizontal ? padding.right : padding.bottom;
  const crossStart = horizontal ? padding.top : padding.left, crossEnd = horizontal ? padding.bottom : padding.right;
  const mainAvailable = Math.max(0, mainExtent - mainStart - mainEnd), crossAvailable = Math.max(0, crossExtent - crossStart - crossEnd);
  const mainGap = horizontal ? (layout.columnGap ?? layout.gap ?? 0) : (layout.rowGap ?? layout.gap ?? 0);
  const crossGap = horizontal ? (layout.rowGap ?? layout.gap ?? 0) : (layout.columnGap ?? layout.gap ?? 0);
  const records = flowChildIds.map((id) => {
    const node = project.nodes[id], patch = slide.overrides[id] ?? {};
    const frame = patch.variantFrames?.[variant.id] ?? patch.frame ?? node.variantFrames?.[variant.id] ?? node.frame;
    const size = node.kind === "frame" && node.style?.layout ? intrinsicFrameSize(project, slide, id, variant)
      : { width: 0, height: 0 };
    const { width, height } = constrainLayoutSize(node,
      node.layoutSizing?.width === "hug" ? size.width : node.layoutSize?.width ?? frame.width * parentWidth,
      node.layoutSizing?.height === "hug" ? size.height : node.layoutSize?.height ?? frame.height * parentHeight);
    return { id, node, width, height, main: horizontal ? width : height, cross: horizontal ? height : width,
      mainSizing: node.layoutSizing?.[horizontal ? "width" : "height"] ?? "fixed",
      crossSizing: node.layoutSizing?.[horizontal ? "height" : "width"] ?? "fixed" };
  });
  const lines = []; let line = [], occupied = 0, lineCross = 0;
  for (const item of records) {
    const addition = item.main + (line.length ? mainGap : 0);
    if (layout.wrap && line.length && occupied + addition > mainAvailable) {
      lines.push({ items: line, cross: lineCross }); line = []; occupied = 0; lineCross = 0;
    }
    line.push(item); occupied += item.main + (line.length > 1 ? mainGap : 0); lineCross = Math.max(lineCross, item.cross);
  }
  if (line.length) lines.push({ items: line, cross: lineCross });
  const align = layout.align ?? "center", justify = layout.justify ?? "start";
  let crossCursor = crossStart;
  for (const row of lines) {
    const lineCrossExtent = layout.wrap ? row.cross : crossAvailable;
    const fillItems = row.items.filter((item) => item.mainSizing === "fill");
    const fillCount = fillItems.length;
    const fixedMain = row.items.filter((item) => item.mainSizing !== "fill").reduce((sum, item) => sum + item.main, 0);
    const fillSizes = distributeFillSizes(fillItems,
      mainAvailable - fixedMain - mainGap * Math.max(0, row.items.length - 1), horizontal ? "Width" : "Height");
    const mainSizes = row.items.map((item) => item.mainSizing === "fill" ? fillSizes.get(item.id) : item.main);
    const occupiedMain = mainSizes.reduce((sum, value) => sum + value, 0) + mainGap * Math.max(0, row.items.length - 1);
    const free = Math.max(0, mainAvailable - occupiedMain);
    const distributable = !fillCount && row.items.length > 0;
    const extraGap = distributable && justify === "space-between" && row.items.length > 1 ? free / (row.items.length - 1)
      : distributable && justify === "space-around" ? free / row.items.length
        : distributable && justify === "space-evenly" ? free / (row.items.length + 1) : 0;
    const offset = justify === "center" ? free / 2 : justify === "end" ? free
      : justify === "space-around" && row.items.length ? extraGap / 2
        : justify === "space-evenly" && row.items.length ? extraGap : 0;
    const effectiveGap = mainGap + extraGap;
    let mainCursor = mainStart + offset;
    row.items.forEach((item, index) => {
      const stretch = align === "stretch" || item.crossSizing === "fill";
      const crossSize = constrainLayoutSize(item.node, horizontal ? mainSizes[index] : (stretch ? lineCrossExtent : item.cross),
        horizontal ? (stretch ? lineCrossExtent : item.cross) : mainSizes[index]);
      const childCross = horizontal ? crossSize.height : crossSize.width;
      const crossOffset = align === "center" && !stretch ? Math.max(0, (lineCrossExtent - childCross) / 2)
        : align === "end" && !stretch ? Math.max(0, lineCrossExtent - childCross) : 0;
      const x = horizontal ? mainCursor : crossCursor + crossOffset, y = horizontal ? crossCursor + crossOffset : mainCursor;
      const width = horizontal ? mainSizes[index] : childCross, height = horizontal ? childCross : mainSizes[index];
      result.set(item.id, { x: x / parentWidth, y: y / parentHeight, width: width / parentWidth, height: height / parentHeight });
      mainCursor += mainSizes[index] + effectiveGap;
    });
    crossCursor += lineCrossExtent + crossGap;
  }
  return result;
}

function layerFrameMap(project, slideId, variantId) {
  const slideIndex = project.slides.findIndex((slide) => slide.id === slideId), slide = project.slides[slideIndex];
  const variant = project.variants.find((entry) => entry.id === variantId), cache = new Map(), layoutCache = new Map();
  check(slide && variant, "Missing slide or output variant.");
  const resolve = (id) => {
    if (cache.has(id)) return cache.get(id);
    const source = project.nodes[id], patch = slide.overrides[id] ?? {};
    if (!source || source.kind === "legacy-image") return null;
    let frame = clone(patch.variantFrames?.[variant.id] ?? patch.frame ?? source.variantFrames?.[variant.id] ?? source.frame);
    if (source.parentId) {
      const parent = resolve(source.parentId), parentNode = project.nodes[source.parentId];
      if (parentNode.style?.layout) {
        if (!layoutCache.has(source.parentId)) layoutCache.set(source.parentId,
          layoutChildren(project, slide, source.parentId, parent.frame, variant, parentNode.style.layout));
        frame = layoutCache.get(source.parentId).get(id) ?? frame;
      } else if (source.kind === "frame" && source.style?.layout) {
        const intrinsic = intrinsicFrameSize(project, slide, id, variant), parentWidth = parent.frame.width * variant.width;
        const parentHeight = parent.frame.height * variant.height, widthMode = source.layoutSizing?.width ?? "fixed";
        const heightMode = source.layoutSizing?.height ?? "fixed";
        if (widthMode === "hug") frame.width = intrinsic.width / parentWidth;
        else if (source.layoutSize?.width != null) frame.width = source.layoutSize.width / parentWidth;
        if (heightMode === "hug") frame.height = intrinsic.height / parentHeight;
        else if (source.layoutSize?.height != null) frame.height = source.layoutSize.height / parentHeight;
      }
      const width = frame.width * parent.frame.width, height = frame.height * parent.frame.height;
      const parentCenterX = (parent.frame.x + parent.frame.width / 2) * variant.width;
      const parentCenterY = (parent.frame.y + parent.frame.height / 2) * variant.height;
      const offsetX = (frame.x + frame.width / 2 - .5) * parent.frame.width * variant.width;
      const offsetY = (frame.y + frame.height / 2 - .5) * parent.frame.height * variant.height;
      const angle = parent.rotation * Math.PI / 180, cosine = Math.cos(angle), sine = Math.sin(angle);
      const centerX = parentCenterX + offsetX * cosine - offsetY * sine;
      const centerY = parentCenterY + offsetX * sine + offsetY * cosine;
      frame.x = centerX / variant.width - width / 2; frame.y = centerY / variant.height - height / 2;
      frame.width = width; frame.height = height;
      const clipFrames = [...parent.clipFrames];
      if (parentNode.kind === "frame" && parentNode.style?.clipContent !== false) {
        clipFrames.push({ frame: clone(parent.frame), rotation: parent.rotation, radius: parentNode.style?.radius ?? 0 });
      }
      const resolved = { frame, rotation: parent.rotation + (source.rotation ?? 0), clipFrames,
        visible: parent.visible && source.visible !== false, locked: parent.locked || source.locked === true };
      cache.set(id, resolved); return resolved;
    }
    if (source.kind === "frame" && source.style?.layout) {
      const intrinsic = intrinsicFrameSize(project, slide, id, variant), hasFillWidth = slide.nodeIds.some((childId) => project.nodes[childId]?.parentId === id
        && project.nodes[childId].visible !== false
        && project.nodes[childId].layoutPositioning !== "absolute"
        && project.nodes[childId].layoutSizing?.width === "fill"), hasFillHeight = slide.nodeIds.some((childId) => project.nodes[childId]?.parentId === id
        && project.nodes[childId].visible !== false
        && project.nodes[childId].layoutPositioning !== "absolute"
        && project.nodes[childId].layoutSizing?.height === "fill");
      const widthMode = source.layoutSizing?.width ?? "fixed", heightMode = source.layoutSizing?.height ?? "fixed";
      if (widthMode === "hug" && !hasFillWidth) frame.width = intrinsic.width / variant.width;
      else if (source.layoutSize?.width != null) frame.width = source.layoutSize.width / variant.width;
      if (heightMode === "hug" && !hasFillHeight) frame.height = intrinsic.height / variant.height;
      else if (source.layoutSize?.height != null) frame.height = source.layoutSize.height / variant.height;
    }
    const anchor = source.space === "story" ? project.slides.findIndex((item) => item.id === source.anchorSlideId) - slideIndex : 0;
    frame.x += anchor;
    const resolved = { frame, rotation: source.rotation ?? 0, clipFrames: [], visible: source.visible !== false, locked: source.locked === true };
    cache.set(id, resolved); return resolved;
  };
  for (const id of slide.nodeIds) resolve(id);
  return { variant, frames: cache };
}

/** Resolve nested frame-local geometry to slide fractions without decoding or copying source assets. */
export function resolveLayerFrames(project, slideId, variantId = project.variants[0].id) {
  validateProject(project);
  const { variant, frames } = layerFrameMap(project, slideId, variantId);
  return new Map([...frames].map(([id, value]) => [id, { ...clone(value),
    clipFrames: value.clipFrames.map((clip) => ({ frame: { x: clip.frame.x * variant.width, y: clip.frame.y * variant.height,
      width: clip.frame.width * variant.width, height: clip.frame.height * variant.height }, rotation: clip.rotation, radius: clip.radius })) }]));
}

export function resolveSlide(project, slideId, variantId = project.variants[0].id) {
  validateProject(project);
  const slideIndex = project.slides.findIndex((slide) => slide.id === slideId), slide = project.slides[slideIndex];
  const variant = project.variants.find((entry) => entry.id === variantId);
  check(slide && variant, "Missing slide or output variant.");
  const resolvedFrames = layerFrameMap(project, slideId, variantId).frames;
  const nodes = slide.nodeIds.map((id) => {
    const source = project.nodes[id], patch = slide.overrides[id] ?? {};
    const node = { ...clone(source), ...clone(patch), appearance: { ...project.shared.appearance, ...source.appearanceBase, ...source.appearance, ...patch.appearance } };
    delete node.appearanceBase;
    if (node.assetId) node.asset = clone(project.assets[node.assetId]);
    if (node.maskId) node.mask = clone(project.assets[node.maskId]);
    if (node.fontId) node.font = clone(project.assets[node.fontId]);
    if (node.kind !== "legacy-image") {
      node.frame = clone(patch.variantFrames?.[variant.id] ?? patch.frame ?? source.variantFrames?.[variant.id] ?? source.frame);
      // Resolved render descriptions contain only this output's geometry.
      // Editing a different output shape must not invalidate this preview.
      delete node.variantFrames;
      const resolved = resolvedFrames.get(id);
      node.visible = resolved.visible;
      node.rotation = resolved.rotation;
      node.viewport = { x: resolved.frame.x * variant.width, y: resolved.frame.y * variant.height,
        width: resolved.frame.width * variant.width, height: resolved.frame.height * variant.height };
      node.clipFrames = resolved.clipFrames.map((clip) => ({ frame: { x: clip.frame.x * variant.width, y: clip.frame.y * variant.height,
        width: clip.frame.width * variant.width, height: clip.frame.height * variant.height }, rotation: clip.rotation, radius: clip.radius }));
    }
    return node;
  });
  // Photo-relative titles and decorations follow the resolved frame, including
  // local/output-specific placement and rotation. Stored coordinates stay local.
  const followPhoto = (title, photo, text = false) => {
    const local = title.frame, box = photo.viewport;
    const angle = (photo.rotation ?? 0) * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    const dx = (local.x + local.width / 2 - .5) * box.width, dy = (local.y + local.height / 2 - .5) * box.height;
    const w = local.width * box.width, h = local.height * box.height;
    title.viewport = { x: box.x + box.width / 2 + dx * cos - dy * sin - w / 2,
      y: box.y + box.height / 2 + dx * sin + dy * cos - h / 2, width: w, height: h };
    const anchor = title.space === "story" ? project.slides.findIndex((entry) => entry.id === title.anchorSlideId) - slideIndex : 0;
    title.frame = { x: title.viewport.x / variant.width - anchor, y: title.viewport.y / variant.height, width: w / variant.width, height: h / variant.height };
    title.rotation = (photo.rotation ?? 0) + (title.rotation ?? 0);
    if (text) title.style = { ...title.style, fontSize: (title.style?.fontSize ?? .05) * photo.frame.width,
      minFontSize: (title.style?.minFontSize ?? .012) * photo.frame.width, fontBasis: "width" };
  };
  for (const photo of nodes.filter((node) => node.depthTextId)) followPhoto(nodes.find((node) => node.id === photo.depthTextId), photo, true);
  for (const node of nodes.filter((node) => node.attachment)) followPhoto(node, nodes.find((photo) => photo.id === node.attachment.imageId));
  return { slideId, variant: clone(variant), nodes, seed: project.seed, engine: clone(project.engine), models: clone(project.models) };
}

export function affectedSlides(before, after) {
  const ids = new Set([...before.slides, ...after.slides].map((slide) => slide.id));
  const key = (project, id) => project.slides.some((slide) => slide.id === id)
    ? canonicalJSON(project.variants.map((variant) => resolveSlide(project, id, variant.id))) : null;
  return [...ids].filter((id) => key(before, id) !== key(after, id));
}
