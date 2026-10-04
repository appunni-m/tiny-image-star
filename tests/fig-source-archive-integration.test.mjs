import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

function functionBody(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`\nasync function ${nextName}(`, start) >= 0
    ? source.indexOf(`\nasync function ${nextName}(`, start)
    : source.indexOf(`\nfunction ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `${name} should have a bounded implementation`);
  return source.slice(start, end);
}

test('confirmed .fig imports and .flocal packages retain their opaque source sidecar', () => {
  assert.match(source, /saveFigSourceArchive as saveIndexedDbFigSourceArchive/);
  assert.match(source, /saveFigSourceArchive as saveWorkspaceFigSourceArchive/);
  assert.match(source, /loadFigSourceArchive as loadIndexedDbFigSourceArchive/);
  assert.match(source, /readFigSourceArchive as readWorkspaceFigSourceArchive/);

  const confirm = functionBody('confirmFigImport', 'switchToDocument');
  assert.match(confirm, /figSourceArchive: result\.figSourceArchive/,
    'the source is persisted only after the user confirms the import');
  assert.match(source, /figSourceArchive: packageData\.figSourceArchive/,
    'portable packages restore their optional source archive on import');

  const persist = functionBody('persistFigSourceArchiveForDesign', 'initializeWorkspaceForHandle');
  assert.match(persist, /saveWorkspaceFigSourceArchive\(workspace, designId, bytes\)/);
  assert.match(persist, /saveIndexedDbFigSourceArchive\(designId, bytes\)/);
  assert.match(persist, /if \(bytes == null\) return/,
    'ordinary edits and packages without source data do not create an archive');
});

test('folder migration, boot restoration, and design switching restore archives without growing design JSON', () => {
  const transfer = functionBody('copyIndexedDbFigSourceArchivesToWorkspace', 'persistFigSourceArchiveForDesign');
  assert.match(transfer, /for \(const designId of \[\.\.\.new Set\(designIds\)\]\)/,
    'archive transfer is sequential and keeps at most one archive buffer live per item');
  assert.match(transfer, /readWorkspaceFigSourceArchive\(workspace, designId\)/);
  assert.match(transfer, /loadIndexedDbFigSourceArchive\(designId\)/);
  assert.match(transfer, /saveWorkspaceFigSourceArchive\(workspace, designId, bytes\)/);

  const initialize = functionBody('initializeWorkspaceForHandle', 'activateWorkspace');
  assert.match(initialize, /copyIndexedDbFigSourceArchivesToWorkspace\(workspace/);
  assert.match(initialize, /readFigSourceArchiveForDesign\(designId, workspace\)/,
    'workspace reconnect restores the active design lazily');
  const boot = functionBody('restoreSavedWorkspaceOnBoot', 'boot');
  assert.match(boot, /readFigSourceArchiveForDesign\(opened\.document\.id, workspace\)/);

  const switching = functionBody('switchToDocument', 'renderDesignLibrary');
  assert.match(switching, /persistFigSourceArchiveForDesign\(nextDocument\.id, figSourceArchive\)/);
  assert.match(switching, /readFigSourceArchiveForDesign\(nextDocument\.id, state\.workspace\)/,
    'opening a design falls back to its IndexedDB mirror and lazily writes the workspace copy');
  assert.doesNotMatch(source, /state\.document\.figSourceArchive|serializeDocument\([^)]*figSourceArchive/,
    'archive bytes remain outside autosaved editable design snapshots');
});

test('export budgets and packages the exact retained archive bytes before loading media data', () => {
  const snapshot = functionBody('buildLocalDesignPackageSnapshot', 'exportDesign');
  assert.match(snapshot, /const figSourceArchive = await readFigSourceArchiveForDesign\(design\.id\)/);
  assert.match(snapshot, /admitBinaryLength\(figSourceArchive\.byteLength, 'the retained original \.fig source'\)/);
  assert.ok(snapshot.indexOf('admitBinaryLength(figSourceArchive.byteLength') < snapshot.indexOf('const assets = []'),
    'archive length participates in the package limit before image binaries are read');
  assert.match(snapshot, /buildLocalPackageBlob\(design, assets, fonts, \{ figSourceArchive \}\)/);
});

test('design duplication and deletion keep sidecars aligned with design lifetime', () => {
  const library = functionBody('handleDesignLibraryAction', 'renderDocumentVersionHistory');
  assert.match(library, /readWorkspaceFigSourceArchive\(state\.workspace, id\)/);
  assert.match(library, /saveWorkspaceFigSourceArchive\(state\.workspace, duplicate\.id, duplicateFigSourceArchive\.bytes\)/);
  assert.match(library, /saveIndexedDbFigSourceArchive\(duplicate\.id, duplicateFigSourceArchive\.bytes\)/,
    'workspace duplicates retain a browser mirror for later workspace transfers');
  assert.match(library, /deleteWorkspaceDesign\(state\.workspace, id\)/,
    'folder deletion recursively removes its design-local archive directory');
  assert.match(library, /deleteIndexedDbFigSourceArchive\(id\)/,
    'deletion also cleans a stale optional IndexedDB mirror');
});
