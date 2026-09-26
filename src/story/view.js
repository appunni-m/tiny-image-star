export function createStoryView() {
  const root = document.createElement("dialog");
  root.id = "story-workspace"; root.className = "story-workspace";
  root.setAttribute("aria-label", "Photo story studio");
  root.innerHTML = `
    <header class="story-head">
      <button class="button secondary" id="story-back" type="button">Back</button>
      <strong id="story-name">Photo stories</strong>
      <button class="button secondary story-history" id="story-undo" type="button" aria-label="Undo story edit" disabled>↶</button>
      <button class="button secondary story-history" id="story-redo" type="button" aria-label="Redo story edit" disabled>↷</button>
      <button class="button primary" id="story-export" type="button" disabled>Export</button>
    </header>
    <section id="story-intro" class="story-intro">
      <div class="story-intro-copy"><p class="eyebrow">Made from your moments</p><h1>Your photos.<br>One story.</h1>
        <p>Turn 6–12 photos into a set worth swiping through. Change the look, frame every photo, and make the words yours.</p>
        <label class="story-field">Story title<input id="story-title" maxlength="80" value="My story" autocomplete="off"></label>
        <button class="button primary" id="story-choose" type="button">Choose 6–12 photos</button>
        <button class="button secondary" id="story-groups" type="button">Make several stories</button>
        <p class="story-note">Private editing on this device. PNG, JPEG and WebP photos.</p>
        <details class="story-import-options"><summary>Large photos</summary>
          <label class="story-check"><input id="story-small-copies" type="checkbox">Use smaller editing copies</label>
          <p class="story-note">Copies are up to 2,048 pixels on the long edge, with less detail when cropped. Originals are also saved. Exports use the copies until you switch back in Photos.</p></details>
        <details class="story-font-options"><summary>Font options · up to 2.24 MB</summary><p class="story-note">Story fonts load from this site and stay with saved stories.</p>
          <label class="story-check"><input id="story-device-fonts" type="checkbox">Use device fonts without a download. Appearance can vary.</label>
          <a href="./src/assets/story-type-v1/README.md" target="_blank" rel="noopener">Font licenses and source</a></details>
      </div>
      <section class="story-library" aria-label="Saved stories"><h2>Continue a story</h2><div id="story-library"></div><button class="button secondary" id="story-batches" type="button">Export saved stories</button></section>
    </section>
    <section id="story-body" class="story-body" hidden>
      <div class="story-stage"><img id="story-preview" alt="Story preview" hidden><div id="story-preview-message" role="status">Preparing your story…</div></div>
      <nav id="story-filmstrip" class="story-filmstrip" aria-label="Story slides"></nav>
      <nav class="story-dock" aria-label="Story tools">
        <button type="button" data-story-tool="look">Look</button><button type="button" data-story-tool="layout">Layout</button>
        <button type="button" data-story-tool="photos">Photos</button><button type="button" data-story-tool="text">Text</button>
        <button type="button" data-story-tool="adjust">Adjust</button><button type="button" data-story-tool="cutout">Cutout</button>
      </nav>
    </section>
    <footer class="story-status"><span id="story-status" role="status"></span><button id="story-retry-save" class="button secondary" type="button" hidden>Retry save</button><button id="story-save-copy" class="button secondary" type="button" hidden>Save a copy</button></footer>
    <input id="story-files" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" multiple hidden>
  `;
  const sheet = document.createElement("dialog");
  sheet.id = "story-sheet"; sheet.className = "story-sheet"; sheet.setAttribute("aria-labelledby", "story-sheet-title");
  sheet.innerHTML = `<header><h2 id="story-sheet-title"></h2><button class="button secondary" id="story-sheet-cancel" type="button">Cancel</button></header>
    <div id="story-sheet-content" class="story-sheet-content"></div><footer>
      <p id="story-sheet-preview-status" class="story-note" role="status" hidden></p>
      <button id="story-retry-preview" class="button secondary" type="button" hidden>Retry preview</button>
      <button id="story-sheet-apply" class="button primary" type="button">Apply</button></footer>`;
  document.body.append(root, sheet);
  const get = (id) => document.getElementById(`story-${id}`);
  return { root, sheet, get };
}

export function field(label, input) {
  const wrapper = document.createElement("label"); wrapper.className = "story-field";
  const text = document.createElement("span"); text.textContent = label; wrapper.append(text, input); return wrapper;
}

export function select(options, value, label) {
  const input = document.createElement("select"); input.setAttribute("aria-label", label);
  for (const [id, name] of options) { const option = document.createElement("option"); option.value = id; option.textContent = name; input.append(option); }
  input.value = value; return input;
}

export function action(label, callback, primary = false) {
  const button = document.createElement("button"); button.type = "button"; button.className = `button ${primary ? "primary" : "secondary"}`;
  button.textContent = label; button.addEventListener("click", callback); return button;
}

export function range(label, value, min, max, step, changed) {
  const input = document.createElement("input"); input.type = "range"; Object.assign(input, { min, max, step, value });
  input.setAttribute("aria-label", label);
  const output = document.createElement("output"); output.value = String(value);
  const wrapper = field(label, input); wrapper.append(output);
  input.addEventListener("input", () => { output.value = input.value; changed(Number(input.value)); });
  return wrapper;
}
