import { validateDocument } from './model.js';

/**
 * Local-only adapter between Tiny Image Star variables and DTCG token JSON.
 *
 * The DTCG format does not define collection or mode semantics. We put those
 * semantics in a vendor extension while keeping the default mode as ordinary
 * DTCG tokens, so tools which ignore the extension still see useful tokens.
 */

export const TINY_IMAGE_STAR_DTCG_EXTENSION = 'tiny-image-star';
const supportedTypes = new Set(['color', 'number', 'string', 'boolean']);
const dtcgPrimitiveTypes = new Set(['color', 'number', 'string']);

export class DesignTokenInteropError extends TypeError {
  constructor(message, code = 'INVALID_DTCG') {
    super(message);
    this.name = 'DesignTokenInteropError';
    this.code = code;
  }
}

function fail(message, code) {
  throw new DesignTokenInteropError(message, code);
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function parseInput(input) {
  let document;
  try {
    document = typeof input === 'string' ? JSON.parse(input) : input;
  } catch (error) {
    fail(`Invalid design-token JSON: ${error.message}`, 'INVALID_JSON');
  }
  if (!isRecord(document)) fail('A DTCG token document must be a JSON object.', 'INVALID_DOCUMENT');
  return document;
}

function newId(prefix) {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}-${uuid}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function assertDtcgNameSegment(name, label) {
  if (typeof name !== 'string' || !name.trim()) fail(`${label} must be a non-empty DTCG name.`, 'INVALID_NAME');
  if (name.startsWith('$') || /[{}.]/u.test(name)) {
    fail(`${label} "${name}" cannot be represented as a DTCG path segment (names cannot start with "$" or contain braces or periods).`, 'UNSUPPORTED_NAME');
  }
}

function assertLocalValue(type, value, label) {
  const valid = type === 'color'
    ? typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)
    : type === 'number' ? typeof value === 'number' && Number.isFinite(value)
      : type === 'string' ? typeof value === 'string'
        : type === 'boolean' ? typeof value === 'boolean' : false;
  if (!valid) fail(`${label} has an invalid ${type} value.`, 'INVALID_LOCAL_VALUE');
  if (type === 'string' && /[{}]/u.test(value)) {
    fail(`${label} contains braces, which are ambiguous with DTCG token references.`, 'AMBIGUOUS_STRING');
  }
}

function localColorToDtcg(hex) {
  const normalized = hex.toLowerCase();
  const channels = [1, 3, 5].map(index => Number.parseInt(normalized.slice(index, index + 2), 16));
  return {
    colorSpace: 'srgb',
    components: channels.map(channel => channel / 255),
    hex: normalized
  };
}

