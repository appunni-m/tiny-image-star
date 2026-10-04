const namedKeys = new Map([
  ['enter', 'Enter'], ['return', 'Enter'], ['space', 'Space'], ['spacebar', 'Space'], [' ', 'Space'],
  ['escape', 'Escape'], ['esc', 'Escape'], ['tab', 'Tab'], ['backspace', 'Backspace'], ['delete', 'Delete'],
  ['arrowleft', 'ArrowLeft'], ['arrowright', 'ArrowRight'], ['arrowup', 'ArrowUp'], ['arrowdown', 'ArrowDown'],
  ['home', 'Home'], ['end', 'End'], ['pageup', 'PageUp'], ['pagedown', 'PageDown']
]);
const modifierNames = ['shift', 'control', 'alt', 'meta'];

export function normalizePrototypeKeyboardKey(value) {
  if (typeof value !== 'string') return null;
  if (value === ' ') return 'Space';
  const key = value.trim();
  if (!key || key.length > 32) return null;
  const normalized = namedKeys.get(key.toLowerCase());
  if (normalized) return normalized;
  if (/^[a-z0-9]$/i.test(key)) return key.toLowerCase();
  const functionKey = /^f([1-9]|1[0-2])$/i.exec(key);
  return functionKey ? `F${functionKey[1]}` : null;
}

export function normalizePrototypeKeyModifiers(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(name => !modifierNames.includes(name))
    || modifierNames.some(name => Object.hasOwn(value, name) && typeof value[name] !== 'boolean')) return null;
  return Object.fromEntries(modifierNames.map(name => [name, value[name] === true]));
}

export function prototypeKeyboardEventMatches(key, modifiers, event) {
  const normalizedKey = normalizePrototypeKeyboardKey(event?.key === ' ' ? 'Space' : event?.key);
  const expectedModifiers = normalizePrototypeKeyModifiers(modifiers);
  if (!normalizedKey || normalizedKey !== normalizePrototypeKeyboardKey(key) || !expectedModifiers) return false;
  return expectedModifiers.shift === (event.shiftKey === true)
    && expectedModifiers.control === (event.ctrlKey === true)
    && expectedModifiers.alt === (event.altKey === true)
    && expectedModifiers.meta === (event.metaKey === true);
}
