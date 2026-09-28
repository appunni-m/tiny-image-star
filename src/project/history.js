import { canonicalJSON, clone, validateProject } from "./model.js";

export const MAX_HISTORY_COMMANDS = 100;
export const MAX_HISTORY_BYTES = 2 * 1024 * 1024;
export const MAX_PROJECT_GROUP_COMMANDS = 512;

// Commands replace bounded parameter records by stable ID; source bytes never
// appear in the document or undo history. A group is one reversible user action.
export function applyProjectCommand(project, command) {
  const next = clone(project);
  const inverses = [];
  const commands = command.type === "group" ? command.commands : [command];
  if (!Array.isArray(commands) || commands.length > MAX_PROJECT_GROUP_COMMANDS) throw new Error("Too many project commands.");
  for (const item of commands) {
    if (["node", "asset"].includes(item.type)) {
      const map = item.type === "node" ? next.nodes : next.assets;
      if (["__proto__", "constructor", "prototype"].includes(item.id) || typeof item.id !== "string") throw new Error("Invalid command identity.");
      inverses.unshift({ type: item.type, id: item.id, value: clone(map[item.id] ?? null) });
      if (item.value === null) delete map[item.id];
      else map[item.id] = clone(item.value);
    } else if (["slides", "shared", "variants", "recipe", "name"].includes(item.type)) {
      const field = item.type === "name" ? "name" : item.type;
      inverses.unshift({ type: item.type, value: clone(next[field]) });
      next[field] = clone(item.value);
    } else throw new Error("Unsupported project command.");
  }
  next.revision = project.revision + 1;
  validateProject(next);
  return { project: next, inverse: { type: "group", commands: inverses } };
}

function difference(before, after) {
  const commands = [];
  for (const [type, field] of [["node", "nodes"], ["asset", "assets"]]) {
    for (const id of new Set([...Object.keys(before[field]), ...Object.keys(after[field])])) {
      if (canonicalJSON(before[field][id]) !== canonicalJSON(after[field][id])) commands.push({ type, id, value: clone(after[field][id] ?? null) });
    }
  }
  for (const type of ["slides", "shared", "variants", "recipe", "name"]) {
    const field = type === "name" ? "name" : type;
    if (canonicalJSON(before[field]) !== canonicalJSON(after[field])) commands.push({ type, value: clone(after[field]) });
  }
  return { type: "group", commands };
}

export class ProjectHistory {
  constructor(project) {
    this.document = clone(validateProject(project));
    this.past = [];
    this.future = [];
    this.base = null;
    this.sequence = project.revision;
  }
  update(project) { this.document = { ...project, revision: ++this.sequence }; }
  preview(command) {
    if (!this.base) this.base = this.document;
    const next = applyProjectCommand(this.document, command).project;
    if (difference(this.document, next).commands.length) this.update(next);
    return this.document;
  }
  commit(label = "Edit") {
    if (!this.base) return false;
    const command = difference(this.base, this.document);
    const base = this.base;
    this.base = null;
    if (!command.commands.length) return false;
    const { inverse } = applyProjectCommand(base, command);
    this.past.push({ label, command, inverse });
    this.future = [];
    while (this.past.length > MAX_HISTORY_COMMANDS || new TextEncoder().encode(JSON.stringify(this.past)).byteLength > MAX_HISTORY_BYTES) this.past.shift();
    return true;
  }
  apply(command, label) { this.preview(command); this.commit(label); return this.document; }
  cancel() { if (this.base) { this.update(this.base); this.base = null; } return this.document; }
  undo() {
    this.commit();
    const entry = this.past.pop();
    if (!entry) return false;
    this.update(applyProjectCommand(this.document, entry.inverse).project);
    this.future.push(entry);
    return true;
  }
  redo() {
    if (this.base) this.commit();
    const entry = this.future.pop();
    if (!entry) return false;
    this.update(applyProjectCommand(this.document, entry.command).project);
    this.past.push(entry);
    return true;
  }
}
