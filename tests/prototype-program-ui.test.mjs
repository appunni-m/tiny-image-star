import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [main, css] = await Promise.all([
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8')
]);

test('prototype inspector renders the ordered program and nested branch controls', () => {
  for (const control of [
    'prototype-program-add-action', 'prototype-program-add-if',
    'prototype-program-focus-branch', 'prototype-program-move',
    'prototype-program-remove', 'edit-prototype-program-action'
  ]) assert.match(main, new RegExp(`data-action="${control}"`));
  assert.match(main, /Actions run from top to bottom/);
  assert.match(main, /If true/);
  assert.match(main, /Adding to \$\{escapeHtml\(branchLabel\)\}/);
  assert.match(css, /\.prototype-program-if/);
  assert.match(css, /\.prototype-program-branch/);
});

test('program edits preserve stable IDs and synchronize the legacy first-action projection before validation', () => {
  assert.ok(main.includes('steps[index] = { ...replacement, actionId };'));
  assert.match(main, /branchId: createId\('branch'\)/);
  assert.match(main, /candidateInteraction\.actionProgram = program;/);
  assert.match(main, /setPrototypeActionProjection\(candidateInteraction, prototypeProgramFirstAction\(program\), node\.id\);\s*validateDocument\(candidate\);/);
  assert.match(main, /setPrototypeActionProjection\(updatedInteraction, prototypeProgramFirstAction\(program\), node\.id\);/);
});

test('legacy interactions stay legacy unless the virtual action is explicitly edited or a program step is added', () => {
  assert.match(main, /state\.prototypeProgramEditingActionId = interaction\.actionProgram \? firstAction\?\.actionId \|\| null : null;/);
  assert.match(main, /loadPrototypeActionIntoComposer\(interaction, state\.prototypeProgramEditingActionId \? firstAction : interaction\);/);
  assert.match(main, /const program = structuredClone\(prototypeActionProgram\(sourceInteraction\)\);/);
  assert.match(main, /if \(programActionEdit\) \{/);
});
