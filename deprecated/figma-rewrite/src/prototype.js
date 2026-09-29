const MAX_INTERACTIONS_PER_LAYER = 128;
const TRIGGERS = new Set(["click", "hover"]);
const ACTIONS = new Set(["navigate", "back"]);

export function normalizePrototypeInteractions(value, frameIds) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_INTERACTIONS_PER_LAYER) {
    throw new Error("The project contains too many prototype interactions");
  }
  const seen = new Set();
  return value.map((interaction) => {
    if (!interaction || typeof interaction.id !== "string" || !interaction.id.length || interaction.id.length > 200
      || seen.has(interaction.id) || !TRIGGERS.has(interaction.trigger) || !ACTIONS.has(interaction.action)) {
      throw new Error("The project contains an invalid prototype interaction");
    }
    seen.add(interaction.id);
    if (interaction.action === "navigate") {
      if (typeof interaction.destinationId !== "string" || !frameIds.has(interaction.destinationId)) {
        throw new Error("A prototype interaction points to a missing frame");
      }
      return { id: interaction.id, trigger: interaction.trigger, action: interaction.action, destinationId: interaction.destinationId };
    }
    return { id: interaction.id, trigger: interaction.trigger, action: interaction.action };
  });
}
