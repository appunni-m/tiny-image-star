/**
 * A small, deliberately non-JavaScript expression language for prototype
 * values. Expressions are parsed and evaluated locally; this module never
 * uses eval, Function, or property access on expression identifiers.
 *
 * Variable values may be JavaScript primitives or explicit typed records:
 * `{ type: 'number' | 'string' | 'boolean', value: ... }`.
 */

export const PROTOTYPE_EXPRESSION_LIMITS = Object.freeze({
  sourceLength: 4096,
  tokens: 512,
  nesting: 32,
  operations: 128,
  stringLength: 65_536
});

const PRECEDENCE = Object.freeze({
  or: 1,
  and: 2,
  '==': 3,
  '!=': 3,
  '>': 3,
  '<': 3,
  '>=': 3,
  '<=': 3,
  '+': 4,
  '-': 4,
  '*': 5,
  '/': 5
});

const VALUE_TYPES = new Set(['number', 'string', 'boolean']);
const OPTION_KEYS = new Set(['variables', 'mode']);
const RESERVED_IDENTIFIERS = new Set(['and', 'false', 'not', 'or', 'true']);

/** Turn a display variable name into a safe expression identifier. */
export function prototypeExpressionIdentifier(name) {
  if (typeof name !== 'string') return null;
  let identifier = name.normalize('NFKC').replace(/[^\p{L}\p{N}_$]+/gu, '_').replace(/^_+|_+$/gu, '');
  if (!identifier) return null;
  if (!/^[\p{L}_$]/u.test(identifier)) identifier = `_${identifier}`;
  if (RESERVED_IDENTIFIERS.has(identifier)) identifier = `variable_${identifier}`;
  return identifier;
}

/** Return exact variable identifiers in an expression, ignoring quoted text. */
export function prototypeExpressionReferences(source) {
  return lex(source).filter(token => token.kind === 'identifier').map(token => token.value);
}

/** An expression error with a stable machine-readable `code`. */
export class PrototypeExpressionError extends Error {
  constructor(code, message, position = null) {
    super(message);
    this.name = 'PrototypeExpressionError';
    this.code = code;
    if (position !== null) this.position = position;
  }
}

function fail(code, message, position = null) {
  throw new PrototypeExpressionError(code, message, position);
}

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownDataValue(object, key, code, label) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
    fail(code, `${label} must be an own data property.`);
  }
  return descriptor.value;
}

function readOptions(options) {
  if (options === undefined) return { variables: Object.create(null), mode: null };
  if (!isPlainRecord(options)) fail('INVALID_OPTIONS', 'Options must be a plain object.');
  for (const key of Reflect.ownKeys(options)) {
    if (typeof key !== 'string' || !OPTION_KEYS.has(key)) {
      fail('INVALID_OPTIONS', 'Options may contain only variables and mode.');
    }
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      fail('INVALID_OPTIONS', 'Options must use own data properties.');
    }
  }
  let variables = Object.hasOwn(options, 'variables')
    ? ownDataValue(options, 'variables', 'INVALID_OPTIONS', 'variables')
    : Object.create(null);
  let mode = Object.hasOwn(options, 'mode')
    ? ownDataValue(options, 'mode', 'INVALID_OPTIONS', 'mode')
    : null;
  if (variables === undefined) variables = Object.create(null);
  if (mode === undefined) mode = null;
  if (mode !== null && !VALUE_TYPES.has(mode)) {
    fail('INVALID_OPTIONS', 'mode must be number, string, or boolean.');
  }
  if (!isPlainRecord(variables)) {
    fail('INVALID_VARIABLES', 'variables must be a plain name-to-value object.');
  }
  return { variables, mode };
}

function isIdentifierStart(character) {
  return /[\p{L}_$]/u.test(character);
}

function isIdentifierPart(character) {
  return /[\p{L}\p{N}_$\p{M}]/u.test(character);
}

