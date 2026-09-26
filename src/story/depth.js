import { clone } from "../project/model.js";

export function storyDepthCommand(project, photoId, { enabled = true, background = "photo" } = {}) {
  const photo = project.nodes[photoId];
  if (photo?.kind !== "image") throw new Error("Choose a photo for the depth title.");
  if (!["photo", "page"].includes(background)) throw new Error("Choose the original photo or the page as background.");
  const value = clone(photo), slides = clone(project.slides), titleId = photo.depthTextId ?? `${photoId}:depth-title`;
  const commands = [{ type: "node", id: photoId, value }];
  if (!enabled) {
    delete value.depthTextId; delete value.depthBackground;
    if (photo.depthTextId) {
      commands.push({ type: "node", id: titleId, value: null });
      for (const slide of slides) { slide.nodeIds = slide.nodeIds.filter((id) => id !== titleId); delete slide.overrides[titleId]; }
      commands.push({ type: "slides", value: slides });
    }
    return { type: "group", commands };
  }
  if (!photo.maskId && !photo.depthTextId) throw new Error("Choose the subject in Cutout before adding a depth title.");
  if (project.nodes[titleId] && photo.depthTextId !== titleId) throw new Error("This title identity already belongs to another layer.");
  value.depthTextId = titleId; value.depthBackground = background;
  if (!photo.depthTextId) {
    const title = { id: titleId, kind: "text", space: photo.space, ...(photo.anchorSlideId ? { anchorSlideId: photo.anchorSlideId } : {}),
      text: project.name || "Your moment", frame: { x: .04, y: .07, width: .92, height: .3 }, color: "#ffffff",
      style: { builtinFont: "system-display", weight: 800, fontBasis: "width", fontSize: .18, minFontSize: .025, lineHeight: 1.05,
        fit: "shrink", align: "center", shadow: { color: "#00000088", blur: .004, x: 0, y: .002 } } };
    commands.push({ type: "node", id: titleId, value: title });
    for (const slide of slides) { const index = slide.nodeIds.indexOf(photoId); if (index >= 0) slide.nodeIds.splice(index + 1, 0, titleId); }
    commands.push({ type: "slides", value: slides });
  }
  return { type: "group", commands };
}
