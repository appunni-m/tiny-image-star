# Auto layout suggestions

Select a frame without auto layout and use **Suggest auto layout** in the Layout inspector. Tiny Image Star analyzes the frame’s direct visible children and presents the inferred direction or grid, spacing, and padding before anything changes. Choose **Apply suggestion** to make it one undoable edit, or cancel to leave the frame alone.

The inference is deliberately conservative. It recognizes:

- A single, consistently spaced horizontal row with aligned top edges.
- A single, consistently spaced vertical column with aligned left edges.
- A complete regular grid with at least two rows and two columns, consistent column starts, and consistent row spacing.

The current implementation expects finite, positive-size children with unrotated geometry. Linear rows and columns must already follow visual order in the layer list because flow layout retains layer order. Layers with variable-bound position, size, or visibility; locked layers; component-instance content; or existing fill sizing are kept at their current coordinates as absolute-positioned layers when the remaining siblings still form a clear pattern. Hidden and already absolute layers are left out of the inference and remain unchanged. Analysis is capped at 2,048 visible flow children.

Suggestions are rejected when there are fewer than two eligible flow layers, spacing overlaps, geometry does not form a clear row/column/complete grid, padding would be negative, or applying the inferred settings would move a flow layer beyond the alignment tolerance or resize it. The tool does not guess wrapping, incomplete grids, arbitrary alignment, or Bézier and transformed visual bounds. Add auto layout manually when the layout does not match these patterns.

The Apply action recalculates and checks the suggestion against the current frame before committing. If the geometry changed after review, the updated settings must be reviewed again. Grid suggestions store explicit row and column assignments so layer stacking order does not change the inferred visual arrangement.