function lex(source) {
  const tokens = [];
  let index = 0;

  const push = token => {
    if (tokens.length >= PROTOTYPE_EXPRESSION_LIMITS.tokens) {
      fail('TOKEN_LIMIT', `Expression exceeds ${PROTOTYPE_EXPRESSION_LIMITS.tokens} tokens.`, token.position);
    }
    tokens.push(token);
  };

  while (index < source.length) {
    const character = String.fromCodePoint(source.codePointAt(index));
    if (/\s/u.test(character)) {
      index += character.length;
      continue;
    }

    const position = index;
    if (character === '"') {
      index += 1;
      let closed = false;
      while (index < source.length) {
        const next = source[index];
        if (next === '"') {
          index += 1;
          closed = true;
          break;
        }
        if (next === '\\') {
          index += 2;
          continue;
        }
        if (next === '\n' || next === '\r') {
          fail('INVALID_STRING_LITERAL', 'String literals cannot contain an unescaped line break.', position);
        }
        index += 1;
      }
      if (!closed) fail('INVALID_STRING_LITERAL', 'String literal is not closed.', position);
      let value;
      try {
        value = JSON.parse(source.slice(position, index));
      } catch {
        fail('INVALID_STRING_LITERAL', 'String literal has an invalid escape sequence.', position);
      }
      if (value.length > PROTOTYPE_EXPRESSION_LIMITS.stringLength) {
        fail('STRING_LIMIT', `String literals are limited to ${PROTOTYPE_EXPRESSION_LIMITS.stringLength} characters.`, position);
      }
      push({ kind: 'literal', value, valueType: 'string', position });
      continue;
    }

    if (/[0-9]/u.test(character) || (character === '.' && /[0-9]/u.test(source[index + 1] || ''))) {
      const match = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/u.exec(source.slice(index));
      const raw = match[0];
      const value = Number(raw);
      if (!Number.isFinite(value)) fail('INVALID_NUMBER_LITERAL', 'Number literals must be finite.', position);
      index += raw.length;
      push({ kind: 'literal', value, valueType: 'number', position });
      continue;
    }

    if (isIdentifierStart(character)) {
      index += character.length;
      while (index < source.length) {
        const next = String.fromCodePoint(source.codePointAt(index));
        if (!isIdentifierPart(next)) break;
        index += next.length;
      }
      const name = source.slice(position, index);
      if (name === 'true' || name === 'false') {
        push({ kind: 'literal', value: name === 'true', valueType: 'boolean', position });
      } else if (name === 'and' || name === 'or' || name === 'not') {
        push({ kind: 'operator', value: name, position });
      } else {
        push({ kind: 'identifier', value: name, position });
      }
      continue;
    }

    const pair = source.slice(index, index + 2);
    if (pair === '==' || pair === '!=' || pair === '>=' || pair === '<=') {
      push({ kind: 'operator', value: pair, position });
      index += 2;
      continue;
    }
    if ('+-*/><!()'.includes(character)) {
      push({ kind: character === '(' || character === ')' ? 'punctuation' : 'operator', value: character, position });
      index += character.length;
      continue;
    }
    fail('INVALID_TOKEN', 'Expression contains an unsupported character or operator.', position);
  }

  tokens.push({ kind: 'eof', value: '', position: source.length });
  return tokens;
}

function parse(tokens) {
  let index = 0;
  let operations = 0;

  const current = () => tokens[index];
  const consume = () => tokens[index++];
  const countOperation = position => {
    operations += 1;
    if (operations > PROTOTYPE_EXPRESSION_LIMITS.operations) {
      fail('OPERATION_LIMIT', `Expression exceeds ${PROTOTYPE_EXPRESSION_LIMITS.operations} operations.`, position);
    }
  };
  const checkDepth = (depth, position) => {
    if (depth > PROTOTYPE_EXPRESSION_LIMITS.nesting) {
      fail('NESTING_LIMIT', `Expression nesting exceeds ${PROTOTYPE_EXPRESSION_LIMITS.nesting} levels.`, position);
    }
  };

  function expression(minPrecedence = 0, depth = 0) {
    checkDepth(depth, current().position);
    const token = consume();
    let left;

    if (token.kind === 'literal') {
      left = { kind: 'literal', value: token.value, valueType: token.valueType, position: token.position };
    } else if (token.kind === 'identifier') {
      left = { kind: 'variable', name: token.value, position: token.position };
    } else if (token.value === '(') {
      checkDepth(depth + 1, token.position);
      left = expression(0, depth + 1);
      if (current().value !== ')') fail('EXPECTED_CLOSING_PARENTHESIS', 'Expected a closing parenthesis.', current().position);
      consume();
    } else if (token.kind === 'operator' && (token.value === '-' || token.value === '!' || token.value === 'not')) {
      countOperation(token.position);
      left = {
        kind: 'unary',
        operator: token.value,
        operand: expression(6, depth + 1),
        position: token.position
      };
    } else if (token.kind === 'eof') {
      fail('EXPECTED_EXPRESSION', 'Expected an expression.', token.position);
    } else {
      fail('UNEXPECTED_TOKEN', 'Expected a value or opening parenthesis.', token.position);
    }

    while (current().kind === 'operator') {
      const operator = current();
      const precedence = PRECEDENCE[operator.value];
      if (precedence === undefined || precedence < minPrecedence) break;
      consume();
      countOperation(operator.position);
      const right = expression(precedence + 1, depth);
      left = { kind: 'binary', operator: operator.value, left, right, position: operator.position };
    }
    return left;
  }

  const tree = expression();
  if (current().kind !== 'eof') {
    fail('TRAILING_INPUT', 'Expression contains unexpected trailing input.', current().position);
  }
  return tree;
}

