import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNumericFieldExpression } from '../src/numeric-field-expression.js';

test('numeric fields accept absolute values and bounded arithmetic', () => {
  assert.equal(parseNumericFieldExpression('128.5', 10), 128.5);
  assert.equal(parseNumericFieldExpression('100 + 20 * 2', 10), 140);
  assert.equal(parseNumericFieldExpression('(100 + 20) / 4', 10), 30);
  assert.equal(parseNumericFieldExpression('= -20', 10), -20);
});

test('leading operators apply relative to the value captured when the field gained focus', () => {
  assert.equal(parseNumericFieldExpression('+100', 320), 420);
  assert.equal(parseNumericFieldExpression('-20', 320), 300);
  assert.equal(parseNumericFieldExpression('*4', 320), 1280);
  assert.equal(parseNumericFieldExpression('/8', 320), 40);
  assert.equal(parseNumericFieldExpression('50%', 320), 160);
  assert.equal(parseNumericFieldExpression('*0', 320), 0);
});

test('expressions reject malformed, unsafe, unbounded, or non-finite input', () => {
  for (const input of ['', ' ', '+', '/0', '12/0', '12a', '1 +', 'Infinity', 'NaN', '2 ** 8', 'alert(1)', '2'.repeat(129)]) {
    assert.equal(parseNumericFieldExpression(input, 20), null, `reject ${JSON.stringify(input)}`);
  }
  assert.equal(parseNumericFieldExpression('1e309', 20), null);
  assert.equal(parseNumericFieldExpression('1e308 * 1e308', 20), null);
  assert.equal(parseNumericFieldExpression('2'.repeat(50).split('').join('+'), 20), null, 'token count is bounded');
  assert.equal(parseNumericFieldExpression('('.repeat(25) + '1' + ')'.repeat(25), 20), null, 'nesting depth is bounded');
  assert.equal(parseNumericFieldExpression('20', Infinity), null);
});
