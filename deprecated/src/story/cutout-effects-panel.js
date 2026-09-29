import { field, range } from "./view.js";
import { clone } from "../project/model.js";

const defaults = {
  outline: { color: "#ffffff", width: .006 },
  shadow: { color: "#000000", opacity: .25, blur: .008, x: .004, y: .008 },
};

export function mountCutoutEffectsPanel(content, { photoId, getProject, onCommand }) {
  const remembered = { ...clone(defaults), ...clone(getProject().nodes[photoId].cutoutEffects ?? {}) };
  const root = document.createElement("details"); root.className = "story-cutout-effects";
  const summary = document.createElement("summary"); summary.textContent = "Outline & shadow";
  const note = document.createElement("p"); note.className = "story-note"; note.setAttribute("role", "status");
  const image = new Image(); image.dataset.cutoutEffectPreview = ""; image.alt = "Outline and shadow in the current slide";
  const quick = document.createElement("div"); quick.className = "story-cutout-effect-switches";
  const fine = document.createElement("details"), fineTitle = document.createElement("summary"); fineTitle.textContent = "Fine tune finish";
  const units = document.createElement("p"); units.className = "story-note"; units.textContent = "Width, softness and offsets use a percentage of slide height.";
  const controls = document.createElement("div"); fine.append(fineTitle, units, controls); root.append(summary, note, quick, image, fine); content.append(root);
  const change = (kind, patch) => {
    const photo = getProject()?.nodes[photoId]; if (!photo) return false;
    const effects = clone(photo.cutoutEffects ?? { schema: 1 });
    if (patch === null) delete effects[kind]; else effects[kind] = { ...(effects[kind] ?? defaults[kind]), ...patch };
    const value = { ...photo }; if (effects.outline || effects.shadow) value.cutoutEffects = effects; else delete value.cutoutEffects;
    const accepted = onCommand({ type: "node", id: photoId, value });
    if (accepted && effects[kind]) remembered[kind] = clone(effects[kind]);
    return accepted;
  };
  const sync = () => {
    const photo = getProject()?.nodes[photoId];
    // Removing a connected copy updates history/status before the photo picker
    // mounts its replacement panel. The old panel must tolerate that interval.
    if (!photo) { root.hidden = true; image.removeAttribute("src"); for (const input of root.querySelectorAll("input")) input.disabled = true; return; }
    note.textContent = photo.maskId ? "The same finish follows this subject in both output shapes."
      : photo.cutoutEffects ? "Choose a subject again to restore these saved effects. You can turn them off below."
      : "Choose or paint a subject below, then add an outline or shadow.";
    for (const input of root.querySelectorAll("input")) {
      input.dataset.cutoutEffectControl = "";
      input.dataset.cutoutEffectNeedsMask = input.type === "checkbox" && input.checked ? "" : photoId;
      input.disabled = !photo.maskId && Boolean(input.dataset.cutoutEffectNeedsMask);
    }
  };
  const render = (focusKind) => {
    controls.replaceChildren(); quick.replaceChildren(); const effect = getProject().nodes[photoId].cutoutEffects;
    fine.hidden = !effect?.outline && !effect?.shadow;
    for (const [kind, label] of [["outline", "Outline"], ["shadow", "Shadow"]]) {
      const section = document.createElement("section"), toggle = document.createElement("input"); toggle.type = "checkbox"; toggle.checked = Boolean(effect?.[kind]);
      toggle.setAttribute("aria-label", `${label} around subject`); const check = document.createElement("label"); check.className = "story-check"; check.append(toggle, label); quick.append(check);
      toggle.addEventListener("change", () => { if (change(kind, toggle.checked ? clone(remembered[kind]) : null)) render(kind); });
      controls.append(section);
      if (effect?.[kind]) {
        const color = document.createElement("input"); color.type = "color"; color.value = effect[kind].color; color.setAttribute("aria-label", `${label} color`);
        color.addEventListener("input", () => change(kind, { color: color.value })); section.append(field(`${label} color`, color));
        const sliders = kind === "outline" ? [["width", "Outline width", 0, 2, .05]]
          : [["opacity", "Shadow strength", 0, 100, 1], ["blur", "Shadow softness", 0, 3, .1], ["x", "Shadow left / right", -5, 5, .1], ["y", "Shadow up / down", -5, 5, .1]];
        for (const [key, title, min, max, step] of sliders) section.append(range(title, Number((effect[kind][key] * 100).toFixed(3)), min, max, step,
          (value) => change(kind, { [key]: value / 100 })));
      }
      if (kind === focusKind) toggle.focus({ preventScroll: true });
    }
    sync();
  };
  render(); return { sync };
}
