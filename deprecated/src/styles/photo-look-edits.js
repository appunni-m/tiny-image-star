import { validatePhotoLook } from "../compositor/photo-look.js";
import { canonicalJSON, clone } from "../project/model.js";

const field = (patch) => ({ present: Object.hasOwn(patch ?? {}, "photoLook"), value: clone(patch?.photoLook ?? null) });
function setField(patch, saved) {
  const next = { ...patch };
  if (saved.present) next.photoLook = clone(saved.value); else delete next.photoLook;
  return Object.keys(next).length ? next : null;
}
export function photoLookTargets(batch, scope) {
  if (!["all", "selected", "this"].includes(scope)) throw new Error("Choose where to apply the photo look.");
  return batch.files.filter((item) => scope === "all" || scope === "selected" && batch.selected.has(item.id) || scope === "this" && item.id === batch.activeId);
}
export function snapshotPhotoLooks(batch) {
  return { shared: field(batch.sharedOverride), items: Object.fromEntries(batch.files.map((item) => [item.id, field(item.override)])) };
}
export function applyPhotoLookEdit(batch, look, scope) {
  if (look) validatePhotoLook(look);
  const targets = photoLookTargets(batch, scope); if (!targets.length) throw new Error("Choose at least one image for this photo look.");
  const before = snapshotPhotoLooks(batch);
  if (scope === "all") {
    batch.sharedOverride = setField(batch.sharedOverride, { present: true, value: look });
    for (const item of batch.files) item.override = setField(item.override, { present: false, value: null });
  } else for (const item of targets) item.override = setField(item.override, { present: true, value: look });
  return { before, after: snapshotPhotoLooks(batch), ids: targets.map((item) => item.id) };
}
export function undoPhotoLookEdit(batch, change) {
  const current = snapshotPhotoLooks(batch);
  const agrees = canonicalJSON(current.shared) === canonicalJSON(change.after.shared)
    && Object.entries(change.after.items).every(([id, value]) => !current.items[id] || canonicalJSON(current.items[id]) === canonicalJSON(value));
  if (!agrees) throw new Error("Photo look settings changed after this edit. Choose the look to apply now.");
  batch.sharedOverride = setField(batch.sharedOverride, change.before.shared);
  for (const item of batch.files) if (change.before.items[item.id]) item.override = setField(item.override, change.before.items[item.id]);
}
