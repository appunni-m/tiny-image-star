import { action, field, range, select } from "./view.js";
import { clone } from "../project/model.js";
import { createConnectedCutout, moveConnectedCutout, positionConnectedCutout, removeConnectedCutout, reviewConnections } from "./connections.js";

export function mountConnectionPanel(content, { photoId, slideId, variantId, getProject, onCommand, onSelectPhoto }) {
  const project = getProject(), photo = project.nodes[photoId];
  const details = document.createElement("details"); details.className = "story-connection-controls"; details.open = Boolean(photo.connection);
  const summary = document.createElement("summary"); summary.textContent = "Across slides"; details.append(summary); content.append(details);
  const note = document.createElement("p"); note.className = "story-note"; details.append(note);
  if (!photo.connection) {
    note.textContent = "Add an independent copy of this subject across two neighboring slides. The original photo stays in its layout. Choose or paint a subject mask first.";
    const add = action("Add connected cutout", () => {
      const created = createConnectedCutout(getProject(), photoId, slideId);
      if (onCommand(created.command)) onSelectPhoto(created.id);
    });
    add.dataset.connectionControl = ""; add.dataset.connectionMask = photoId; add.disabled = !photo.maskId; details.append(add); return;
  }
  note.textContent = "One cutout spans both slides. These slides move together when reordered. Subject, crop, color and text edits affect both halves; position and size are saved for this output shape.";
  const preview = document.createElement("div"); preview.className = "story-connection-preview"; preview.setAttribute("role", "group"); preview.setAttribute("aria-label", "Connected spread preview");
  for (const id of [photo.anchorSlideId, photo.connection.rightSlideId]) {
    const item = document.createElement("div"), image = new Image(), label = document.createElement("span");
    image.dataset.connectionSlide = id; image.alt = `Slide ${project.slides.findIndex((slide) => slide.id === id) + 1}`;
    image.width = project.variants.find((variant) => variant.id === variantId).width; image.height = project.variants.find((variant) => variant.id === variantId).height;
    label.textContent = image.alt; item.append(image, label); preview.append(item);
  }
  details.append(preview);
  const boundary = select(project.slides.slice(0, -1).map((slide, index) => [slide.id, `Slides ${index + 1}–${index + 2}`]), photo.anchorSlideId, "Connected slides");
  boundary.addEventListener("change", () => { if (onCommand(moveConnectedCutout(getProject(), photoId, boundary.value))) onSelectPhoto(photoId, boundary.value); });
  details.append(field("Place across", boundary));
  const box = clone(photo.variantFrames?.[variantId] ?? photo.frame), position = { x: box.x + box.width / 2, y: box.y + box.height / 2, scale: 1 };
  const warning = document.createElement("p"); warning.className = "story-note"; warning.setAttribute("role", "status"); warning.dataset.connectionWarning = photoId;
  const updateWarning = () => { warning.textContent = reviewConnections(getProject(), variantId).some((entry) => entry.nodeId === photoId)
    ? "The cutout frame no longer crosses the join. Move it toward the center to connect both slides." : "The center line is the join. Review both halves before exporting."; };
  for (const [key, label, min, max] of [["x", "Across the join", 0, 2], ["y", "Cutout up / down", 0, 1], ["scale", "Connected cutout size", .25, 2]]) {
    details.append(range(label, position[key], min, max, .01, (value) => {
      position[key] = value; if (onCommand(positionConnectedCutout(getProject(), photoId, variantId, position, box))) updateWarning();
    }));
  }
  details.append(range("Connected cutout rotation", photo.rotation ?? 0, -45, 45, 1, (rotation) => {
    if (onCommand({ type: "node", id: photoId, value: { ...getProject().nodes[photoId], rotation } })) updateWarning();
  }));
  details.append(warning, action("Remove connected copy", () => { if (onCommand(removeConnectedCutout(getProject(), photoId))) onSelectPhoto(null); }));
  for (const input of details.querySelectorAll("input, select, button")) input.dataset.connectionControl = "";
  updateWarning();
}