function dtcgColorToLocal(value, label) {
  if (!isRecord(value)) fail(`${label} must use the DTCG color object form.`, 'UNSUPPORTED_COLOR');
  const allowed = new Set(['colorSpace', 'components', 'alpha', 'hex']);
  if (Object.keys(value).some(key => !allowed.has(key))) fail(`${label} contains unsupported color properties.`, 'UNSUPPORTED_COLOR');
  if (value.colorSpace !== 'srgb') fail(`${label} uses ${String(value.colorSpace)}; only sRGB can be represented without color loss.`, 'UNSUPPORTED_COLOR_SPACE');
  if (!Array.isArray(value.components) || value.components.length !== 3
    || value.components.some(channel => typeof channel !== 'number' || !Number.isFinite(channel) || channel < 0 || channel > 1)) {
    fail(`${label} must have three numeric sRGB components from 0 to 1.`, 'INVALID_COLOR');
  }
  if (value.alpha !== undefined && value.alpha !== 1) fail(`${label} has transparency, which Tiny Image Star color variables cannot represent.`, 'UNSUPPORTED_ALPHA');
  const channels = value.components.map(channel => Math.round(channel * 255));
  const hex = `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
  const exactChannels = value.components.every((channel, index) => Math.abs(channel - channels[index] / 255) < 1e-10);
  if (!exactChannels && value.hex === undefined) fail(`${label} has more precision than Tiny Image Star's 8-bit color variables can preserve; provide a matching DTCG fallback hex value.`, 'UNSUPPORTED_COLOR_PRECISION');
  if (value.hex !== undefined && (typeof value.hex !== 'string' || !/^#[\da-f]{6}$/i.test(value.hex) || value.hex.toLowerCase() !== hex)) {
    fail(`${label} has a fallback hex value inconsistent with its sRGB components.`, 'COLOR_FALLBACK_MISMATCH');
  }
  return hex;
}

function jsonPointerEscape(segment) {
  return String(segment).replaceAll('~', '~0').replaceAll('/', '~1');
}

function jsonPointerUnescape(segment) {
  if (/~(?![01])/u.test(segment)) fail(`Invalid JSON Pointer escape in "${segment}".`, 'INVALID_REFERENCE');
  return segment.replaceAll('~1', '/').replaceAll('~0', '~');
}

function makePathKey(path) {
  return JSON.stringify(path);
}

function splitLocalVariableName(name, label) {
  if (typeof name !== 'string' || !name.trim()) fail(`${label} must be a non-empty string.`, 'INVALID_NAME');
  const segments = name.split('.');
  segments.forEach((segment, index) => assertDtcgNameSegment(segment, `${label} segment ${index + 1}`));
  return segments;
}

function validateLocalDocument(document) {
  const collections = document?.variableCollections;
  const variables = document?.variables;
  if (!Array.isArray(collections) || !Array.isArray(variables)) {
    fail('Export requires variableCollections and variables arrays.', 'INVALID_LOCAL_DOCUMENT');
  }
  const collectionIds = new Set();
  const collectionNames = new Set();
  for (const collection of collections) {
    if (!isRecord(collection) || typeof collection.id !== 'string' || !collection.id || collectionIds.has(collection.id)) {
      fail('Variable collections need unique non-empty IDs.', 'INVALID_LOCAL_COLLECTION');
    }
    assertDtcgNameSegment(collection.name, `Collection ${collection.id}`);
    if (!Array.isArray(collection.modes) || !collection.modes.length) fail(`Collection "${collection.name}" must have at least one mode.`, 'INVALID_LOCAL_MODE');
    const groupKey = collection.name;
    if (collectionNames.has(groupKey)) fail(`Two collections use the same DTCG group name "${groupKey}".`, 'AMBIGUOUS_COLLECTION');
    collectionNames.add(groupKey);
    collectionIds.add(collection.id);
    const modeIds = new Set();
    const modeNames = new Set();
    for (const mode of collection.modes) {
      if (!isRecord(mode) || typeof mode.id !== 'string' || !mode.id || modeIds.has(mode.id)
        || typeof mode.name !== 'string' || !mode.name.trim() || modeNames.has(mode.name.toLowerCase())) {
        fail(`Collection "${collection.name}" has an invalid or duplicate mode.`, 'INVALID_LOCAL_MODE');
      }
      modeIds.add(mode.id);
      modeNames.add(mode.name.toLowerCase());
    }
    if (!modeIds.has(collection.defaultModeId)) fail(`Collection "${collection.name}" has no valid default mode.`, 'INVALID_LOCAL_MODE');
  }

  const variableIds = new Set();
  const byId = new Map();
  const variablePaths = new Map();
  const namesByCollection = new Map();
  const pathsByCollection = new Map();
  for (const variable of variables) {
    const collection = collections.find(item => item.id === variable?.collectionId);
    if (!isRecord(variable) || typeof variable.id !== 'string' || !variable.id || variableIds.has(variable.id)
      || !collection || !supportedTypes.has(variable.type) || typeof variable.name !== 'string' || !variable.name.trim()) {
      fail('A variable has an invalid identity, collection, name, or type.', 'INVALID_LOCAL_VARIABLE');
    }
    const nameKey = variable.name.toLowerCase();
    const seenNames = namesByCollection.get(collection.id) || new Set();
    if (seenNames.has(nameKey)) fail(`Collection "${collection.name}" has case-insensitive duplicate variable name "${variable.name}".`, 'AMBIGUOUS_VARIABLE_NAME');
    seenNames.add(nameKey);
    namesByCollection.set(collection.id, seenNames);
    const segments = splitLocalVariableName(variable.name, `Variable "${variable.name}"`);
    const fullPath = [collection.name, ...segments];
    const pathKey = makePathKey(fullPath);
    if (variablePaths.has(pathKey)) fail(`Two variables map to DTCG path "${fullPath.join('.')}".`, 'AMBIGUOUS_VARIABLE_PATH');
    variablePaths.set(pathKey, variable);
    variableIds.add(variable.id);
    byId.set(variable.id, variable);
    const collectionPaths = pathsByCollection.get(collection.id) || [];
    collectionPaths.push({ segments, variable });
    pathsByCollection.set(collection.id, collectionPaths);

    if (!isRecord(variable.valuesByMode)) fail(`Variable "${variable.name}" must have values for every mode.`, 'INVALID_LOCAL_VALUE');
    const expectedModes = new Set(collection.modes.map(mode => mode.id));
    if (Object.keys(variable.valuesByMode).length !== expectedModes.size
      || Object.keys(variable.valuesByMode).some(modeId => !expectedModes.has(modeId))) {
      fail(`Variable "${variable.name}" must have exactly one value per collection mode.`, 'INVALID_LOCAL_VALUE');
    }
    for (const mode of collection.modes) assertLocalValue(variable.type, variable.valuesByMode[mode.id], `Variable "${variable.name}" in mode "${mode.name}"`);
    if (variable.aliasesByMode !== undefined) {
      if (!isRecord(variable.aliasesByMode) || Object.keys(variable.aliasesByMode).some(modeId => !expectedModes.has(modeId))) {
        fail(`Variable "${variable.name}" has invalid mode aliases.`, 'INVALID_LOCAL_ALIAS');
      }
    }
  }
  for (const variable of variables) for (const targetId of Object.values(variable.aliasesByMode || {})) {
    const target = byId.get(targetId);
    if (!target || target.type !== variable.type || target.id === variable.id) {
      fail(`Variable "${variable.name}" has a missing, self-referential, or type-incompatible alias.`, 'INVALID_LOCAL_ALIAS');
    }
  }
  assertNoAliasCycles(variables, byId, 'The local variables contain a circular alias.');

  // Token/group collisions are forbidden by DTCG (an object cannot be both).
  for (const collection of collections) {
    const paths = pathsByCollection.get(collection.id) || [];
    const occupied = new Map();
    for (const { segments, variable } of paths) {
      for (let i = 1; i <= segments.length; i++) {
        const current = makePathKey([collection.name, ...segments.slice(0, i)]);
        const role = i === segments.length ? 'token' : 'group';
        const prior = occupied.get(current);
        if (prior && (prior.role === 'token' || role === 'token')) {
          fail(`Variable "${variable.name}" collides with the token/group path "${[collection.name, ...segments.slice(0, i)].join('.') }".`, 'AMBIGUOUS_VARIABLE_PATH');
        }
        occupied.set(current, { role, variable });
      }
    }
  }
  return { collections, variables, byId, variablePaths, pathsByCollection };
}

function assertNoAliasCycles(variables, byId, message) {
  const state = new Map();
  const visit = id => {
    if (state.get(id) === 1) fail(message, 'ALIAS_CYCLE');
    if (state.get(id) === 2) return;
    state.set(id, 1);
    const variable = byId.get(id);
    for (const targetId of new Set(Object.values(variable?.aliasesByMode || {}))) visit(targetId);
    state.set(id, 2);
  };
  for (const variable of variables) visit(variable.id);
}

function insertToken(root, path, token) {
  let group = root;
  for (const segment of path.slice(0, -1)) {
    if (hasOwn(group, segment)) {
      if (!isRecord(group[segment]) || hasOwn(group[segment], '$value') || hasOwn(group[segment], '$ref')) {
        fail(`DTCG path "${path.join('.')}" collides with an existing token.`, 'AMBIGUOUS_VARIABLE_PATH');
      }
    } else group[segment] = {};
    group = group[segment];
  }
  const leaf = path[path.length - 1];
  if (hasOwn(group, leaf)) fail(`DTCG path "${path.join('.')}" is defined more than once.`, 'AMBIGUOUS_VARIABLE_PATH');
  group[leaf] = token;
}

/** Export local variables as ordinary DTCG token JSON plus a Tiny Image Star extension. */
export function exportDtcgTokens(document) {
  const { collections, variables, byId, pathsByCollection } = validateLocalDocument(document);
  const output = {};
  const extension = {
    format: 'tiny-image-star-variable-interop',
    version: 1,
    collections: collections.map(collection => structuredClone(collection)),
    variables: variables.map(variable => ({
      ...structuredClone(variable),
      path: [collectionById(collections, variable.collectionId).name, ...splitLocalVariableName(variable.name, `Variable "${variable.name}"`)]
    }))
  };
  const rootExtensions = { [TINY_IMAGE_STAR_DTCG_EXTENSION]: extension };
  output.$extensions = rootExtensions;

  for (const collection of collections) {
    const collectionGroup = {};
    output[collection.name] = collectionGroup;
    for (const { segments, variable } of pathsByCollection.get(collection.id) || []) {
      const path = [collection.name, ...segments];
      const modeId = collection.defaultModeId;
      const token = { $type: variable.type === 'boolean' ? 'string' : variable.type };
      const defaultAliasId = variable.aliasesByMode?.[modeId];
      if (defaultAliasId) {
        const target = byId.get(defaultAliasId);
        const targetCollection = collectionById(collections, target.collectionId);
        const targetPath = [targetCollection.name, ...splitLocalVariableName(target.name, `Variable "${target.name}"`)];
        token.$ref = `#/${targetPath.map(jsonPointerEscape).join('/')}/$value`;
      } else if (variable.type === 'color') token.$value = localColorToDtcg(variable.valuesByMode[modeId]);
      else if (variable.type === 'boolean') token.$value = String(variable.valuesByMode[modeId]);
      else token.$value = variable.valuesByMode[modeId];
      insertToken(collectionGroup, segments, token);
    }
  }
  return output;
}

function collectionById(collections, id) {
  const collection = collections.find(item => item.id === id);
  if (!collection) fail(`Missing variable collection "${id}".`, 'INVALID_LOCAL_DOCUMENT');
  return collection;
}

/** Serialize a DTCG document. No network or application upload is performed. */
export function stringifyDtcgTokens(document, space = 2) {
  try {
    return JSON.stringify(exportDtcgTokens(document), null, space);
  } catch (error) {
    if (error instanceof DesignTokenInteropError) throw error;
    fail(`Could not serialize design tokens: ${error.message}`, 'SERIALIZATION_FAILED');
  }
}

function collectTokens(document) {
  const tokens = [];
  const warnings = [];
  const walk = (group, path, inheritedType) => {
    if (!isRecord(group)) fail(`DTCG group "${path.join('.')}" must be an object.`, 'INVALID_GROUP');
    if (hasOwn(group, '$type') && typeof group.$type !== 'string') fail(`Group "${path.join('.')}" has a non-string $type.`, 'INVALID_TYPE');
    const groupType = group.$type ?? inheritedType;
    if (group.$extends !== undefined) fail(`Group "${path.join('.')}" uses $extends, which is not supported by this local adapter.`, 'UNSUPPORTED_GROUP_EXTENSION');
    if (group.$description !== undefined || group.$deprecated !== undefined) {
      fail(`Group metadata on "${path.join('.')}" cannot be preserved by the Tiny Image Star variable model.`, 'UNSUPPORTED_METADATA');
    }
    if (group.$extensions !== undefined && path.length > 0) warnings.push(`Ignored non-root extensions on group "${path.join('.')}".`);
    const tokenLike = hasOwn(group, '$value') || hasOwn(group, '$ref');
    const children = Object.keys(group).filter(key => !key.startsWith('$'));
    if (tokenLike && children.length) fail(`"${path.join('.')}" is both a token and a group.`, 'AMBIGUOUS_TOKEN_GROUP');
    if (tokenLike) {
      for (const key of Object.keys(group)) {
        if (key.startsWith('$') && !['$value', '$ref', '$type', '$description', '$deprecated', '$extensions'].includes(key)) {
          fail(`Token "${path.join('.')}" uses unsupported property ${key}.`, 'UNSUPPORTED_PROPERTY');
        }
      }
      if (group.$description !== undefined || group.$deprecated !== undefined) fail(`Token metadata on "${path.join('.')}" cannot be preserved by the Tiny Image Star variable model.`, 'UNSUPPORTED_METADATA');
      if (hasOwn(group, '$value') && hasOwn(group, '$ref')) fail(`Token "${path.join('.')}" cannot have both $value and $ref.`, 'INVALID_TOKEN');
      if (!hasOwn(group, '$value') && typeof group.$ref !== 'string') fail(`Token "${path.join('.')}" has an invalid $ref.`, 'INVALID_REFERENCE');
      if (hasOwn(group, '$type') && typeof group.$type !== 'string') fail(`Token "${path.join('.')}" has a non-string $type.`, 'INVALID_TYPE');
      tokens.push({ path, node: group, inheritedType: group.$type ?? inheritedType, aliasPath: null, type: null, value: null });
      return;
    }
    for (const key of Object.keys(group)) {
      if (key.startsWith('$')) {
        if (!['$type', '$extensions', '$description', '$deprecated', '$extends'].includes(key)) {
          fail(`Group "${path.join('.')}" uses unsupported property ${key}.`, 'UNSUPPORTED_PROPERTY');
        }
        continue;
      }
      if (key === '$root') fail(`Reserved DTCG root token at "${[...path, key].join('.')}" is not supported by this adapter.`, 'UNSUPPORTED_ROOT_TOKEN');
      assertDtcgNameSegment(key, `DTCG name at "${[...path, key].join('.')}"`);
      const child = group[key];
      if (!isRecord(child)) fail(`DTCG child "${[...path, key].join('.')}" must be an object.`, 'INVALID_TOKEN');
      walk(child, [...path, key], groupType);
    }
  };
  walk(document, [], undefined);
  return { tokens, warnings };
}

function pointerAliasToPath(reference) {
  if (!reference.startsWith('#/')) fail(`External or non-token JSON Pointer "${reference}" is unsupported; only local token aliases are accepted.`, 'UNSUPPORTED_REFERENCE');
  if (reference.includes('%')) fail(`Percent-encoded JSON Pointer "${reference}" is ambiguous in this adapter.`, 'INVALID_REFERENCE');
  const parts = reference.slice(2).split('/').map(jsonPointerUnescape);
  if (parts.length < 2 || parts.at(-1) !== '$value') fail(`JSON Pointer "${reference}" must target a complete token's $value.`, 'UNSUPPORTED_REFERENCE');
  return parts.slice(0, -1);
}

function curlyAliasToPath(value, label) {
  const match = /^\{([^{}]+)\}$/u.exec(value);
  if (match) {
    const path = match[1].split('.');
    if (path.some(segment => !segment)) fail(`${label} has an empty segment in its DTCG reference.`, 'INVALID_REFERENCE');
    return path;
  }
  if (/[{}]/u.test(value)) fail(`${label} contains a partial or malformed token reference.`, 'INVALID_REFERENCE');
  return null;
}

function resolveAliasPath(token, byPath) {
  const node = token.node;
  if (typeof node.$ref === 'string') return pointerAliasToPath(node.$ref);
  if (typeof node.$value === 'string') return curlyAliasToPath(node.$value, `Token "${token.path.join('.')}"`);
  return null;
}

function typeFromDtcg(type, label, customType = null) {
  if (customType === 'boolean') return 'boolean';
  if (typeof type !== 'string') fail(`${label} has no explicit or inherited DTCG type.`, 'MISSING_TYPE');
  if (!dtcgPrimitiveTypes.has(type)) fail(`${label} uses unsupported DTCG type "${type}".`, 'UNSUPPORTED_TYPE');
  return type;
}

function parseExternalDocument(document, options, warnings) {
  const { tokens } = collectTokens(document);
  const byPath = new Map();
  for (const token of tokens) {
    const key = makePathKey(token.path);
    if (byPath.has(key)) fail(`DTCG path "${token.path.join('.')}" is defined more than once.`, 'AMBIGUOUS_TOKEN_PATH');
    byPath.set(key, token);
    token.aliasPath = resolveAliasPath(token, byPath);
  }
  // Resolve references after all token paths have been indexed.
  for (const token of tokens) token.aliasPath = resolveAliasPath(token, byPath);

  const resolving = new Set();
  const resolved = new Set();
  const resolveToken = token => {
    if (resolved.has(token)) return token;
    if (resolving.has(token)) fail(`DTCG alias cycle at "${token.path.join('.')}".`, 'ALIAS_CYCLE');
    resolving.add(token);
    let type = token.inheritedType;
    let aliasTarget = null;
    if (token.aliasPath) {
      aliasTarget = byPath.get(makePathKey(token.aliasPath));
      if (!aliasTarget) fail(`DTCG alias from "${token.path.join('.')}" points to missing token "${token.aliasPath.join('.')}".`, 'UNRESOLVED_REFERENCE');
      resolveToken(aliasTarget);
      if (type == null) type = aliasTarget.type;
      if (type !== aliasTarget.type) fail(`DTCG alias "${token.path.join('.')}" has a different type from its target.`, 'TYPE_MISMATCH');
    }
    const localType = token.localType;
    token.type = typeFromDtcg(type, `Token "${token.path.join('.')}"`, localType);
    if (aliasTarget) token.value = structuredClone(aliasTarget.value);
    else if (token.type === 'color') token.value = dtcgColorToLocal(token.node.$value, `Token "${token.path.join('.')}"`);
    else {
      const value = token.node.$value;
      assertLocalValue(token.type, value, `Token "${token.path.join('.')}"`);
      token.value = value;
    }
    resolving.delete(token);
    resolved.add(token);
    return token;
  };
  for (const token of tokens) resolveToken(token);

  const collectionName = options.collectionName ?? 'Imported tokens';
  if (typeof collectionName !== 'string' || !collectionName.trim()) fail('collectionName must be a non-empty string.', 'INVALID_OPTION');
  assertDtcgNameSegment(collectionName.trim(), 'Imported collection name');
  const mode = { id: newId('mode'), name: 'Mode 1' };
  const collection = { id: newId('collection'), name: collectionName.trim(), defaultModeId: mode.id, modes: [mode] };
  const idsByPath = new Map();
  const names = new Set();
  const variables = tokens.map(token => {
    const name = token.path.join('.');
    const nameKey = name.toLowerCase();
    if (names.has(nameKey)) fail(`DTCG paths collapse to the same case-insensitive Tiny Image Star variable name "${name}".`, 'AMBIGUOUS_VARIABLE_NAME');
    names.add(nameKey);
    const variable = {
      id: newId('variable'), collectionId: collection.id, name, type: token.type,
      valuesByMode: { [mode.id]: structuredClone(token.value) }
    };
    idsByPath.set(makePathKey(token.path), variable.id);
    return variable;
  });
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!token.aliasPath) continue;
    const targetId = idsByPath.get(makePathKey(token.aliasPath));
    if (!targetId) fail(`DTCG alias target "${token.aliasPath.join('.')}" could not be mapped.`, 'UNRESOLVED_REFERENCE');
    variables[index].aliasesByMode = { [mode.id]: targetId };
  }
  assertNoAliasCycles(variables, new Map(variables.map(variable => [variable.id, variable])), 'The imported DTCG tokens contain a circular alias.');
  if (document.$extensions && !document.$extensions[TINY_IMAGE_STAR_DTCG_EXTENSION]) {
    warnings.push('Non-Tiny Image Star root extensions were ignored; the variable model has no place to retain them.');
  }
  return { variableCollections: [collection], variables, warnings };
}

