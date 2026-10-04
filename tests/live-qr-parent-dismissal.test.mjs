import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const qrUi = await readFile(new URL('../src/collaboration/qr-handoff-ui.js', import.meta.url), 'utf8');

test('closing the invite QR also closes the sharing panel without ending collaboration', () => {
  assert.match(qrUi, /bindDialogDismissal\(dialog, \[\], \{ onDismiss: \(\) => \{\s*void stopActivities\(\);\s*closeSharing\(\);\s*\} \}\)/,
    'explicit QR dismissal should stop QR activity and close the parent sharing panel');
  assert.match(qrUi, /dialog\.addEventListener\('close', \(\) => \{\s*void stopActivities\(\);\s*if \(dialog\.returnValue === 'close'\) closeSharing\(\);\s*\}\)/,
    'native dialog close should also close the parent panel');
  assert.match(qrUi, /closeSharing = \(\) => dismissDialog\(document\.querySelector\('#live-collaboration-dialog'\), 'close'\)/,
    'the QR module should close the parent panel even when no host callback is wired');
});
