const LEADING_TRIM_TYPES = Object.freeze(['NONE', 'CAP_HEIGHT']);

/** Validate a persisted semantic leading-trim value without accepting parser aliases. */
export function isValidLeadingTrim(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
    && Reflect.ownKeys(value).length === 1 && Reflect.ownKeys(value)[0] === 'type'
    && LEADING_TRIM_TYPES.includes(value.type);
}
