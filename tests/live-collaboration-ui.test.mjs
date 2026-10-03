import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

test('live sharing reveals one clear next step for each person', () => {
  assert.match(html, /id="live-start-host"[^>]*>Start sharing<\/button>/);
  assert.match(html, /id="live-share-capsules"[^>]*>Share link<\/button>/);
  assert.match(html, /id="live-invite-share-url"/);
  assert.match(html, /id="live-host-reply-step"[^>]*hidden/);
  assert.match(html, /2 · Paste their reply link/);
  assert.match(html, /id="live-answer-value"[^>]*placeholder="Paste the guest’s reply link here"/);
  assert.match(html, /id="live-accept-answer"[^>]*>Connect guest<\/button>/);
  assert.doesNotMatch(html, /id="live-manual-answer-options"/);
  assert.match(html, /id="live-guest-join-step"/);
  assert.match(html, /id="live-join-message"/);
  assert.match(html, /id="live-join-session"[^>]*>Join design<\/button>/);
  assert.match(html, /2 · Share this link to complete the shared context/);
  assert.match(html, /Send this URL back to the owner/);
  assert.match(html, /id="live-copy-answer"[^>]*>Share reply link<\/button>/);
  assert.match(html, /id="live-guest-reply-link"/);
  assert.match(html, /id="live-reply-link-panel"/);
  assert.match(html, /id="live-reply-link-retry"/);
  assert.match(html, /id="live-guest-reply"[^>]*hidden/);
  assert.match(html, /<summary>More options<\/summary>/);
  assert.match(html, /<summary>Privacy and connection details<\/summary>/);
  assert.match(html, /id="live-invite-value"/);
  assert.match(html, /id="live-offer-value"/);
  assert.match(html, /id="live-invite-share-url"[^>]*readonly/);
  assert.match(html, /id="live-invite-size-note"[^>]*hidden/);
  assert.match(html, /Your chat app can see the invite/);
  assert.match(html, /Your chat app can see the invite and reply/);
  assert.match(main, /Your device saves the original\. The guest can edit while you follow along\./);
  assert.match(main, /Your device saves a local copy\. The owner’s device saves the original\./);
  assert.match(main, /This link only identifies the design\. Ask the owner for the one-step share link or scan their invite QR code\./);
  assert.match(main, /revealLiveHostReplyStep\(\)/);
  assert.match(main, /\$\('#live-guest-join-step'\)\.hidden = true/);
  assert.match(main, /createLiveReplyLink\(baseUrl\.href, controller\.sessionId, controller\.answerCapsule\)/);
  assert.match(main, /startLiveReplyFromLink\(\)/);
  assert.match(main, /acceptLiveReplyInOpenHostTab\(reply\)/);
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
  assert.match(qrUi, /Show your invite/);
  assert.match(qrUi, /Scan the owner’s invite/);
  assert.match(qrUi, /onInvitationShown\(\)/);
  assert.match(qrCss, /@media \(max-width: 600px\)/);
});

test('the owner has a one-link invite, and scanning fills the same guest paste field', async () => {
  const script = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const qrUi = await readFile(new URL('../src/collaboration/qr-handoff-ui.js', import.meta.url), 'utf8');
  assert.match(script, /setLiveHostInviteFields\(controller\)/);
  assert.match(script, /createLiveInvitationLink\(baseUrl\.href, controller\.invitation, controller\.offerCapsule\)/);
  assert.match(script, /if \(!\(error instanceof RangeError\)\) throw error/);
  assert.match(script, /shareButton\.textContent = 'Share invite details'/);
  assert.match(script, /navigator\.share\(\{ title: 'Tiny Image Star design invite', text, \.\.\.\(url \? \{ url \} : \{\}\) \}\)/);
  assert.match(script, /navigator\.clipboard\.writeText\(url \|\| text\)/);
  assert.match(script, /parseLiveInvitationLink\(url\.href\)\.invitation/);
  assert.match(script, /parseLiveReplyLink\(replyUrl\)/);
  assert.match(script, /parseLiveShareMessage\(\$\('#live-join-message'\)\.value\)/);
  assert.match(script, /\$\('#live-join-message'\)\.value = formatLiveShareMessage\(invitation, offer\)/);
  assert.match(qrUi, /joinActions\.append\(scanInvitationButton\)/);
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
