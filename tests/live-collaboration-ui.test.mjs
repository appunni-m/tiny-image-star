import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('live sharing distinguishes the stable invitation and offer and discloses channel-visible network details', () => {
  assert.match(html, /id="live-invite-value"/);
  assert.match(html, /id="live-offer-value"/);
  assert.match(html, /The channel you use can read both items, including network details in the offer/);
  assert.match(html, /The service carrying your answer can read its network details/);
});

test('live sharing offers a bundled QR handoff and a local answer scanner without removing text fallback', async () => {
  const script = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const qrUi = await readFile(new URL('../src/collaboration/qr-handoff-ui.js', import.meta.url), 'utf8');
  const qrCss = await readFile(new URL('../src/collaboration/qr-handoff.css', import.meta.url), 'utf8');
  assert.match(script, /initializeCollaborationQrHandoff/);
  for (const id of ['live-show-invitation-qr', 'live-scan-answer-qr', 'live-scan-invitation-qr', 'live-show-answer-qr', 'live-qr-image-input', 'live-qr-start-camera']) {
    assert.ok(qrUi.includes(id), `the QR handoff must create #${id}`);
  }
  assert.match(qrUi, /createQrTransferFrames\(payload\)/);
  assert.match(qrUi, /createLiveInvitationQrPayload\(invitation, offer\)/);
  assert.match(qrUi, /readLiveQrPayload\(value\)/);
  assert.match(qrUi, /await scanner\.start\(\)/);
  assert.match(qrUi, /readLiveSharingQrImage\(file\)/);
  assert.match(qrUi, /dialog\.addEventListener\('close'/);
  assert.match(qrUi, /Anyone who captures all frames can request edit access/);
  assert.match(qrCss, /@media \(max-width: 600px\)/);
});

test('host collaboration exposes a guest roster, selectable answers, independent offers, and per-peer disconnect controls', async () => {
  assert.match(html, /id="live-add-guest"/);
  assert.match(html, /id="live-peer-list"[^>]+aria-live="polite"/);
  const script = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(script, /addGuestSession\(/);
  assert.match(script, /peer\.controller\.close\(\)/);
  assert.match(script, /peer\?\.controller\s*\|\|\s*session\?\.controller/);
  assert.match(script, /Use this guest/);
  assert.match(script, /answerDraft/);
  assert.match(script, /markLocalEditsPending\(\)/);
  assert.match(script, /canAdoptRoomRevision: \(\) => !state\.interaction && !state\.textNodeId/);
  const installStart = script.indexOf('async function installLiveReplicaSnapshot');
  const roomInstallEnd = script.indexOf("if (session.replicaReady) {", installStart);
  const roomInstall = script.slice(installStart, roomInstallEnd);
  assert.match(roomInstall, /source === 'room-revision'/);
  assert.match(roomInstall, /state\.document = nextDocument/);
  assert.ok(roomInstall.indexOf('state.document = nextDocument') < roomInstall.indexOf('await persistLiveReplicaSnapshot'));
});

test('live collaboration publishes transient presence and renders remote cursors and selections', async () => {
  const script = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const renderer = await readFile(new URL('../src/renderer.js', import.meta.url), 'utf8');
  const protocol = await readFile(new URL('../src/collaboration/protocol.js', import.meta.url), 'utf8');
  assert.match(script, /onPresence: applyLivePresence/);
  assert.match(script, /queueLivePresenceSync\(screenToWorld\(event, canvas, state\)\)/);
  assert.match(script, /function currentLivePresenceState\(session\)/);
  assert.match(renderer, /this\.drawRemotePresence\(ctx, page, state\)/);
  assert.match(renderer, /Guest \$\{String\(peer\.peerActorId\)\.slice\(-4\)\}/);
  assert.match(protocol, /COLLABORATION_PROTOCOL_VERSION = 2/);
  assert.match(protocol, /'PRESENCE'/);
});
