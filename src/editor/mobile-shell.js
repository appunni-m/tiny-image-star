// Move the real controls, including their listeners and state, into native
// dialogs on phones. Comments retain their desktop positions across resizing.
export function attachMobileShell(editor) {
  const { elements, state } = editor;
  const media = matchMedia("(max-width: 650px)");
  const more = document.querySelector("#mobile-more-sheet");
  const batch = document.querySelector("#mobile-batch-sheet");
  const inspector = document.querySelector("#mobile-inspector-sheet");
  const moreButton = document.querySelector("#mobile-more-button");
  const batchButton = document.querySelector("#mobile-batch-settings");
  const moves = [];
  let changingLayout = false;

  function register(selectors, destination) {
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      const placeholder = document.createComment(`desktop position: ${selector}`);
      node.before(placeholder);
      moves.push({ node, placeholder, destination: document.querySelector(destination) });
    }
  }

  register([".topbar-center", ".workspace-nav", "#open-button", "#save-preset-button", "#mobile-canvas-actions", "#compare-hold-button", "#processing-controls", "#appearance-control"], "#mobile-more-content");
  register([".tray-heading", "#tray-scope-control", "#tray-apply-edits-button", ".tray-recipe:has(#tray-preset-picker)", "#tray-photo-look-controls", ".tray-output-controls", "#tray-footer"], "#mobile-batch-content");
  register(["#editor-inspector"], "#mobile-inspector-content");

  function openSheet(dialog, trigger) {
    if (!media.matches) return;
    for (const other of [more, batch, inspector]) {
      if (other !== dialog && other.open) other.close();
    }
    dialog.returnFocus = trigger;
    if (!dialog.open) dialog.showModal();
  }

  for (const dialog of [more, batch, inspector]) {
    dialog.querySelector("[data-close-sheet]").addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => {
      // A queued close event must not close a newly reopened dialog.
      if (dialog.open || changingLayout) return;
      if (dialog === inspector) editor.setInspectorOpen(false);
      if (media.matches && !document.querySelector("dialog[open]")) dialog.returnFocus?.focus({ preventScroll: true });
    });
  }
  moreButton.addEventListener("click", () => openSheet(more, moreButton));
  batchButton.addEventListener("click", () => openSheet(batch, batchButton));
  // Dismiss before invoking an action that opens another surface or a picker.
  more.addEventListener("click", (event) => {
    if (event.target.closest("#open-button, #save-preset-button, .workspace-nav button")) {
      more.returnFocus = null;
      more.close();
    }
  }, true);
  batch.addEventListener("click", (event) => {
    if (event.target.closest("#tray-save-button, #tray-add-button, #photo-look-open")) batch.close();
  }, true);
  inspector.addEventListener("click", (event) => {
    if (event.target.closest("#apply-crop, #cancel-crop, #inspector-save-button")) inspector.close();
  }, true);

  editor.syncMobileInspector = () => {
    if (!media.matches) return;
    if (state.inspectorOpen && state.image) {
      const titles = { text: "Text", crop: "Crop", size: "Size", adjust: "Adjust", format: "Format" };
      inspector.dataset.tool = state.tool;
      document.querySelector("#mobile-inspector-title").textContent = titles[state.tool] ?? "Image controls";
      if (!inspector.open) openSheet(inspector, document.activeElement);
    } else if (inspector.open) inspector.close();
  };
  document.querySelector(".tool-primary-group").addEventListener("click", (event) => {
    if (!media.matches || !state.image || !event.target.closest("button")) return;
    editor.setInspectorOpen(state.tool !== "move");
  });
  function syncBatchButton() {
    batchButton.hidden = elements.imageTray.hidden;
    if (elements.imageTray.hidden && batch.open) batch.close();
  }
  new MutationObserver(syncBatchButton).observe(elements.imageTray, { attributes: true, attributeFilter: ["hidden"] });

  function updateLayout() {
    changingLayout = true;
    for (const dialog of [more, batch, inspector]) if (dialog.open) dialog.close();
    for (const { node, placeholder, destination } of moves) {
      if (media.matches) destination.append(node);
      else placeholder.after(node);
    }
    state.inspectorOpen = false;
    editor.setInspectorOpen(false);
    syncBatchButton();
    document.documentElement.dataset.mobileLayout = String(media.matches);
    changingLayout = false;
    // Moving controls changes the canvas box after the window resize event.
    requestAnimationFrame(() => editor.renderCanvas());
  }
  media.addEventListener("change", updateLayout);
  updateLayout();
}
