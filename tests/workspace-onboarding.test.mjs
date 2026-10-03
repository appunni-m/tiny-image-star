import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { workspaceEditingAccess } from '../src/workspace/editing-access.js';
import { workspaceOnboardingCopy } from '../src/workspace/onboarding-copy.js';

const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const htmlSource = await readFile(new URL('../index.html', import.meta.url), 'utf8');

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
  assert.match(folder.status, /continue with browser storage instead/);
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

test('recipe recovery can take over an active lease in place without consulting another tab', () => {
  const resumeStart = mainSource.indexOf('function resumeInterruptedRecipe()');
  const resumeEnd = mainSource.indexOf('\nfunction renderBulkBar', resumeStart);
  assert.ok(resumeStart >= 0 && resumeEnd > resumeStart);
  const resume = mainSource.slice(resumeStart, resumeEnd);
  const claim = resume.indexOf('await bulk.leaseClaimPromise');
  const clearRecovery = resume.indexOf('state.pendingRecipeRecovery = null');
  const unblock = resume.indexOf('setDocumentEditingBlocked(false)');
  assert.ok(claim >= 0 && clearRecovery > claim && unblock > claim,
    'the recovery gate must remain active until the batch ownership claim succeeds');
  assert.match(resume, /clearRecipeRecoveryExpiryTimer\(\)/,
    'the expiry refresh must not race the in-progress recovery claim');
  assert.match(resume, /refreshSavedRecipeRecoveryDesign\(recovery\)/,
    'recovery reloads the latest saved design checkpoint before resuming');
  assert.match(resume, /expectedRecoveryOwnerToken:\s*recovery\.ownerToken/);

  const recoveryDialog = htmlSource.slice(htmlSource.indexOf('id="recipe-recovery-dialog"'), htmlSource.indexOf('</dialog>', htmlSource.indexOf('id="recipe-recovery-dialog"')));
  assert.match(recoveryDialog, /id="recipe-recovery-resume"[^>]*>Resume recipe/,
    'recovery resumes the existing design in place');
  assert.doesNotMatch(recoveryDialog, /fork|other tab|No reply yet/i,
    'the recovery prompt must not send users into a copy or a cross-tab wait');
  const promptStart = mainSource.indexOf('function renderRecipeRecoveryPrompt(');
  const promptEnd = mainSource.indexOf('\nasync function keepInterruptedRecipeChanges', promptStart);
  assert.ok(promptStart >= 0 && promptEnd > promptStart);
  const prompt = mainSource.slice(promptStart, promptEnd);
  assert.match(prompt, /resumeButton\.textContent = leaseActive \? 'Take over and resume here'/,
    'an active lease changes the action label but keeps recovery available in place');
  assert.match(mainSource, /if \(recoveryOnFailure\) claimOptions\.replaceOwnerToken = expectedRecoveryOwnerToken/,
    'the selected recovery action atomically takes over and fences the old owner');
  assert.match(mainSource, /type: 'RECOVERY_TAKEN_OVER',[\s\S]*?previousOwnerToken/,
    'a still-open previous tab is told to stop only after takeover succeeds');
  assert.doesNotMatch(mainSource, /No reply yet|STOP_AND_RECOVER|recipe-recovery-stop-other/,
    'recovery never asks a possibly closed tab to respond');
});

