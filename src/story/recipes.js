import { clone, createSceneProject, newId } from "../project/model.js";
import { initializeStoryLayout, withStoryReflow } from "./layout.js";
import { canMoveStorySlide, connectedSlideGroup } from "./connections.js";

// Applied definitions are copied into the document. Existing stories never
// follow a later change to this catalog when reopened.
export const STORY_LOOKS = Object.freeze([
  { id: "scrapbook", revision: 1, name: "Scrapbook", description: "Warm paper, lively color, room for your words.",
    appearance: { brightness: 1.03, contrast: .97, saturation: .94 }, paper: "#f4eee4", ink: "#292821", accent: "#947044" },
  { id: "film-diary", revision: 1, name: "Film diary", description: "Soft contrast, cream borders, a quieter color palette.",
    appearance: { brightness: 1.02, contrast: .9, saturation: .76 }, paper: "#292a27", ink: "#f4eee4", accent: "#d3ba8e" },
  { id: "clean", revision: 1, name: "Clean", description: "Clear color and a simple white page.",
    appearance: { brightness: 1, contrast: 1, saturation: 1 }, paper: "#ffffff", ink: "#242424", accent: "#656565" },
]);

const frame = (x, y, width, height) => ({ x, y, width, height });
const textStyle = { builtinFont: "system-serif", weight: 700, fontBasis: "width", fontSize: .07, minFontSize: .02, lineHeight: 1.15, fit: "shrink" };
const definition = (look) => ({ schema: 1, id: look.id, revision: look.revision, name: look.name, appearance: clone(look.appearance),
  paper: look.paper, ink: look.ink, accent: look.accent, requires: ["scene-v1", "image", "shape", "text"], assets: [] });

export function storyGroups(assets) {
  if (assets.length < 6 || assets.length > 12) throw new Error("Choose 6–12 photos for a story.");
  const count = Math.round(assets.length * 2 / 3), groups = [[assets[0]]];
  let offset = 1;
  for (let index = 1; index < count - 1; index++) {
    const take = Math.ceil((assets.length - 1 - offset) / (count - 1 - index));
    groups.push(assets.slice(offset, offset + take)); offset += take;
  }
  groups.push([assets.at(-1)]);
  return groups;
}

export function createPhotoStory(assets, { title = "My story", lookId = "scrapbook", originals = [] } = {}) {
  if (!Array.isArray(originals) || originals.length > 12 || originals.some((asset) => asset.kind !== "image" || asset.workingCopy
    || !assets.some((copy) => copy.workingCopy?.sourceAssetId === asset.id))) throw new Error("Editing copies must retain their own original photos.");
  const look = STORY_LOOKS.find((item) => item.id === lookId);
  if (!look) throw new Error("Choose an available story look.");
  const groups = storyGroups(assets), nodes = {}, slides = [];
  groups.forEach((photos, index) => {
    const id = newId("slide"), nodeIds = [];
    const add = (suffix, kind, box, details) => {
      const nodeId = `${id}:${suffix}`;
      nodes[nodeId] = { id: nodeId, kind, space: "slide", frame: box, ...details }; nodeIds.push(nodeId);
    };
    add("paper", "shape", frame(0, 0, 1, 1), { color: look.paper });
    const positions = photos.length === 1 ? [frame(.09, .12, .82, .62)]
      : [frame(.1, .09, .72, .37), frame(.18, .48, .72, .37)];
    photos.forEach((asset, photoIndex) => {
      const box = positions[photoIndex], rotation = (index + photoIndex) % 2 ? 3 : -3;
      add(`border-${photoIndex}`, "shape", frame(box.x - .022, box.y - .014, box.width + .044, box.height + .028), { color: "#fffdfa", rotation });
      add(`photo-${photoIndex}`, "image", box, { assetId: asset.id, fit: "cover", focal: { x: .5, y: .5 }, rotation });
    });
    add("caption", "text", photos.length === 1 ? frame(.1, .78, .8, .13) : frame(.1, .875, .8, .07), {
      text: index === 0 ? title.trim().slice(0, 80) || "My story" : index === groups.length - 1 ? "To be continued" : "",
      color: look.ink, style: { ...textStyle, fontSize: photos.length === 1 ? .07 : .044 },
    });
    add("number", "text", frame(.82, .03, .12, .045), { text: String(index + 1).padStart(2, "0"), color: look.accent,
      style: { builtinFont: "system-mono", weight: 400, fontBasis: "width", fontSize: .0275, minFontSize: .015 } });
    slides.push({ id, nodeIds, overrides: {} });
  });
  const project = createSceneProject({ name: title.trim().slice(0, 80) || "My story", assets: Object.fromEntries([...originals, ...assets].map((asset) => [asset.id, asset])), nodes, slides });
  project.shared.appearance = clone(look.appearance);
  project.recipe = { kind: "story-recipe", schema: 1, definition: definition(look), strength: 1, layout: "paper-prints-v1", outputVariant: "portrait", photoOrder: assets.map((asset) => asset.id) };
  return initializeStoryLayout(project);
}

