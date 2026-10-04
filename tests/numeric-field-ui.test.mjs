import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

function functionBody(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`\nfunction ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `${name} should have a bounded implementation`);
  return source.slice(start, end);
}

test('single and multi-selection geometry fields accept mobile-friendly numeric expressions', () => {
  const single = functionBody('numberField', 'selectionNumberField');
  assert.match(single, /\['x', 'y', 'width', 'height'\]\.includes\(prop\)/);
  assert.match(single, /type="\$\{expression \? 'text' : 'number'\}"/);
  assert.match(single, /inputmode="text" data-numeric-expression/);
  assert.match(single, /data-expression-base=/);
  assert.match(single, /\+100, \*2, or 50%/);

  const multiple = functionBody('selectionNumberField', 'optionalNumberField');
  assert.match(multiple, /\['x', 'y', 'width', 'height'\]\.includes\(property\)/);
  assert.match(multiple, /inputmode="text" data-numeric-expression/);
});

test('editing captures a stable base, validates bounds, previews live, and commits a numeric value', () => {
  const value = functionBody('numericFieldExpressionValue', 'numericFieldExpressionBase');
  assert.match(value, /parseNumericFieldExpression\(input\.value, base\)/);
  assert.match(value, /input\.getAttribute\('min'\)/);
  assert.match(value, /input\.getAttribute\('max'\)/);
  assert.match(value, /\['width', 'height'\]\.includes\(property\) && value < 0/);

  const update = functionBody('updateInspectorInput', 'finishInspectorInput');
  assert.match(update, /numericFieldExpressionValue\(input\)/);
  assert.match(update, /input\.dataset\.expressionValue = String\(expressionValue\)/);

  const commit = functionBody('commitNumericFieldExpression', 'updateInspectorInput');
  assert.match(commit, /updateInspectorInput\(\{ target: input, type: 'change' \}\)/);
  assert.match(commit, /numericFieldExpressionBase\(input\)/);
  assert.match(commit, /finishInspectorInput\(\)/);
  assert.match(source, /const numericExpression = event\.target\.closest\('\[data-numeric-expression\]'\);\s*if \(numericExpression\) \{\s*const base = numericFieldExpressionBase/,
    'focus captures the current value so relative edits remain stable while previews update');
  assert.match(source, /const numericExpression = event\.target\.closest\('\[data-numeric-expression\]'\);\s*if \(numericExpression\) \{ commitNumericFieldExpression\(numericExpression\); return; \}/,
    'blur normalizes the expression before the ordinary save checkpoint finishes');
  assert.match(source, /import \{ parseNumericFieldExpression \} from '\.\/numeric-field-expression\.js'/);
});
