import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const stylesheet = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

function enclosingRuleBlock(startIndex) {
  const open = stylesheet.indexOf('{', startIndex);
  assert.notEqual(open, -1, 'expected an opening CSS block');
  let depth = 0;
  for (let index = open; index < stylesheet.length; index += 1) {
    if (stylesheet[index] === '{') depth += 1;
    if (stylesheet[index] === '}') {
      depth -= 1;
      if (depth === 0) return { content: stylesheet.slice(open + 1, index), open, close: index };
    }
  }
  assert.fail('expected the CSS block to close');
}

test('local component publish and place actions have phone-sized touch targets and a scrollable list', () => {
  const ruleIndex = stylesheet.indexOf('.local-library-publish, .local-library-component { min-height: 44px;');
  assert.notEqual(ruleIndex, -1, 'component actions should keep a 44px minimum height on phones');
  const mobileStart = stylesheet.lastIndexOf('@media (max-width: 820px)', ruleIndex);
  assert.notEqual(mobileStart, -1, 'phone target sizes should be inside the mobile layout rules');
  const mobileBlock = enclosingRuleBlock(mobileStart);
  assert.ok(ruleIndex > mobileBlock.open && ruleIndex < mobileBlock.close, 'touch target override belongs to the mobile media block');
  assert.match(mobileBlock.content, /\.component-library-list\s*\{[^}]*max-height:\s*min\(35dvh, 280px\)/);
  assert.match(stylesheet.match(/\.component-library-list\s*\{([^}]*)\}/)?.[1] || '', /overflow:\s*auto/);
});