function assertExtensionDocument(extension, tokens, warnings = []) {
  if (!isRecord(extension) || extension.format !== 'tiny-image-star-variable-interop' || extension.version !== 1
    || !Array.isArray(extension.collections) || !Array.isArray(extension.variables)) {
    fail('The Tiny Image Star DTCG extension is malformed or unsupported.', 'INVALID_EXTENSION');
  }
  const local = { variableCollections: extension.collections, variables: extension.variables.map(variable => {
    if (!isRecord(variable) || !Array.isArray(variable.path)) fail('The Tiny Image Star variable extension entry is malformed.', 'INVALID_EXTENSION');
    const { path, ...localVariable } = variable;
    return localVariable;
  }) };
  const validated = validateLocalDocument(local);
  const tokenByPath = new Map(tokens.map(token => [makePathKey(token.path), token]));
  const expectedPaths = new Set();
  const variableById = validated.byId;
  const pathById = new Map();
  for (const entry of extension.variables) {
    const collection = collectionById(validated.collections, entry.collectionId);
    assertDtcgNameSegment(entry.path[0], `Variable path for "${entry.name}"`);
    const expected = [collection.name, ...splitLocalVariableName(entry.name, `Variable "${entry.name}"`)];
    if (makePathKey(entry.path) !== makePathKey(expected)) fail(`Extension path for "${entry.name}" does not match its collection/name.`, 'INVALID_EXTENSION');
    const key = makePathKey(entry.path);
    if (expectedPaths.has(key)) fail(`Extension repeats DTCG path "${entry.path.join('.')}".`, 'INVALID_EXTENSION');
    expectedPaths.add(key);
    pathById.set(entry.id, entry.path);
    const token = tokenByPath.get(key);
    if (!token) fail(`The extension refers to missing DTCG token "${entry.path.join('.')}".`, 'INVALID_EXTENSION');
    const collectionMode = collection.defaultModeId;
    const aliasId = entry.aliasesByMode?.[collectionMode];
    const tokenAlias = resolveAliasPath(token, tokenByPath);
    if (aliasId) {
      const target = variableById.get(aliasId);
      const targetPath = pathById.get(aliasId) || extension.variables.find(candidate => candidate.id === aliasId)?.path;
      if (!target || !targetPath || !tokenAlias || makePathKey(tokenAlias) !== makePathKey(targetPath)) {
        fail(`Default DTCG reference for "${entry.name}" does not match its Tiny Image Star alias.`, 'INVALID_EXTENSION');
      }
      const projectedType = entry.type === 'boolean' ? 'string' : entry.type;
      if (token.node.$type !== projectedType) fail(`DTCG type for "${entry.name}" disagrees with its Tiny Image Star extension.`, 'INVALID_EXTENSION');
    } else {
      if (tokenAlias) fail(`DTCG token "${entry.name}" has an alias absent from the Tiny Image Star extension.`, 'INVALID_EXTENSION');
      const value = token.node.$value;
      const expectedValue = entry.valuesByMode[collectionMode];
      const projection = entry.type === 'color' ? dtcgColorToLocal(value, `Token "${entry.name}"`)
        : entry.type === 'boolean' ? (value === 'true' ? true : value === 'false' ? false : null)
          : value;
      const projectedType = entry.type === 'boolean' ? 'string' : entry.type;
      if (token.node.$type !== projectedType) fail(`DTCG type for "${entry.name}" disagrees with its Tiny Image Star extension.`, 'INVALID_EXTENSION');
      if (projection === null || !Object.is(projection, expectedValue)) fail(`DTCG default value for "${entry.name}" disagrees with its Tiny Image Star extension.`, 'INVALID_EXTENSION');
    }
  }
  if (expectedPaths.size !== tokenByPath.size) fail('The Tiny Image Star extension does not account for every DTCG token.', 'INVALID_EXTENSION');
  // Extension graph aliases are ID-based and already validated for existence/type/cycles.
  return { variableCollections: structuredClone(validated.collections), variables: structuredClone(validated.variables), warnings };
}

