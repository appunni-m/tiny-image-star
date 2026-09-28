export function createDesignView() {
  const root = document.createElement("section");
  root.id = "design-view";
  root.className = "secondary-view design-view";
  root.hidden = true;
  root.setAttribute("aria-label", "Design workspace");
  root.innerHTML = `
    <header class="design-toolbar">
      <div class="design-file-heading"><label class="eyebrow" for="design-document-name">Local document</label><input id="design-document-name" class="design-document-name" type="text" value="Untitled design" maxlength="120" aria-label="Local document name" /><span id="design-save-status" class="design-save-status" role="status" aria-live="polite">Not saved</span></div>
      <div class="design-toolbar-actions" aria-label="Design tools">
        <button id="design-new-file" class="button secondary" type="button">New design</button>
        <select id="design-open-file" class="button secondary" aria-label="Open saved local document"><option value="">Open local document…</option></select>
        <button id="design-add-images" class="button secondary" type="button">Add images</button>
        <button id="design-add-text" class="button secondary" type="button" disabled>Text</button>
        <button id="design-add-rectangle" class="button secondary" type="button" disabled>Rectangle</button>
        <button id="design-frame-selection" class="button secondary" type="button" disabled>Frame selection</button>
        <span class="design-toolbar-divider" aria-hidden="true"></span>
        <button id="design-undo" class="button secondary" type="button" disabled aria-label="Undo design edit">Undo</button>
        <button id="design-redo" class="button secondary" type="button" disabled aria-label="Redo design edit">Redo</button>
        <button id="design-export" class="button primary" type="button" disabled>Export page</button>
        <input id="design-file-input" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" multiple />
      </div>
    </header>
    <section id="design-recipe-job" class="design-recipe-job" aria-label="Apply image recipe" hidden>
      <div class="design-recipe-job-overview"><strong id="design-recipe-job-title">Applying recipe</strong><span id="design-recipe-job-status" role="status" aria-live="polite">Preparing images…</span></div>
      <progress id="design-recipe-job-progress" max="1" value="0" aria-label="Image layers processed">0%</progress>
      <span id="design-recipe-job-metrics" class="design-recipe-job-metrics">0 of 0</span>
      <label class="design-recipe-job-speed" for="design-recipe-job-speed"><span>Speed</span><select id="design-recipe-job-speed"><option value="auto">Auto</option><option value="max-speed">Max speed</option><option value="low-resource">Low resource</option></select></label>
      <button id="design-recipe-job-pause" class="button secondary" type="button">Pause</button>
      <button id="design-recipe-job-cancel" class="button secondary" type="button">Cancel</button>
    </section>
    <div class="design-layout">
      <aside class="design-sidebar design-left-sidebar" aria-label="Pages and layers">
        <section class="design-sidebar-section design-page-list" aria-labelledby="design-pages-heading">
          <header class="design-panel-heading"><h2 id="design-pages-heading">Pages</h2><button id="design-new-page" class="design-icon-button" type="button" aria-label="New page" title="New page">+</button></header>
          <button id="design-page-current" class="design-page-current" type="button" aria-current="page" disabled>Page 1</button>
        </section>
        <section class="design-sidebar-section design-layers-section" aria-labelledby="design-layers-heading">
          <header class="design-panel-heading"><h2 id="design-layers-heading">Layers</h2><span id="design-layer-count" class="design-count">0</span></header>
          <div id="design-layer-list" class="design-layer-list" role="listbox" aria-label="Page layers" aria-multiselectable="true"></div>
        </section>
      </aside>
      <section class="design-canvas-panel" aria-label="Canvas">
        <header class="design-canvas-toolbar"><span id="design-page-title">Page 1</span><span id="design-canvas-status" role="status" aria-live="polite">Create a page to begin.</span></header>
        <div id="design-stage" class="design-stage">
          <canvas id="design-canvas" tabindex="0" aria-label="Design page canvas. Click to select layers; drag to move, resize from the square handles, or rotate from the round handle. Hold Space and drag or use two fingers to pan and zoom. Press Delete to remove selected layers."></canvas>
          <div id="design-empty-state" class="design-empty-state"><strong>Make something on your canvas</strong><span>Add images, text, or shapes. Everything is composed on this page.</span><button id="design-empty-add" class="button primary" type="button">Add images</button></div>
        </div>
        <footer class="design-canvas-footer"><div class="design-zoom-controls" role="group" aria-label="Canvas zoom"><button id="design-zoom-out" class="button secondary" type="button" aria-label="Zoom out" title="Zoom out (⌘−)" disabled>−</button><button id="design-zoom-label" class="button secondary design-zoom-label" type="button" aria-label="Fit canvas to screen" title="Fit canvas (⌘0)">100%</button><button id="design-zoom-in" class="button secondary" type="button" aria-label="Zoom in" title="Zoom in (⌘+)" disabled>+</button></div><button id="design-fit" class="button secondary" type="button" disabled>Fit page</button><span id="design-selection-summary">Nothing selected</span></footer>
      </section>
      <aside id="design-inspector" class="design-sidebar design-inspector" aria-label="Design inspector">
        <header class="design-panel-heading"><h2>Design</h2><span id="design-selection-count" class="design-count">0 selected</span></header>
        <p id="design-inspector-empty" class="design-inspector-empty">Select an image, text, or shape to edit its properties.</p>
        <div id="design-multi-inspector" class="design-multi-inspector" hidden>
          <p id="design-multi-summary" class="design-inspector-empty"></p>
          <label class="design-range-field"><span>Opacity <output id="design-multi-opacity-value">100%</output></span><input id="design-multi-opacity" type="range" min="0" max="100" step="1" value="100" aria-label="Opacity for selected layers" /></label>
        </div>
        <div id="design-inspector-content" class="design-inspector-content" hidden>
          <label class="design-field"><span>Name</span><input id="design-layer-name" type="text" maxlength="120" autocomplete="off" /></label>
          <fieldset class="design-fieldset"><legend>Position</legend>
            <label class="design-field"><span>X</span><input id="design-x" type="number" min="-4000" max="4000" step="0.1" inputmode="decimal" /></label>
            <label class="design-field"><span>Y</span><input id="design-y" type="number" min="-400" max="400" step="0.1" inputmode="decimal" /></label>
            <label class="design-field"><span>W</span><input id="design-width" type="number" min="0.01" max="4000" step="0.1" inputmode="decimal" /></label>
            <label class="design-field"><span>H</span><input id="design-height" type="number" min="0.01" max="800" step="0.1" inputmode="decimal" /></label>
          </fieldset>
          <label id="design-text-field" class="design-field" hidden><span>Text</span><textarea id="design-text" maxlength="5000" rows="3"></textarea></label>
          <label id="design-color-field" class="design-field" hidden><span>Fill</span><input id="design-color" type="color" value="#5149d5" /></label>
          <label id="design-opacity-field" class="design-range-field"><span>Opacity <output id="design-opacity-value">100%</output></span><input id="design-opacity" type="range" min="0" max="100" step="1" value="100" /></label>
          <label id="design-frame-clip-field" class="design-field design-checkbox-field" hidden><span>Clip content</span><input id="design-frame-clip" type="checkbox" checked /></label>
          <label id="design-frame-radius-field" class="design-range-field" hidden><span>Corner radius <output id="design-frame-radius-value">0%</output></span><input id="design-frame-radius" type="range" min="0" max="0.5" step="0.01" value="0" /></label>
          <label id="design-frame-layout-field" class="design-field" hidden><span>Auto Layout</span><select id="design-frame-layout"><option value="manual">Manual positioning</option><option value="horizontal">Horizontal</option><option value="vertical">Vertical</option></select></label>
          <fieldset id="design-resizing-options" class="design-fieldset" hidden><legend>Resizing</legend>
            <label class="design-field"><span>Width</span><select id="design-layout-sizing-width"><option value="fixed">Fixed</option><option value="hug">Hug contents</option><option value="fill">Fill container</option></select></label>
            <label class="design-field"><span>Height</span><select id="design-layout-sizing-height"><option value="fixed">Fixed</option><option value="hug">Hug contents</option><option value="fill">Fill container</option></select></label>
          </fieldset>
          <fieldset id="design-frame-layout-options" class="design-fieldset" hidden><legend>Layout</legend>
            <label class="design-field"><span>Gap (px)</span><input id="design-layout-gap" type="number" min="0" max="16384" step="1" inputmode="numeric" /></label>
            <label class="design-field"><span>Row gap (px)</span><input id="design-layout-row-gap" type="number" min="0" max="16384" step="1" inputmode="numeric" /></label>
            <label class="design-field"><span>Column gap (px)</span><input id="design-layout-column-gap" type="number" min="0" max="16384" step="1" inputmode="numeric" /></label>
            <label class="design-field"><span>Padding left</span><input id="design-layout-padding-left" type="number" min="0" max="16384" step="1" inputmode="numeric" /></label>
            <label class="design-field"><span>Padding right</span><input id="design-layout-padding-right" type="number" min="0" max="16384" step="1" inputmode="numeric" /></label>
            <label class="design-field"><span>Padding top</span><input id="design-layout-padding-top" type="number" min="0" max="16384" step="1" inputmode="numeric" /></label>
            <label class="design-field"><span>Padding bottom</span><input id="design-layout-padding-bottom" type="number" min="0" max="16384" step="1" inputmode="numeric" /></label>
            <label class="design-field"><span>Justify</span><select id="design-layout-justify"><option value="start">Start</option><option value="center">Center</option><option value="end">End</option><option value="space-between">Space between</option></select></label>
            <label class="design-field"><span>Align</span><select id="design-layout-align"><option value="start">Start</option><option value="center">Center</option><option value="end">End</option><option value="stretch">Stretch</option></select></label>
            <label class="design-field design-checkbox-field"><span>Wrap items</span><input id="design-layout-wrap" type="checkbox" /></label>
          </fieldset>
          <fieldset id="design-constraints-field" class="design-fieldset" hidden><legend>Constraints</legend>
            <label class="design-field"><span>Horizontal</span><select id="design-constraint-horizontal"><option value="left">Left</option><option value="right">Right</option><option value="left-right">Left and right</option><option value="center">Center</option><option value="scale">Scale</option></select></label>
            <label class="design-field"><span>Vertical</span><select id="design-constraint-vertical"><option value="top">Top</option><option value="bottom">Bottom</option><option value="top-bottom">Top and bottom</option><option value="center">Center</option><option value="scale">Scale</option></select></label>
          </fieldset>
          <label id="design-fit-field" class="design-field" hidden><span>Image fit</span><select id="design-image-fit"><option value="contain">Fit inside</option><option value="cover">Fill frame</option></select></label>
          <div id="design-image-adjustments" class="design-adjustments" hidden>
            <h3>Image adjustments</h3>
            <div class="design-image-crop-actions" role="group" aria-label="Image crop">
              <button id="design-crop-tool" class="button secondary" type="button" aria-pressed="false">Crop image</button>
              <button id="design-crop-reset" class="button secondary" type="button" disabled>Reset crop</button>
            </div>
            <div class="design-image-flips" role="group" aria-label="Image orientation">
              <button id="design-flip-x" class="button secondary" type="button" aria-pressed="false">Flip horizontal</button>
              <button id="design-flip-y" class="button secondary" type="button" aria-pressed="false">Flip vertical</button>
            </div>
            <label class="design-range-field"><span>Brightness <output id="design-brightness-value">1.00</output></span><input id="design-brightness" type="range" min="0" max="2" step="0.01" value="1" /></label>
            <label class="design-range-field"><span>Contrast <output id="design-contrast-value">1.00</output></span><input id="design-contrast" type="range" min="0" max="2" step="0.01" value="1" /></label>
            <label class="design-range-field"><span>Saturation <output id="design-saturation-value">1.00</output></span><input id="design-saturation" type="range" min="0" max="2" step="0.01" value="1" /></label>
          </div>
          <div class="design-layer-actions">
            <button id="design-toggle-visibility" class="button secondary" type="button">Hide</button>
            <button id="design-toggle-lock" class="button secondary" type="button">Lock</button>
            <button id="design-delete" class="button secondary" type="button">Delete</button>
          </div>
        </div>
      </aside>
    </div>
  `;
  document.querySelector("#editor-view").after(root);
  const get = (id) => root.querySelector(`#design-${id}`);
  return { root, get };
}
