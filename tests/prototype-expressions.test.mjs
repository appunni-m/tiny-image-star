import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluatePrototypeExpression,
  PROTOTYPE_EXPRESSION_LIMITS,
  PrototypeExpressionError,
  prototypeExpressionIdentifier
} from '../src/prototype-expressions.js';

function assertExpressionError(code, callback) {
  assert.throws(callback, error => {
    assert.ok(error instanceof PrototypeExpressionError);
    assert.equal(error.code, code);
    assert.equal(typeof error.message, 'string');
    return true;
  });
}

test('display variable names map to safe, readable expression aliases', () => {
  assert.equal(prototypeExpressionIdentifier('Card width'), 'Card_width');
  assert.equal(prototypeExpressionIdentifier('  2× scale  '), '_2_scale');
  assert.equal(prototypeExpressionIdentifier('true'), 'variable_true');
  assert.equal(prototypeExpressionIdentifier('✨'), null);
});

test('numeric expressions follow arithmetic precedence, grouping, and left-to-right order', () => {
  assert.equal(evaluatePrototypeExpression('1 + 2 * 3'), 7);
  assert.equal(evaluatePrototypeExpression('(1 + 2) * 3'), 9);
  assert.equal(evaluatePrototypeExpression('8 / 4 / 2'), 1);
  assert.equal(evaluatePrototypeExpression('8 - 3 - 2'), 3);
  assert.equal(evaluatePrototypeExpression('-.5 + 1e1'), 9.5);
  assert.equal(evaluatePrototypeExpression('-(2 + 3) * 4'), -20);
});

test('string expressions concatenate quoted literals and string or number variables', () => {
  const variables = {
    name: { type: 'string', value: 'Ada' },
    count: { type: 'number', value: 3 },
    suffix: '!'
  };
  assert.equal(evaluatePrototypeExpression('"Hello, " + name + " " + count + suffix', { variables, mode: 'string' }), 'Hello, Ada 3!');
  assert.equal(evaluatePrototypeExpression('count + " items"', { variables }), '3 items');
  assert.equal(evaluatePrototypeExpression('"quote: \\""'), 'quote: "');
});

test('boolean expressions support comparisons, equality, logical precedence, and negation', () => {
  const variables = {
    total: { type: 'number', value: 7 },
    threshold: { type: 'number', value: 5 },
    enabled: { type: 'boolean', value: true },
    label: { type: 'string', value: 'done' }
  };
  assert.equal(evaluatePrototypeExpression('total + 2 * threshold >= 17 and enabled or false', { variables, mode: 'boolean' }), true);
  assert.equal(evaluatePrototypeExpression('not enabled or total < threshold', { variables }), false);
  assert.equal(evaluatePrototypeExpression('!enabled == false', { variables }), true);
  assert.equal(evaluatePrototypeExpression('label == "done" and total != 0', { variables }), true);
  assert.equal(evaluatePrototypeExpression('true or false and false'), true, 'and binds more tightly than or');
  assert.equal(evaluatePrototypeExpression('(true or false) and false'), false, 'parentheses override logical precedence');
  assert.equal(evaluatePrototypeExpression('1 == "1"'), false, 'equality is strict and never coerces types');
  assert.equal(evaluatePrototypeExpression('1 != true'), true);
  assert.equal(evaluatePrototypeExpression('3 < 4 and 4 <= 4 and 5 > 4 and 5 >= 5'), true);
});

test('identifiers are looked up as exact own names and typed values remain isolated', () => {
  const variables = Object.create(null);
  variables.__proto__ = { type: 'number', value: 12 };
  variables['café'] = { type: 'string', value: 'tea' };
  assert.equal(evaluatePrototypeExpression('__proto__ + 1', { variables }), 13);
  assert.equal(evaluatePrototypeExpression('café + " time"', { variables }), 'tea time');
  assertExpressionError('UNKNOWN_VARIABLE', () => evaluatePrototypeExpression('toString'));
  assertExpressionError('UNKNOWN_VARIABLE', () => evaluatePrototypeExpression('false and missing'));
});

test('logical operators short-circuit values while every branch is still parsed and type checked', () => {
  assert.equal(evaluatePrototypeExpression('false and (1 / 0 > 2)'), false);
  assert.equal(evaluatePrototypeExpression('true or (1 / 0 > 2)'), true);
  assertExpressionError('TYPE_ERROR', () => evaluatePrototypeExpression('false and (1 + true)'));
  assertExpressionError('TRAILING_INPUT', () => evaluatePrototypeExpression('true or false true'));
});