function normalizeVariable(raw, name) {
  let type;
  let value;
  if (typeof raw === 'number' || typeof raw === 'string' || typeof raw === 'boolean') {
    type = typeof raw;
    value = raw;
  } else if (isPlainRecord(raw)) {
    const keys = Reflect.ownKeys(raw);
    if (keys.length !== 2 || !keys.includes('type') || !keys.includes('value')) {
      fail('INVALID_VARIABLE', `Variable ${name} must be a primitive or a typed { type, value } record.`);
    }
    type = ownDataValue(raw, 'type', 'INVALID_VARIABLE', `Variable ${name}.type`);
    value = ownDataValue(raw, 'value', 'INVALID_VARIABLE', `Variable ${name}.value`);
  } else {
    fail('INVALID_VARIABLE', `Variable ${name} must be a number, string, or boolean.`);
  }

  if (!VALUE_TYPES.has(type) || typeof value !== type) {
    fail('INVALID_VARIABLE', `Variable ${name} has a value that does not match its declared type.`);
  }
  if (type === 'number' && !Number.isFinite(value)) {
    fail('INVALID_VARIABLE', `Variable ${name} must be a finite number.`);
  }
  if (type === 'string' && value.length > PROTOTYPE_EXPRESSION_LIMITS.stringLength) {
    fail('STRING_LIMIT', `Variable ${name} exceeds the string limit.`);
  }
  return { type, value };
}

function resolveVariables(tree, variables, resolved = new Map()) {
  if (tree.kind === 'variable') {
    if (!resolved.has(tree.name)) {
      const descriptor = Object.getOwnPropertyDescriptor(variables, tree.name);
      if (!descriptor) {
        fail('UNKNOWN_VARIABLE', `Unknown variable: ${tree.name}.`, tree.position);
      }
      if (!Object.hasOwn(descriptor, 'value')) {
        fail('INVALID_VARIABLE', `Variable ${tree.name} must be an own data property.`, tree.position);
      }
      resolved.set(tree.name, normalizeVariable(descriptor.value, tree.name));
    }
    tree.resolved = resolved.get(tree.name);
    return;
  }
  if (tree.kind === 'unary') resolveVariables(tree.operand, variables, resolved);
  if (tree.kind === 'binary') {
    resolveVariables(tree.left, variables, resolved);
    resolveVariables(tree.right, variables, resolved);
  }
}

function inferType(tree) {
  if (tree.kind === 'literal') return tree.valueType;
  if (tree.kind === 'variable') return tree.resolved.type;
  if (tree.kind === 'unary') {
    const operandType = inferType(tree.operand);
    if (tree.operator === '-') {
      if (operandType !== 'number') fail('TYPE_ERROR', 'Unary minus requires a number.', tree.position);
      return 'number';
    }
    if (operandType !== 'boolean') fail('TYPE_ERROR', 'Boolean negation requires a boolean.', tree.position);
    return 'boolean';
  }

  const leftType = inferType(tree.left);
  const rightType = inferType(tree.right);
  const { operator } = tree;
  if (operator === '+' && leftType !== 'boolean' && rightType !== 'boolean') {
    return leftType === 'number' && rightType === 'number' ? 'number' : 'string';
  }
  if (operator === '+' || operator === '-' || operator === '*' || operator === '/') {
    if (leftType !== 'number' || rightType !== 'number') {
      fail('TYPE_ERROR', `Operator ${operator} requires two numbers, except + which also concatenates strings and numbers.`, tree.position);
    }
    return 'number';
  }
  if (operator === 'and' || operator === 'or') {
    if (leftType !== 'boolean' || rightType !== 'boolean') {
      fail('TYPE_ERROR', `Operator ${operator} requires two booleans.`, tree.position);
    }
    return 'boolean';
  }
  if (operator === '>' || operator === '<' || operator === '>=' || operator === '<=') {
    if (leftType !== 'number' || rightType !== 'number') {
      fail('TYPE_ERROR', `Operator ${operator} requires two numbers.`, tree.position);
    }
    return 'boolean';
  }
  if (operator === '==' || operator === '!=') return 'boolean';
  fail('UNSUPPORTED_OPERATOR', 'Expression contains an unsupported operator.', tree.position);
}

