import { builtinFontById } from "../compositor/fonts.js";
import { normalizeTextLayers } from "../compositor/text.js";
import { legacyRecipeOperations, legacyStyleFromRecipe, originalRecipe, withLegacyStyle } from "./legacy.js";

const STAMP_ID = "tinystar:creator-stamp:v1";
const STAMP_SIZES = { compact: 0.036, standard: 0.046, headline: 0.08 };
const STAMP_PRESETS = [
  { id: "signature", name: "Creator signature", fontId: "system-sans", size: "compact", weight: "700", style: "normal", position: "bottom", align: "right", color: "0", opacity: "1" },
  { id: "editorial", name: "Editorial", fontId: "system-serif", size: "standard", weight: "700", style: "italic", position: "top", align: "left", color: "2", opacity: "2" },
  { id: "film-title", name: "Film title", fontId: "system-display", size: "headline", weight: "800", style: "normal", position: "middle", align: "center", color: "0", opacity: "2" },
  { id: "minimal-caption", name: "Minimal caption", fontId: "system-mono", size: "compact", weight: "600", style: "normal", position: "bottom", align: "left", color: "2", opacity: "1" },
];
const STAMP_COLORS = ["#ffffff", "#191817", "#fff0c2"];
const STAMP_OPACITIES = [0.68, 0.84, 1];
const STAMP_POSITIONS = { top: 0.08, middle: 0.5, bottom: 0.92 };

export function hasCreatorStamp(layers) {
  return normalizeTextLayers(layers).some(layer => layer.id === STAMP_ID);
}

export function creatorStampText(layers) {
  return normalizeTextLayers(layers).find(layer => layer.id === STAMP_ID)?.text ?? "";
}

export function creatorStampLayers(layers, choice) {
  const retained = normalizeTextLayers(layers).filter(layer => layer.id !== STAMP_ID);
  const label = [...String(choice?.text ?? "").trim()].slice(0, 120).join("");
  if (!label) return retained;
  if (retained.length >= 100) throw new Error("This image already has the maximum of 100 text layers.");
  const fontId = ["system-sans", "system-serif", "system-mono", "system-display"].includes(choice.fontId) ? choice.fontId : "system-sans";
  const font = builtinFontById(fontId), y = STAMP_POSITIONS[choice.position] ?? STAMP_POSITIONS.bottom;
  const color = STAMP_COLORS[Number(choice.color)] ?? STAMP_COLORS[0];
  const opacity = STAMP_OPACITIES[Number(choice.opacity)] ?? STAMP_OPACITIES[1];
  const align = ["left", "center", "right"].includes(choice.align) ? choice.align : "right";
  const fontSize = STAMP_SIZES[choice.size] ?? STAMP_SIZES.standard;
  const weight = ["600", "700", "800"].includes(choice.weight) ? choice.weight : "700";
  const style = choice.style === "italic" ? "italic" : "normal";
  return normalizeTextLayers([...retained, { id: STAMP_ID, text: label, x: .5, y, width: .88,
    fontSize, fontId, fontFamily: font.family, weight, style, color, align,
    opacity, shadow: color !== "#191817", rotation: 0 }]);
}

export function recipeWithCreatorStamp(recipe, layers) {
  const original = originalRecipe(recipe), operations = legacyRecipeOperations(recipe);
  operations.textLayers = normalizeTextLayers(layers);
  const name = String(recipe.name ?? "Image recipe").replace(/ · Text overlay$/, "");
  const outputName = hasCreatorStamp(operations.textLayers) ? `${name.slice(0, 420)} · Text overlay` : name.slice(0, 512);
  const next = { ...original, id: `creator-stamp-${crypto.randomUUID()}`,
    name: outputName, operations };
  delete next.recovery;
  const revision = Math.min(1_000_000, Number(recipe.style?.revision ?? 0) + 1);
  return withLegacyStyle(legacyStyleFromRecipe(next, Math.max(1, revision), "output"));
}

function field(label, input) {
  const wrapper = document.createElement("label"); wrapper.className = "story-field";
  const caption = document.createElement("span"); caption.textContent = label; wrapper.append(caption, input); return wrapper;
}

function select(options, value, label) {
  const input = document.createElement("select"); input.setAttribute("aria-label", label);
  for (const [id, name] of options) { const option = document.createElement("option"); option.value = id; option.textContent = name; input.append(option); }
  input.value = value; return input;
}

function action(label, callback, primary = false) {
  const button = document.createElement("button"); button.type = "button"; button.className = `button ${primary ? "primary" : "secondary"}`;
  button.textContent = label; button.addEventListener("click", callback); return button;
}

