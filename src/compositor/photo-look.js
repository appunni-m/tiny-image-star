// A frozen photo-color component. It contains no source image, caption, crop,
// layout, remote assets or executable instructions.
const plain = (value) => value && Object.getPrototypeOf(value) === Object.prototype;
const check = (condition, message = "Invalid saved photo look.") => { if (!condition) throw new Error(message); };
const exact = (value, fields) => plain(value) && Object.keys(value).length === fields.length && fields.every((key) => Object.hasOwn(value, key));
const finite = (value, min, max) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

export function validatePhotoLook(look) {
  check(exact(look, ["version", "definition", "strength"]) && look.version === 1, "This photo look needs a different app version.");
  check(finite(look.strength, 0, 1), "Photo color strength must be between 0 and 100%.");
  const definition = look.definition;
  check(exact(definition, ["id", "revision", "name", "engine", "appearance"]));
  check(typeof definition.id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/.test(definition.id)
    && !["constructor", "prototype"].includes(definition.id));
  check(Number.isSafeInteger(definition.revision) && finite(definition.revision, 1, 1_000_000));
  check(typeof definition.name === "string" && definition.name.trim().length > 0 && definition.name.length <= 80);
  check(exact(definition.engine, ["name", "versions", "compositors"]));
  check(typeof definition.engine.name === "string" && /^[a-z0-9-]{1,64}$/.test(definition.engine.name));
  for (const key of ["versions", "compositors"]) check(Array.isArray(definition.engine[key]) && definition.engine[key].length > 0
    && definition.engine[key].length <= 8 && definition.engine[key].every((value) => typeof value === "string" && /^[a-zA-Z0-9.+_-]{1,80}$/.test(value)));
  check(plain(definition.appearance) && Object.keys(definition.appearance).every((key) => ["brightness", "contrast", "saturation", "grayscaleMix"].includes(key)));
  for (const [key, value] of Object.entries(definition.appearance)) check(finite(value, 0, key === "grayscaleMix" ? 1 : 4));
  return look;
}

export function photoLookAppearance(look, engine) {
  validatePhotoLook(look);
  const required = look.definition.engine;
  check(required.name === engine.name && required.versions.includes(engine.version) && required.compositors.includes(engine.compositor),
    "This photo look needs a different renderer. Choose a supported look or remove it explicitly.");
  return Object.fromEntries(Object.entries(look.definition.appearance).map(([key, value]) => {
    const neutral = key === "grayscaleMix" ? 0 : 1;
    return [key, neutral + (value - neutral) * look.strength];
  }));
}

export function photoLookLabel(look) {
  if (!look) return "No photo look";
  validatePhotoLook(look);
  return `${look.definition.name} · version ${look.definition.revision} · ${Math.round(look.strength * 100)}%`;
}