test('type checks reject unsupported operators and mode mismatches', () => {
  assertExpressionError('TYPE_ERROR', () => evaluatePrototypeExpression('true + 1'));
  assertExpressionError('TYPE_ERROR', () => evaluatePrototypeExpression('"a" - "b"'));
  assertExpressionError('TYPE_ERROR', () => evaluatePrototypeExpression('1 and true'));
  assertExpressionError('TYPE_ERROR', () => evaluatePrototypeExpression('!1'));
  assertExpressionError('TYPE_ERROR', () => evaluatePrototypeExpression('"a" < "b"'));
  assertExpressionError('RESULT_TYPE_MISMATCH', () => evaluatePrototypeExpression('1 + 2', { mode: 'boolean' }));
  assertExpressionError('INVALID_OPTIONS', () => evaluatePrototypeExpression('true', { mode: 'truthy' }));
});

test('malformed and executable-looking input is rejected as data, never evaluated', () => {
  assertExpressionError('INVALID_TOKEN', () => evaluatePrototypeExpression('window.alert(1)'));
  assertExpressionError('INVALID_TOKEN', () => evaluatePrototypeExpression('1 && 2'));
  assertExpressionError('INVALID_TOKEN', () => evaluatePrototypeExpression('1 = 2'));
  assertExpressionError('UNEXPECTED_TOKEN', () => evaluatePrototypeExpression('()'));
  assertExpressionError('EXPECTED_CLOSING_PARENTHESIS', () => evaluatePrototypeExpression('(1 + 2'));
  assertExpressionError('TRAILING_INPUT', () => evaluatePrototypeExpression('1 2'));
  assertExpressionError('INVALID_STRING_LITERAL', () => evaluatePrototypeExpression('"unfinished'));
  assertExpressionError('INVALID_STRING_LITERAL', () => evaluatePrototypeExpression('"bad \\x escape"'));
});

test('invalid, inherited, and accessor-backed variables are rejected without invoking accessors', () => {
  assertExpressionError('INVALID_VARIABLES', () => evaluatePrototypeExpression('x', { variables: Object.create({ x: 1 }) }));
  assertExpressionError('INVALID_VARIABLE', () => evaluatePrototypeExpression('x', { variables: { x: { type: 'number', value: '1' } } }));
  assertExpressionError('INVALID_VARIABLE', () => evaluatePrototypeExpression('x', { variables: { x: { type: 'number', value: Infinity } } }));

  let getterCalls = 0;
  const variables = {};
  Object.defineProperty(variables, 'x', { enumerable: true, get() { getterCalls += 1; return 1; } });
  assertExpressionError('INVALID_VARIABLE', () => evaluatePrototypeExpression('x', { variables }));
  assert.equal(getterCalls, 0);

  let optionGetterCalls = 0;
  const options = {};
  Object.defineProperty(options, 'mode', { enumerable: true, get() { optionGetterCalls += 1; return 'number'; } });
  assertExpressionError('INVALID_OPTIONS', () => evaluatePrototypeExpression('1', options));
  assert.equal(optionGetterCalls, 0);
});

test('division by zero, overflow, and oversized string values fail with stable codes', () => {
  assertExpressionError('DIVISION_BY_ZERO', () => evaluatePrototypeExpression('2 / 0'));
  assertExpressionError('NON_FINITE_RESULT', () => evaluatePrototypeExpression('1e308 * 1e308'));
  assertExpressionError('STRING_LIMIT', () => evaluatePrototypeExpression('"a" + text', {
    variables: { text: 'x'.repeat(PROTOTYPE_EXPRESSION_LIMITS.stringLength) }
  }));
});

test('source, token, nesting, and operation bounds reject hostile inputs', () => {
  assertExpressionError('SOURCE_LIMIT', () => evaluatePrototypeExpression(' '.repeat(PROTOTYPE_EXPRESSION_LIMITS.sourceLength + 1)));
  assertExpressionError('TOKEN_LIMIT', () => evaluatePrototypeExpression('1 '.repeat(PROTOTYPE_EXPRESSION_LIMITS.tokens + 1)));
  assertExpressionError('NESTING_LIMIT', () => evaluatePrototypeExpression('('.repeat(PROTOTYPE_EXPRESSION_LIMITS.nesting + 1) + '1' + ')'.repeat(PROTOTYPE_EXPRESSION_LIMITS.nesting + 1)));
  assertExpressionError('OPERATION_LIMIT', () => evaluatePrototypeExpression(Array(PROTOTYPE_EXPRESSION_LIMITS.operations + 2).fill('1').join(' + ')));
});

test('invalid numeric literals and non-string source values are not coerced', () => {
  assertExpressionError('INVALID_NUMBER_LITERAL', () => evaluatePrototypeExpression('1e999'));
  assertExpressionError('INVALID_SOURCE', () => evaluatePrototypeExpression(1));
  assert.equal(evaluatePrototypeExpression('1', { mode: undefined, variables: undefined }), 1);
});
