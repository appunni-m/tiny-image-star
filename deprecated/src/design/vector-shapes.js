const SUPPORTED_SHAPES = new Set(["line", "arrow", "polygon", "star"]);

function rounded(value) { return Math.round(value * 1_000_000) / 1_000_000; }

function point(x, y) { return { x: rounded(x), y: rounded(y) }; }

function radialPoints(sides, innerRadius = null) {
  const points = [];
  const count = innerRadius == null ? sides : sides * 2;
  for (let index = 0; index < count; index++) {
    const radius = innerRadius == null || index % 2 === 0 ? .48 : .48 * innerRadius;
    const angle = -Math.PI / 2 + index * (innerRadius == null ? 2 : 1) * Math.PI / sides;
    points.push(point(.5 + Math.cos(angle) * radius, .5 + Math.sin(angle) * radius));
  }
  return points;
}

/** Return editable frame-relative geometry for the non-primitive shape tools. */
export function createVectorShape(shape, { sides, innerRadius = .46 } = {}) {
  if (!SUPPORTED_SHAPES.has(shape)) throw new Error("Choose a supported vector shape.");
  if (shape === "line") return {
    name: "Line", frame: { x: .35, y: .35, width: .3, height: .3 },
    path: { closed: false, points: [point(.1, .9), point(.9, .1)] }, strokeColor: "#5149d5", strokeWidth: .018,
  };
  if (shape === "arrow") return {
    name: "Arrow", frame: { x: .28, y: .38, width: .44, height: .24 },
    path: { closed: true, points: [point(.04, .34), point(.58, .34), point(.58, .08), point(.98, .5),
      point(.58, .92), point(.58, .66), point(.04, .66)] },
  };
  const count = sides ?? (shape === "star" ? 5 : 6);
  if (!Number.isInteger(count) || count < 3 || count > 24) throw new Error("Choose between 3 and 24 sides.");
  if (shape === "star" && (!Number.isFinite(innerRadius) || innerRadius < .12 || innerRadius > .85))
    throw new Error("Choose a star inner radius between 0.12 and 0.85.");
  const primitive = { type: shape, sides: count, ...(shape === "star" ? { innerRadius: rounded(innerRadius) } : {}) };
  return {
    name: shape === "star" ? "Star" : "Polygon", frame: { x: .35, y: .35, width: .3, height: .3 },
    path: { closed: true, points: radialPoints(count, shape === "star" ? innerRadius : null) }, primitive,
  };
}

/** Regenerate an unedited polygon or star while preserving its layer identity and frame. */
export function updateVectorPrimitive(node, patch = {}) {
  const primitive = node?.style?.primitive;
  if (node?.kind !== "shape" || node.style?.shape !== "path" || !primitive)
    throw new Error("Select an untouched polygon or star to edit its geometry.");
  const geometry = createVectorShape(primitive.type, { sides: patch.sides ?? primitive.sides,
    innerRadius: patch.innerRadius ?? primitive.innerRadius });
  return { ...node, style: { ...node.style, path: geometry.path, primitive: geometry.primitive } };
}