/** Import DTCG JSON or an object parsed locally into Tiny Image Star variable data. */
export function importDtcgTokens(input, options = {}) {
  if (!isRecord(options)) fail('Import options must be an object.', 'INVALID_OPTION');
  const document = parseInput(input);
  const warnings = [];
  const { tokens, warnings: parseWarnings } = collectTokens(document);
  warnings.push(...parseWarnings);
  const byPath = new Map(tokens.map(token => [makePathKey(token.path), token]));
  for (const token of tokens) token.aliasPath = resolveAliasPath(token, byPath);

  if (document.$extensions !== undefined && !isRecord(document.$extensions)) fail('Root $extensions must be an object.', 'INVALID_EXTENSION');
  const rootExtension = document.$extensions?.[TINY_IMAGE_STAR_DTCG_EXTENSION];
  if (rootExtension !== undefined) {
    const otherExtensions = Object.keys(document.$extensions || {}).filter(key => key !== TINY_IMAGE_STAR_DTCG_EXTENSION);
    if (otherExtensions.length) warnings.push(`Ignored non-Tiny Image Star root extension(s): ${otherExtensions.join(', ')}.`);
    return assertExtensionDocument(rootExtension, tokens, warnings);
  }
  return parseExternalDocument(document, options, warnings);
}

