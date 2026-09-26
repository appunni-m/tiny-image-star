import { action, field, range, select } from "./view.js";
import { storyDepthCommand } from "./depth.js";

export function mountDepthPanel(content, { photoId, getProject, onCommand, onEditSubject }) {
  const root = document.createElement("section"); root.className = "story-depth-controls"; content.append(root);
  const render = (focusToggle = false) => {
    root.replaceChildren();
    const project = getProject(), photo = project.nodes[photoId], title = project.nodes[photo.depthTextId];
    const toggle = document.createElement("input"); toggle.type = "checkbox"; toggle.checked = Boolean(title); toggle.disabled = !photo.maskId && !title; toggle.indeterminate = Boolean(title && !photo.maskId);
    toggle.setAttribute("aria-label", "Text behind this subject");
    const label = document.createElement("label"); label.className = "story-check"; label.append(toggle, "Text behind this subject"); root.append(label);
    const note = document.createElement("p"); note.className = "story-note";
    note.textContent = title && !photo.maskId ? "This photo needs a new subject mask. Your title stays in front of the original photo until you choose a subject in Cutout."
      : photo.maskId ? "The title follows this photo in both shapes. Your caption stays separate. Repair the subject mask in Cutout."
      : "Choose a subject in Cutout first: import a mask or use Restore and Erase. Automatic subject selection is not available yet.";
    root.append(note);
    const subject = action("Apply words & edit subject", onEditSubject); subject.dataset.applyAndOpen = ""; root.append(subject);
    toggle.addEventListener("change", () => {
      if (onCommand(storyDepthCommand(getProject(), photoId, { enabled: toggle.checked }))) render(true);
    });
    if (focusToggle) toggle.focus({ preventScroll: true });
    if (!title) return;
    const changeTitle = (patch) => {
      const current = getProject().nodes[getProject().nodes[photoId].depthTextId];
      return onCommand({ type: "node", id: current.id, value: { ...current, ...patch } });
    };
    const input = document.createElement("textarea"); input.rows = 2; input.maxLength = 120; input.value = title.text; input.setAttribute("aria-label", "Depth title");
    input.addEventListener("input", () => changeTitle({ text: input.value })); root.append(field("Depth title", input));
    const background = select([["photo", "Keep original photo"], ["page", "Use cutout over the page"]], photo.depthBackground, "Depth background");
    background.addEventListener("change", () => onCommand(storyDepthCommand(getProject(), photoId, { background: background.value })));
    root.append(field("Background", background));
    const advanced = document.createElement("details"), summary = document.createElement("summary"); summary.textContent = "Type and placement"; advanced.append(summary); root.append(advanced);
    const font = select([...(title.fontId ? [["custom", project.assets[title.fontId]?.name ?? "Saved font"]] : []), ["system-display", "Display · device"], ["system-sans", "Sans serif · device"], ["system-serif", "Serif · device"], ["system-mono", "Monospace · device"]], title.fontId ? "custom" : title.style.builtinFont ?? "system-sans", "Depth typeface");
    font.addEventListener("change", () => changeTitle({ fontId: font.value === "custom" ? title.fontId : null,
      style: { ...getProject().nodes[title.id].style, builtinFont: font.value === "custom" ? title.style.builtinFont ?? "system-sans" : font.value } }));
    const color = document.createElement("input"); color.type = "color"; color.value = (title.color ?? "#202124").slice(0, 7); color.setAttribute("aria-label", "Depth text color");
    color.addEventListener("input", () => changeTitle({ color: color.value })); advanced.append(field("Typeface", font), field("Text color", color));
    advanced.append(range("Depth text size", title.style.fontSize ?? .05, .03, .4, .005, (fontSize) => changeTitle({ style: { ...getProject().nodes[title.id].style,
      minFontSize: Math.min(getProject().nodes[title.id].style.minFontSize ?? .012, fontSize), fontSize } })));
    for (const [key, name, min, max] of [["x", "Title left / right", -.5, 1], ["y", "Title up / down", -.5, 1], ["width", "Title width", .2, 1.8], ["height", "Title height", .1, 1]]) {
      advanced.append(range(name, title.frame[key], min, max, .01, (value) => changeTitle({ frame: { ...getProject().nodes[title.id].frame, [key]: value } })));
    }
    const hint = document.createElement("p"); hint.className = "story-note"; hint.textContent = "Move the words across the subject to reveal the depth effect. Choose a contrasting text color. Turning this off removes the title and keeps the cutout; Undo restores it.";
    root.append(hint);
    root.append(subject);
  };
  render();
}
