const MAX_EXPRESSION_LENGTH = 128;
const MAX_TOKENS = 64;
const MAX_DEPTH = 24;

function parseAbsoluteExpression(source) {
  if (!source || source.length > MAX_EXPRESSION_LENGTH) return null;
  let offset = 0;
  let tokens = 0;
  let invalid = false;
  const skipWhitespace = () => { while (/\s/u.test(source[offset] || '\0')) offset += 1; };
  const take = () => {
    skipWhitespace();
    if (offset >= source.length) return null;
    if (++tokens > MAX_TOKENS) { invalid = true; return null; }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/iu.exec(source.slice(offset));
    if (number) {
      offset += number[0].length;
      const value = Number(number[0]);
      return Number.isFinite(value) ? { type: 'number', value } : null;
    }
    const character = source[offset++];
    if ('+-*/()'.includes(character)) return { type: character };
    invalid = true;
    return null;
  };
  let lookahead = take();
  const consume = type => {
    if (lookahead?.type !== type) return false;
    lookahead = take();
    return true;
  };
  const primary = depth => {
    if (depth > MAX_DEPTH) return null;
    if (lookahead?.type === 'number') {
      const value = lookahead.value;
      lookahead = take();
      return value;
    }
    if (consume('(')) {
      const value = expression(depth + 1);
      if (value == null || !consume(')')) return null;
      return value;
    }
    return null;
  };
  const unary = depth => {
    if (depth > MAX_DEPTH) return null;
    if (consume('+')) return unary(depth + 1);
    if (consume('-')) {
      const value = unary(depth + 1);
      return value == null ? null : -value;
    }
    return primary(depth + 1);
  };
  const term = depth => {
    let value = unary(depth + 1);
    if (value == null) return null;
    while (lookahead?.type === '*' || lookahead?.type === '/') {
      const operator = lookahead.type;
      lookahead = take();
      const next = unary(depth + 1);
      if (next == null || (operator === '/' && next === 0)) return null;
      value = operator === '*' ? value * next : value / next;
      if (!Number.isFinite(value)) return null;
    }
    return value;
  };
  const expression = depth => {
    if (depth > MAX_DEPTH) return null;
    let value = term(depth + 1);
    if (value == null) return null;
    while (lookahead?.type === '+' || lookahead?.type === '-') {
      const operator = lookahead.type;
      lookahead = take();
      const next = term(depth + 1);
      if (next == null) return null;
      value = operator === '+' ? value + next : value - next;
      if (!Number.isFinite(value)) return null;
    }
    return value;
  };

  const result = expression(0);
  skipWhitespace();
  return !invalid && offset === source.length && lookahead == null && Number.isFinite(result) ? result : null;
}

/** Evaluate a bounded Figma-style numeric field value without executing code. */
export function parseNumericFieldExpression(input, baseValue) {
  if (typeof input !== 'string' || input.length > MAX_EXPRESSION_LENGTH || !Number.isFinite(baseValue)) return null;
  const source = input.trim();
  if (!source) return null;
  if (source.startsWith('=')) return parseAbsoluteExpression(source.slice(1).trim());
  if (source.endsWith('%')) {
    const percentage = parseAbsoluteExpression(source.slice(0, -1).trim());
    const result = percentage == null ? null : baseValue * percentage / 100;
    return Number.isFinite(result) ? result : null;
  }
  const relativeOperator = source[0];
  if ('+-*/'.includes(relativeOperator) && source.length > 1) {
    const operand = parseAbsoluteExpression(source.slice(1).trim());
    if (operand == null || (relativeOperator === '/' && operand === 0)) return null;
    const result = relativeOperator === '+' ? baseValue + operand
      : relativeOperator === '-' ? baseValue - operand
        : relativeOperator === '*' ? baseValue * operand : baseValue / operand;
    return Number.isFinite(result) ? result : null;
  }
  return parseAbsoluteExpression(source);
}
