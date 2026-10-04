const EDITOR_TOOL_TASKS = Object.freeze([
  {
    id: 'select-or-move-layers', tool: 'select', label: 'Select or move a layer',
    description: 'Choose Move / Select, then click a layer to select it or drag it to move it.',
    keywords: ['select object', 'move object', 'pointer tool', 'arrow tool', 'pick layer']
  },
  {
    id: 'scale-layers', tool: 'scale', label: 'Scale layers',
    description: 'Choose Scale, then drag a corner to resize the layer and its appearance together.',
    keywords: ['resize layer', 'resize object', 'scale object', 'scale tool']
  },
  {
    id: 'draw-rectangle', tool: 'rectangle', label: 'Draw a rectangle',
    description: 'Choose Rectangle, then drag on the canvas to draw one.',
    keywords: ['rectangle tool', 'box', 'square', 'draw a shape']
  },
  {
    id: 'draw-ellipse', tool: 'ellipse', label: 'Draw an ellipse or circle',
    description: 'Choose Ellipse, then drag on the canvas. Hold Shift for a circle.',
    keywords: ['ellipse tool', 'circle', 'oval', 'draw a shape']
  },
  {
    id: 'draw-line', tool: 'line', label: 'Draw a line',
    description: 'Choose Line, then drag from the line’s start point to its end point.',
    keywords: ['line tool', 'connector', 'straight line', 'draw a shape']
  },
  {
    id: 'draw-polygon', tool: 'polygon', label: 'Draw a polygon',
    description: 'Choose Polygon, then drag on the canvas. Set the number of sides in Properties.',
    keywords: ['polygon tool', 'triangle', 'hexagon', 'draw a shape']
  },
  {
    id: 'draw-star', tool: 'star', label: 'Draw a star',
    description: 'Choose Star, then drag on the canvas. Change its points and ratio in Properties.',
    keywords: ['star tool', 'star shape', 'draw a shape']
  },
  {
    id: 'draw-section', tool: 'section', label: 'Draw a section',
    description: 'Choose Section, then drag around related layers to label and organize them.',
    keywords: ['section tool', 'organize layers', 'group visually']
  },
  {
    id: 'draw-export-slice', tool: 'slice', label: 'Create an export slice',
    description: 'Choose Slice, then drag over the area you want to export.',
    keywords: ['slice tool', 'export region', 'export area', 'crop export']
  },
  {
    id: 'draw-pen-path', tool: 'pen', label: 'Draw an editable path',
    description: 'Choose Pen and tap to add points; drag for curves, then choose Finish path.',
    keywords: ['pen tool', 'bezier', 'vector path', 'curve', 'draw a path']
  },
  {
    id: 'draw-freehand-path', tool: 'pencil', label: 'Draw freehand',
    description: 'Choose Pencil and draw a freehand path; stylus pressure changes its width.',
    keywords: ['pencil tool', 'freehand path', 'sketch', 'draw by hand']
  },
  {
    id: 'pick-color', tool: 'eyedropper', label: 'Pick a color from the canvas',
    description: 'Choose Pick color, then tap a color on the canvas to apply it to the selected layer.',
    keywords: ['eyedropper', 'sample color', 'color picker', 'copy color']
  },
  {
    id: 'pan-canvas', tool: 'hand', label: 'Move around the canvas',
    description: 'Choose Hand, then drag to pan. You can also hold Space while dragging.',
    keywords: ['pan', 'move canvas', 'navigate canvas', 'hand tool']
  },
  {
    id: 'add-comment', tool: 'comment', label: 'Add a comment',
    description: 'Choose Comment, then click empty canvas to place a comment. Use a layer menu to comment on an object.',
    keywords: ['comment tool', 'leave feedback', 'review design', 'annotate']
  }
]);

export function createEditorToolActions({ setTool, disabledReason = '' } = {}) {
  if (typeof setTool !== 'function') throw new TypeError('Editor tool tasks need a setTool function.');
  return EDITOR_TOOL_TASKS.map(task => ({
    ...task,
    disabled: Boolean(disabledReason),
    ...(disabledReason ? { unavailableReason: disabledReason } : {}),
    run: () => setTool(task.tool)
  }));
}