function evaluate(tree) {
  if (tree.kind === 'literal') return { type: tree.valueType, value: tree.value };
  if (tree.kind === 'variable') return tree.resolved;
  if (tree.kind === 'unary') {
    const operand = evaluate(tree.operand);
    if (tree.operator === '-') return finiteResult(-operand.value, tree.position);
    return { type: 'boolean', value: !operand.value };
  }

  const left = evaluate(tree.left);
  if (tree.operator === 'and' && left.value === false) return { type: 'boolean', value: false };
  if (tree.operator === 'or' && left.value === true) return { type: 'boolean', value: true };
  const right = evaluate(tree.right);

  switch (tree.operator) {
    case '+':
      if (left.type === 'number' && right.type === 'number') return finiteResult(left.value + right.value, tree.position);
      return stringResult(`${left.value}${right.value}`, tree.position);
    case '-': return finiteResult(left.value - right.value, tree.position);
    case '*': return finiteResult(left.value * right.value, tree.position);
    case '/':
      if (right.value === 0) fail('DIVISION_BY_ZERO', 'Cannot divide by zero.', tree.position);
      return finiteResult(left.value / right.value, tree.position);
    case '==': return { type: 'boolean', value: left.type === right.type && left.value === right.value };
    case '!=': return { type: 'boolean', value: left.type !== right.type || left.value !== right.value };
    case '>': return { type: 'boolean', value: left.value > right.value };
    case '<': return { type: 'boolean', value: left.value < right.value };
    case '>=': return { type: 'boolean', value: left.value >= right.value };
    case '<=': return { type: 'boolean', value: left.value <= right.value };
    case 'and': return { type: 'boolean', value: left.value && right.value };
    case 'or': return { type: 'boolean', value: left.value || right.value };
    default: fail('UNSUPPORTED_OPERATOR', 'Expression contains an unsupported operator.', tree.position);
  }
}

function finiteResult(value, position) {
  if (!Number.isFinite(value)) fail('NON_FINITE_RESULT', 'Arithmetic must produce a finite number.', position);
  return { type: 'number', value };
}

function stringResult(value, position) {
  if (value.length > PROTOTYPE_EXPRESSION_LIMITS.stringLength) {
    fail('STRING_LIMIT', `String results are limited to ${PROTOTYPE_EXPRESSION_LIMITS.stringLength} characters.`, position);
  }
  return { type: 'string', value };
}

/**
 * Evaluate a supported prototype expression.
 *
 * @param {string} source Expression source.
 * @param {{ variables?: Record<string, number|string|boolean|{type:'number'|'string'|'boolean',value:number|string|boolean}>, mode?: 'number'|'string'|'boolean' }} [options]
 * @returns {number|string|boolean} The typed expression result.
 * @throws {PrototypeExpressionError} On invalid syntax, types, variables, or limits.
 */
export function evaluatePrototypeExpression(source, options = undefined) {
  if (typeof source !== 'string') fail('INVALID_SOURCE', 'Expression source must be a string.');
  if (source.length > PROTOTYPE_EXPRESSION_LIMITS.sourceLength) {
    fail('SOURCE_LIMIT', `Expression source is limited to ${PROTOTYPE_EXPRESSION_LIMITS.sourceLength} characters.`);
  }
  const { variables, mode } = readOptions(options);
  const tree = parse(lex(source));
  resolveVariables(tree, variables);
  const resultType = inferType(tree);
  if (mode !== null && resultType !== mode) {
    fail('RESULT_TYPE_MISMATCH', `Expression returns ${resultType}; expected ${mode}.`, tree.position);
  }
  return evaluate(tree).value;
}