/**
 * Merge imported variables into a cloned Tiny Image Star document.
 * Collection, mode, and variable IDs are regenerated so aliases stay local and
 * the imported package cannot overwrite existing document identities.
 */
export function mergeDtcgTokens(document, imported) {
  if (!isRecord(document) || !Array.isArray(imported?.variableCollections) || !Array.isArray(imported?.variables)) {
    fail('Merging tokens requires a design document and imported DTCG variable data.', 'INVALID_MERGE_INPUT');
  }
  let nextDocument;
  try {
    validateDocument(document);
    validateLocalDocument(imported);
    nextDocument = structuredClone(document);
  } catch (error) {
    if (error instanceof DesignTokenInteropError) throw error;
    fail(`The design or imported token data is invalid: ${error.message}`, 'INVALID_MERGE_INPUT');
  }

  const existingCollectionNames = new Set((nextDocument.variableCollections || []).map(collection => collection.name.toLocaleLowerCase()));
  const incomingCollectionNames = new Set();
  for (const collection of imported.variableCollections) {
    const name = collection.name.toLocaleLowerCase();
    if (existingCollectionNames.has(name) || incomingCollectionNames.has(name)) {
      fail(`A variable collection named "${collection.name}" already exists in this design.`, 'COLLECTION_NAME_CONFLICT');
    }
    incomingCollectionNames.add(name);
  }

  const collectionIdMap = new Map();
  const modeIdMaps = new Map();
  const usedCollectionIds = new Set((nextDocument.variableCollections || []).map(collection => collection.id));
  const mergedCollections = imported.variableCollections.map(collection => {
    let id = newId('collection');
    while (usedCollectionIds.has(id)) id = newId('collection');
    usedCollectionIds.add(id);
    collectionIdMap.set(collection.id, id);
    const modeMap = new Map();
    const usedModeIds = new Set();
    const modes = collection.modes.map(mode => {
      let modeId = newId('mode');
      while (usedModeIds.has(modeId)) modeId = newId('mode');
      usedModeIds.add(modeId);
      modeMap.set(mode.id, modeId);
      return { ...structuredClone(mode), id: modeId };
    });
    modeIdMaps.set(collection.id, modeMap);
    return {
      ...structuredClone(collection),
      id,
      modes,
      defaultModeId: modeMap.get(collection.defaultModeId)
    };
  });

  const usedVariableIds = new Set((nextDocument.variables || []).map(variable => variable.id));
  const variableIdMap = new Map();
  for (const variable of imported.variables) {
    let id = newId('variable');
    while (usedVariableIds.has(id)) id = newId('variable');
    usedVariableIds.add(id);
    variableIdMap.set(variable.id, id);
  }
  const mergedVariables = imported.variables.map(variable => {
    const modeMap = modeIdMaps.get(variable.collectionId);
    const valuesByMode = {};
    for (const [sourceModeId, value] of Object.entries(variable.valuesByMode)) {
      const modeId = modeMap?.get(sourceModeId);
      if (!modeId) fail(`Variable "${variable.name}" refers to a mode outside its collection.`, 'INVALID_MERGE_INPUT');
      valuesByMode[modeId] = structuredClone(value);
    }
    let aliasesByMode;
    if (variable.aliasesByMode) {
      aliasesByMode = {};
      for (const [sourceModeId, sourceTargetId] of Object.entries(variable.aliasesByMode)) {
        const modeId = modeMap?.get(sourceModeId);
        const targetId = variableIdMap.get(sourceTargetId);
        if (!modeId || !targetId) fail(`Variable "${variable.name}" has an alias outside the imported token set.`, 'INVALID_MERGE_INPUT');
        aliasesByMode[modeId] = targetId;
      }
    }
    return {
      ...structuredClone(variable),
      id: variableIdMap.get(variable.id),
      collectionId: collectionIdMap.get(variable.collectionId),
      valuesByMode,
      ...(aliasesByMode ? { aliasesByMode } : {})
    };
  });

  nextDocument.variableCollections ||= [];
  nextDocument.variables ||= [];
  nextDocument.variableCollections.push(...mergedCollections);
  nextDocument.variables.push(...mergedVariables);
  try {
    validateDocument(nextDocument);
  } catch (error) {
    fail(`Imported tokens conflict with this design: ${error.message}`, 'MERGED_DOCUMENT_INVALID');
  }
  return { document: nextDocument, warnings: Array.isArray(imported.warnings) ? [...imported.warnings] : [] };
}
