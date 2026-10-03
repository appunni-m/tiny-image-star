import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { workspaceEditingAccess } from '../src/workspace/editing-access.js';
import { workspaceOnboardingCopy } from '../src/workspace/onboarding-copy.js';

const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

test('workspace onboarding describes only storage choices available on this browser', () => {
  const folder = workspaceOnboardingCopy({ folderPickerAvailable: true });
  assert.match(folder.description, /Choose a folder/);
  assert.match(folder.description, /local files/);
  assert.doesNotMatch(folder.description, /browser profile/);

  const browser = workspaceOnboardingCopy({ folderPickerAvailable: false });
  assert.match(browser.description, /local profile/);
  assert.match(browser.description, /Export a local design file/);
  assert.match(browser.status, /cannot choose a writable folder/);
  assert.match(browser.status, /stay in this browser profile/);
});

test('folder permission recovery keeps File navigation available and canvas editing blocked', () => {
  assert.deepEqual(workspaceEditingAccess({ blocked: true, permissionNeeded: true }), {
    topbarInert: false,
    workspaceInert: true
  });
  assert.deepEqual(workspaceEditingAccess({ blocked: true, onboarding: true }), {
    topbarInert: true,
    workspaceInert: true
  });
  assert.deepEqual(workspaceEditingAccess({ blocked: true }), {
    topbarInert: true,
    workspaceInert: true
  });
  assert.deepEqual(workspaceEditingAccess(), { topbarInert: false, workspaceInert: false });

  const start = mainSource.indexOf('function setDocumentEditingBlocked(blocked)');
  const end = mainSource.indexOf('\nfunction queueSave', start);
  assert.ok(start >= 0 && end > start);
  const implementation = mainSource.slice(start, end);
  assert.match(implementation, /workspaceEditingAccess\(\{[\s\S]*?permissionNeeded:\s*state\.workspacePermissionNeeded[\s\S]*?\}\)/);
  assert.match(implementation, /\$\(['"]\.topbar['"]\)\.inert\s*=\s*access\.topbarInert/);
  assert.match(implementation, /\$\(['"]\.workspace['"]\)\.inert\s*=\s*access\.workspaceInert/);
});

test('workspace activation surfaces a saved recipe recovery before it can start a stable-link join', () => {
  const start = mainSource.indexOf('async function activateWorkspace(handle');
  const end = mainSource.indexOf('\nasync function chooseWorkspaceFolder', start);
  assert.ok(start >= 0 && end > start);
  const activation = mainSource.slice(start, end);
  assert.match(activation, /state\.pendingRecipeRecovery\s*=\s*await recipeRecoveryForDocument[\s\S]*?renderRecipeRecoveryPrompt\(\)/);
  assert.match(activation, /!state\.pendingRecipeRecovery\s*&&\s*location\.hash\.startsWith\('#tisd1\.'\)/);
});

test('a deferred stable-link invitation opens after recipe recovery is resolved', () => {
  const keepStart = mainSource.indexOf('async function keepInterruptedRecipeChanges()');
  const keepEnd = mainSource.indexOf('\nfunction resumeInterruptedRecipe', keepStart);
  const keep = mainSource.slice(keepStart, keepEnd);
  const resumeStart = keepEnd + 1;
  const resumeEnd = mainSource.indexOf('\nfunction renderBulkBar', resumeStart);
  const resume = mainSource.slice(resumeStart, resumeEnd);
  assert.match(keep, /state\.pendingRecipeRecovery\s*=\s*null;[\s\S]*?startJoinFromStableLink\(\)/);
  assert.match(resume, /state\.pendingRecipeRecovery\s*=\s*null;[\s\S]*?startJoinFromStableLink\(\)/);
  const joinStart = mainSource.indexOf('function startJoinFromStableLink()');
  const joinEnd = mainSource.indexOf('\nfunction toggleLayoutGuides', joinStart);
  assert.ok(joinStart >= 0 && joinEnd > joinStart);
  assert.match(mainSource.slice(joinStart, joinEnd), /if \(state\.workspaceOnboardingRequired \|\| state\.workspacePermissionNeeded \|\| state\.pendingRecipeRecovery\) return false/);
});

test('browser-storage onboarding stays gated until the initial document save succeeds', () => {
  const start = mainSource.indexOf('async function continueWithBrowserStorage()');
  const end = mainSource.indexOf('\nasync function reconnectWorkspaceFolder', start);
  assert.ok(start >= 0 && end > start);
  const fallback = mainSource.slice(start, end);
  assert.match(fallback, /state\.workspaceOnboardingRequired = false;[\s\S]*?setDocumentEditingBlocked\(true\)[\s\S]*?ensureImageLibraryCompatibility\(state\.document\)[\s\S]*?persistCurrentDocumentNow\(\)[\s\S]*?if \(!saved\) throw[\s\S]*?workspace-onboarding-dialog'\)\.close/);
  assert.match(fallback, /catch \(error\) \{[\s\S]*?state\.workspaceOnboardingRequired = true;[\s\S]*?setDocumentEditingBlocked\(true\)/,
    'a failed browser-storage save must return to the blocked onboarding state');
});