export function openCreatorStampPanel({ layers = [], returnFocus = document.activeElement, onApply, onSavePreset }) {
  const prior = normalizeTextLayers(layers).find(layer => layer.id === STAMP_ID);
  const priorPosition = prior?.y < 0.25 ? "top" : prior?.y > 0.75 ? "bottom" : "middle";
  const priorColor = prior?.color === "#191817" ? "1" : prior?.color === "#fff0c2" ? "2" : "0";
  const priorOpacity = prior?.opacity < 0.76 ? "0" : prior?.opacity >= 0.95 ? "2" : "1";
  const priorSize = Object.entries(STAMP_SIZES)
    .sort((a, b) => Math.abs(a[1] - (prior?.fontSize ?? STAMP_SIZES.compact)) - Math.abs(b[1] - (prior?.fontSize ?? STAMP_SIZES.compact)))[0][0];
  const matchingPreset = prior && STAMP_PRESETS.find(item => item.fontId === prior.fontId
    && item.size === priorSize && item.weight === prior.weight && item.style === prior.style
    && item.position === priorPosition && item.align === prior.align && item.color === priorColor && item.opacity === priorOpacity);
  const initialPreset = prior ? matchingPreset?.id ?? "custom" : "signature";
  const initial = matchingPreset ?? STAMP_PRESETS.find(item => item.id === initialPreset) ?? STAMP_PRESETS[0];
  const dialog = document.createElement("dialog"); dialog.className = "story-sheet creator-stamp-sheet";
  let savedChoice = null;
  dialog.setAttribute("aria-labelledby", "creator-stamp-title");
  const header = document.createElement("header"), title = document.createElement("h2");
  title.id = "creator-stamp-title"; title.textContent = "Text overlay";
  const cancel = action("Cancel", () => dialog.close()); header.append(title, cancel);
  const content = document.createElement("div"); content.className = "story-sheet-content";
  const note = document.createElement("p"); note.className = "story-note";
  note.textContent = typeof onSavePreset === "function"
    ? "Start from a typography preset, then adjust it for your image. Save a recipe to reuse it in later batches or folder jobs."
    : "Start from a typography preset, then adjust it for your image. This overlay will be saved with the folder recipe.";
  const preset = select([["custom", "Custom style"], ...STAMP_PRESETS.map(item => [item.id, item.name])], initialPreset, "Typography preset");
  const text = document.createElement("input"); text.type = "text"; text.maxLength = 120; text.autocomplete = "off";
  text.value = prior?.text ?? ""; text.placeholder = "Your name or short caption";
  text.setAttribute("aria-label", "Text overlay");
  const font = select([["system-sans", "Clean sans"], ["system-serif", "Classic serif"], ["system-mono", "Monospace"], ["system-display", "Bold display"]], prior?.fontId ?? initial.fontId, "Overlay font");
  const size = select([["compact", "Compact"], ["standard", "Standard"], ["headline", "Headline"]], priorSize, "Text size");
  const weight = select([["600", "Medium"], ["700", "Bold"], ["800", "Extra bold"]], prior?.weight ?? initial.weight, "Text weight");
  const style = select([["normal", "Upright"], ["italic", "Italic"]], prior?.style ?? initial.style, "Text style");
  const align = select([["left", "Left"], ["center", "Center"], ["right", "Right"]], prior?.align ?? initial.align, "Text alignment");
  const position = select([["top", "Top"], ["middle", "Middle"], ["bottom", "Bottom"]], prior ? priorPosition : initial.position, "Text placement");
  const color = select([["0", "White with shadow"], ["1", "Dark · no shadow"], ["2", "Warm cream with shadow"]], prior ? priorColor : initial.color, "Text color");
  const opacity = select([["0", "Soft · 68%"], ["1", "Balanced · 84%"], ["2", "Full · 100%"]], prior ? priorOpacity : initial.opacity, "Text strength");
  const message = document.createElement("p"); message.className = "story-note"; message.setAttribute("role", "status");
  const footer = document.createElement("footer"), apply = action(prior ? "Update overlay" : "Apply overlay", () => { void commit(false); }, true);
  const save = action("Apply & save recipe", () => { void commit(true); }); save.hidden = typeof onSavePreset !== "function";
  footer.append(message, apply, save); content.append(note, field("Typography preset", preset), field("Words · up to 120 characters", text), field("Font", font), field("Size", size), field("Weight", weight), field("Style", style), field("Placement", position), field("Alignment", align), field("Color", color), field("Strength", opacity));
  preset.addEventListener("change", () => {
    const item = STAMP_PRESETS.find(candidate => candidate.id === preset.value);
    if (!item) return;
    font.value = item.fontId; size.value = item.size; weight.value = item.weight; style.value = item.style;
    position.value = item.position; align.value = item.align; color.value = item.color; opacity.value = item.opacity;
  });
  for (const control of [font, size, weight, style, position, align, color, opacity]) {
    control.addEventListener("change", () => { preset.value = "custom"; });
  }
  dialog.append(header, content, footer); document.body.append(dialog); dialog.showModal();
  function refresh() {
    apply.textContent = !text.value.trim() && prior ? "Remove overlay" : prior ? "Update overlay" : "Apply overlay";
    apply.disabled = !text.value.trim() && !prior;
    save.disabled = !text.value.trim();
  }
  async function commit(savePreset) {
    apply.disabled = true; save.disabled = true;
    try {
      const choice = { text: text.value, fontId: font.value, size: size.value, weight: weight.value, style: style.value,
        align: align.value, position: position.value, color: color.value, opacity: opacity.value };
      const updatedLayers = creatorStampLayers(layers, choice);
      await onApply(choice, updatedLayers);
      if (savePreset) { dialog.returnValue = "save-recipe"; savedChoice = choice; }
      dialog.close();
    } catch (error) { message.textContent = error.message; refresh(); }
  }
  text.addEventListener("input", refresh);
  dialog.addEventListener("close", () => {
    const shouldSave = dialog.returnValue === "save-recipe";
    const choice = shouldSave ? savedChoice : null;
    dialog.remove(); if (returnFocus?.isConnected) returnFocus.focus();
    if (shouldSave && choice) onSavePreset?.(choice, creatorStampLayers(layers, choice));
  }, { once: true });
  dialog.addEventListener("cancel", event => { event.preventDefault(); dialog.close(); });
  refresh();
  return dialog;
}