test('takeover drains an old owner save and reloads the checkpoint before continuing', () => {
  const coordinationStart = mainSource.indexOf('function initializeRecipeBatchCoordination()');
  const coordinationEnd = mainSource.indexOf('\nfunction clearRecipeRecoveryExpiryTimer', coordinationStart);
  assert.ok(coordinationStart >= 0 && coordinationEnd > coordinationStart);
  const coordination = mainSource.slice(coordinationStart, coordinationEnd);
  assert.match(coordination, /loseRecipeBatchLease\(bulk,[\s\S]*?void state\.saveChain\.finally\([\s\S]*?RECOVERY_TAKEOVER_DRAINED/,
    'the fenced owner acknowledges only after its already-started save chain settles');
  assert.match(mainSource, /async function notifyAndDrainPreviousRecipeOwner\([\s\S]*?timeoutMs = 1200[\s\S]*?RECOVERY_TAKEOVER_DRAINED/,
    'takeover drains a live prior tab without waiting indefinitely for a closed tab');
  assert.match(mainSource, /if \(state\.saveTimer\) \{[\s\S]*?clearTimeout\(state\.saveTimer\)[\s\S]*?state\.saveRevision \+= 1/,
    'a debounced save from the fenced owner is invalidated');

  const startRecipe = mainSource.indexOf('function startRecipe(');
  const claim = mainSource.indexOf('bulk.leaseClaimPromise = claimRecipeBatchRecovery', startRecipe);
  const claimEnd = mainSource.indexOf('}).catch(async error =>', claim);
  const claimed = mainSource.slice(claim, claimEnd);
  assert.match(claimed, /await notifyAndDrainPreviousRecipeOwner/);
  assert.match(claimed, /state\.bulk = null;[\s\S]*?refreshSavedRecipeRecoveryDesign\(bulk\.recoveryOnFailure\)[\s\S]*?createPageNodeIndex/,
    'resume reloads the final durable checkpoint and rebuilds its node index before processing');
  assert.ok(claimed.indexOf('refreshSavedRecipeRecoveryDesign(bulk.recoveryOnFailure)') < claimed.indexOf('scheduleBulk()'),
    'no image work starts until checkpoint reconciliation has finished');

  const keepStart = mainSource.indexOf('async function keepInterruptedRecipeChanges()');
  const keepEnd = mainSource.indexOf('\nfunction resumeInterruptedRecipe', keepStart);
  const keep = mainSource.slice(keepStart, keepEnd);
  assert.match(keep, /if \(!current\) \{[\s\S]*?refreshSavedRecipeRecoveryDesign\(recovery\)[\s\S]*?state\.pendingRecipeRecovery = null;[\s\S]*?setDocumentEditingBlocked\(false\)/,
    'a concurrently removed journal cannot unblock editing until the latest saved design is reopened');
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

test('folder onboarding keeps the concrete setup failure instead of replacing it with the generic prompt', () => {
  const pickerStart = mainSource.indexOf('async function chooseWorkspaceFolder()');
  const pickerEnd = mainSource.indexOf('\nfunction syncWorkspaceOnboardingDialog()', pickerStart);
  assert.ok(pickerStart >= 0 && pickerEnd > pickerStart);
  const picker = mainSource.slice(pickerStart, pickerEnd);
  assert.match(picker, /Workspace setup could not finish[\s\S]*?\$\{message\}/,
    'folder setup errors need to remain visible in the blocking onboarding dialog');
  const handlerStart = mainSource.indexOf("$('#workspace-onboarding-choose-folder').addEventListener");
  const handlerEnd = mainSource.indexOf("$('#workspace-onboarding-browser-fallback').addEventListener", handlerStart);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  assert.match(mainSource.slice(handlerStart, handlerEnd), /status\.textContent === 'Opening the folder picker…'/,
    'the fallback copy must not overwrite an actual folder initialization failure');
  const onboarding = mainSource.slice(mainSource.indexOf('function syncWorkspaceOnboardingDialog()'), mainSource.indexOf('\nasync function continueWithBrowserStorage()'));
  assert.match(onboarding, /workspace-onboarding-browser-fallback'\)\.hidden = false/,
    'users must have an explicit local fallback if a usable folder picker still cannot initialize a workspace');
  assert.match(onboarding, /if \(!status\.textContent\.trim\(\)\) status\.textContent = copy\.status/,
    'rendering onboarding again must not erase actionable failure or migration progress');
  const browserFallback = mainSource.slice(mainSource.indexOf('async function continueWithBrowserStorage()'), mainSource.indexOf('\nasync function reconnectWorkspaceFolder'));
  assert.doesNotMatch(browserFallback, /showDirectoryPicker/,
    'the browser-storage fallback remains available even on browsers that expose folder picking');
});
