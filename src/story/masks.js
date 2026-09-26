import { clone } from "../project/model.js";

export function storyMaskCommand(project, photoId, asset) {
  const photo = project.nodes[photoId];
  if (photo?.kind !== "image") throw new Error("Choose a photo for the cutout.");
  const source = project.assets[photo.assetId];
  if (asset && (asset.kind !== "mask" || asset.orientation !== "upright" || asset.width !== source.width || asset.height !== source.height)) throw new Error("The mask must match the upright source photo.");
  const value = clone(photo), commands = [];
  if (asset) { commands.push({ type: "asset", id: asset.id, value: asset }); value.maskId = asset.id; }
  else delete value.maskId;
  commands.push({ type: "node", id: photoId, value });
  if (photo.maskId && photo.maskId !== asset?.id && !Object.values(project.nodes).some((node) => node.id !== photoId && node.maskId === photo.maskId)
    && !Object.values(project.assets).some((entry) => entry.workingCopy?.sourceAssetId === photo.maskId)) {
    commands.push({ type: "asset", id: photo.maskId, value: null });
  }
  return { type: "group", commands };
}

// History contains metadata, so keep the blob dependencies of undo/redo too.
// Bound extra mask history independently from the original imported photos.
export function pruneStorySources(session, maskHistoryBudget = 32 * 1024 * 1024) {
  const keep = () => {
    const ids = new Set([...Object.keys(session.history.document.assets), ...Object.keys(session.history.base?.assets ?? {})]);
    for (const entry of [...session.history.past, ...session.history.future]) for (const group of [entry.command, entry.inverse]) {
      for (const command of group.commands) if (command.type === "asset" && command.value) ids.add(command.id);
    }
    return ids;
  };
  let ids = keep();
  const extra = () => [...ids].reduce((sum, id) => sum + (!session.history.document.assets[id] && !session.history.base?.assets[id] ? session.sources.get(id)?.size ?? 0 : 0), 0);
  while (extra() > maskHistoryBudget && session.history.past.length) { session.history.past.shift(); ids = keep(); }
  while (extra() > maskHistoryBudget && session.history.future.length) { session.history.future.shift(); ids = keep(); }
  for (const id of session.sources.keys()) if (!ids.has(id)) session.sources.delete(id);
}