export function storyLookCommand(project, lookId, strength = 1, slideId = null) {
  const look = STORY_LOOKS.find((item) => item.id === lookId);
  if (!look || !Number.isFinite(strength) || strength < 0 || strength > 1) throw new Error("Choose an available look and strength.");
  const appearance = Object.fromEntries(Object.entries(look.appearance).map(([key, value]) => [key, 1 + (value - 1) * strength]));
  const ids = new Set(project.slides.filter((slide) => !slideId || slide.id === slideId).flatMap((slide) => slide.nodeIds));
  const commands = [];
  if (!slideId) commands.push({ type: "shared", value: { ...project.shared, appearance } });
  for (const id of ids) {
    const node = project.nodes[id]; let patch;
    if (node.kind === "image" && slideId) patch = { appearanceBase: appearance };
    else if (id.endsWith(":paper")) patch = { color: look.paper };
    else if (id.endsWith(":caption")) patch = { color: look.ink };
    else if (id.endsWith(":number")) patch = { color: look.accent };
    if (patch) commands.push({ type: "node", id, value: { ...node, ...patch } });
  }
  const recipe = clone(project.recipe);
  if (slideId) recipe.slideLooks = { ...recipe.slideLooks, [slideId]: { definition: definition(look), strength } };
  else Object.assign(recipe, { definition: definition(look), strength });
  commands.push({ type: "recipe", value: recipe });
  return { type: "group", commands };
}

export function slidePhotos(project, slideId) {
  return project.slides.find((slide) => slide.id === slideId)?.nodeIds.map((id) => project.nodes[id]).filter((node) => node.kind === "image") ?? [];
}

export function storyLayoutCommand(project, slideId, layout) {
  if (!["prints", "straight"].includes(layout)) throw new Error("Choose an available layout.");
  const slide = project.slides.find((item) => item.id === slideId);
  const commands = [];
  for (const id of slide.nodeIds) {
    const node = project.nodes[id];
    if ((node.kind === "image" && !node.connection) || /:border-\d+$/.test(id)) commands.push({ type: "node", id, value: { ...node, rotation: layout === "straight" ? 0 : Number(id.split("-").at(-1)) % 2 ? 3 : -3 } });
  }
  return withStoryReflow(project, { type: "group", commands }, slideId);
}

export function moveStorySlide(project, slideId, offset) {
  if (!canMoveStorySlide(project, slideId, offset)) throw new Error("That slide group cannot move further in this direction.");
  const slides = clone(project.slides), group = connectedSlideGroup(project, slideId);
  const neighbor = connectedSlideGroup(project, slides[offset < 0 ? group.start - 1 : group.end + 1].id);
  const block = slides.splice(group.start, group.ids.length);
  slides.splice(offset < 0 ? neighbor.start : neighbor.end + 1 - group.ids.length, 0, ...block);
  const commands = [{ type: "slides", value: slides }];
  slides.forEach((entry, order) => {
    const id = entry.nodeIds.find((nodeId) => nodeId.endsWith(":number"));
    if (id) commands.push({ type: "node", id, value: { ...project.nodes[id], text: String(order + 1).padStart(2, "0") } });
  });
  return { type: "group", commands };
}
