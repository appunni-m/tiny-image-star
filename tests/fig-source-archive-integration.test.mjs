import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

function functionBody(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`\nasync function ${nextName}(`, start) >= 0
    ? source.indexOf(`\nasync function ${nextName}(`, start)
    : source.indexOf(`\nfunction ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `${name} should have a bounded implementation`);
  return source.slice(start, end);
}

function asyncFunctionBody(name, nextName) {
  const start = source.indexOf(`async function ${name}(`);
  const end = source.indexOf(`\nasync function ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `${name} should have a bounded async implementation`);
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
  assert.match(source, /#fig-import-confirm'\)\.addEventListener\('click', \(\) => \{ void confirmFigImport\(\); \}\)/,
    'only the explicit import confirmation action enters the local design-switch path');
  assert.match(source, /figSourceArchive: packageData\.figSourceArchive/,
    'portable packages restore their optional source archive on import');

  const persist = functionBody('persistFigSourceArchiveForDesign', 'initializeWorkspaceForHandle');
  assert.match(persist, /saveWorkspaceFigSourceArchive\(workspace, designId, bytes\)/);
  assert.match(persist, /saveIndexedDbFigSourceArchive\(designId, bytes\)/);
  assert.match(persist, /if \(bytes == null\) return/,
    'ordinary edits and packages without source data do not create an archive');
});

test('confirmed import forwards the worker archive and extracted assets into local design creation', async () => {
  const figSourceArchive = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 4, 5, 6]).buffer;
  const result = {
    document: { id: 'fig-design', pages: [{ id: 'page-1' }] },
    assets: [{ id: 'image-1', name: 'photo.png', type: 'image/png', bytes: Uint8Array.from([1, 2, 3]) }],
    figSourceArchive
  };
  const confirm = asyncFunctionBody('confirmFigImport', 'switchToDocument');
  const output = await runInNewContext(`(async () => {
    let pendingFigImport = result;
    let closeCount = 0;
    const button = { disabled: false };
    const dialog = { close() { closeCount += 1; } };
    const captured = {};
    function $(selector) { return selector === '#fig-import-confirm' ? button : dialog; }
    async function switchToDocument(document, options) {
      captured.document = document;
      captured.options = options;
      return true;
    }
    async function importLocalPackage(document, assets) {
      captured.assets = assets;
      return { document: { ...document, importedAssets: assets.map(asset => asset.id) } };
    }
    ${confirm}
    await confirmFigImport();
    await captured.options.beforeSwitch(captured.document);
    return { captured, buttonDisabled: button.disabled, closeCount };
  })()`, { result });

  assert.equal(output.captured.options.figSourceArchive, figSourceArchive,
    'the precise transferred buffer is passed only through the user-confirmed design switch');
  assert.deepEqual(output.captured.assets.map(asset => asset.id), ['image-1']);
  assert.deepEqual(output.captured.document.importedAssets, ['image-1']);
  assert.equal(output.captured.options.versionLabel, 'Imported .fig design');
  assert.equal(output.buttonDisabled, false);
  assert.equal(output.closeCount, 1);
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
  assert.match(library, /copyFigSourceArchiveForDuplicate\(id, duplicate\.id, state\.workspace\)/,
    'workspace duplicates restore a missing folder copy from the IndexedDB mirror before copying it');
  assert.match(library, /saveIndexedDbFigSourceArchive\(duplicate\.id, duplicateFigSourceArchive\)/,
    'workspace duplicates retain a browser mirror for later workspace transfers');
  assert.match(library, /deleteWorkspaceDesign\(state\.workspace, id\)/,
    'folder deletion recursively removes its design-local archive directory');
  assert.match(library, /deleteIndexedDbFigSourceArchive\(id\)/,
    'deletion also cleans a stale optional IndexedDB mirror');
});

test('workspace duplicate restores a missing source sidecar from the browser mirror and copies the same bytes', async () => {
  const workspace = { workspaceId: 'test-workspace' };
  const original = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x17, 0x22, 0x39]).buffer;
  const savedInWorkspace = new Map();
  const workspaceReads = [];
  const indexedDbReads = [];
  const workspaceWrites = [];
  const readWorkspace = async (targetWorkspace, designId) => {
    assert.equal(targetWorkspace, workspace);
    workspaceReads.push(designId);
    const bytes = savedInWorkspace.get(designId);
    return bytes ? { bytes: bytes.slice(0), metadata: { designId } } : null;
  };
  const loadIndexedDb = async designId => {
    indexedDbReads.push(designId);
    return designId === 'source-design' ? original.slice(0) : null;
  };
  const saveWorkspace = async (targetWorkspace, designId, source) => {
    assert.equal(targetWorkspace, workspace);
    const bytes = source instanceof ArrayBuffer
      ? source.slice(0)
      : source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    savedInWorkspace.set(designId, bytes);
    workspaceWrites.push(designId);
  };
  const archiveReader = asyncFunctionBody('readFigSourceArchiveForDesign', 'copyFigSourceArchiveForDuplicate');
  const duplicateCopier = asyncFunctionBody('copyFigSourceArchiveForDuplicate', 'copyIndexedDbFigSourceArchivesToWorkspace');
  const copyForDuplicate = await runInNewContext(
    `(async () => { ${archiveReader}\n${duplicateCopier}\nreturn copyFigSourceArchiveForDuplicate; })()`,
    {
      readWorkspaceFigSourceArchive: readWorkspace,
      loadIndexedDbFigSourceArchive: loadIndexedDb,
      saveWorkspaceFigSourceArchive: saveWorkspace,
      state: { workspace },
      console: { warn() {} }
    }
  );

  const duplicateBytes = await copyForDuplicate('source-design', 'duplicate-design', workspace);

  assert.deepEqual([...new Uint8Array(duplicateBytes)], [...new Uint8Array(original)]);
  assert.deepEqual([...new Uint8Array(savedInWorkspace.get('source-design'))], [...new Uint8Array(original)],
    'the missing source folder copy is lazily repaired from its valid browser mirror');
  assert.deepEqual([...new Uint8Array(savedInWorkspace.get('duplicate-design'))], [...new Uint8Array(original)],
    'the duplicate receives the original bytes, not only the editable document');
  assert.deepEqual(indexedDbReads, ['source-design']);
  assert.deepEqual(workspaceReads, ['source-design']);
  assert.deepEqual(workspaceWrites, ['source-design', 'duplicate-design']);
});
