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
  assert.match(html, /1 · Open or paste the owner’s invite/);
  assert.match(html, /id="live-join-message"/);
  assert.match(html, /id="live-join-session"[^>]*>Create reply link<\/button>/);
  assert.match(html, /2 · You’re not connected yet/);
  assert.match(html, /They paste it into their sharing window and choose Connect guest/);
  assert.match(html, /Share this reply link with the owner/);
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

test('oversized invite links surface the full-message fallback', () => {
  const fieldsStart = main.indexOf('function setLiveHostInviteFields(controller)');
  const fieldsEnd = main.indexOf('\nfunction renderLiveHostPeers', fieldsStart);
  assert.ok(fieldsStart >= 0 && fieldsEnd > fieldsStart);
  const fields = main.slice(fieldsStart, fieldsEnd);
  assert.ok(fields.indexOf("$('#live-share-message-value').value = formatLiveShareMessage")
    < fields.indexOf('createLiveInvitationLink('), 'the full invite must be ready before URL-size handling');
  assert.match(fields, /catch \(error\) \{\s*if \(!\(error instanceof RangeError\)\) throw error;[\s\S]*?\$\('#live-invite-share-url'\)\.value = '';[\s\S]*?urlWrap\.hidden = true;[\s\S]*?\$\('#live-invite-size-note'\)\.hidden = false;[\s\S]*?shareButton\.textContent = 'Share invite details'/);

  const shareStart = main.indexOf('async function shareLiveCapsules()');
  const shareEnd = main.indexOf('\nasync function shareLiveAnswer', shareStart);
  assert.ok(shareStart >= 0 && shareEnd > shareStart);
  const share = main.slice(shareStart, shareEnd);
  assert.match(share, /const text = url\s*\?[\s\S]*?: \$\('#live-share-message-value'\)\.value\.trim\(\)/);
  assert.match(share, /navigator\.clipboard\.writeText\(url \|\| text\)/);
});

test('initial host invite setup closes its controller if invite-field preparation fails', () => {
  const start = main.indexOf('async function startLiveHost()');
  const end = main.indexOf('\nasync function addLiveHostGuest()', start);
  assert.ok(start >= 0 && end > start);
  const host = main.slice(start, end);
  assert.ok(host.indexOf('session.controller = controller') < host.indexOf('setLiveHostInviteFields(controller)'));
  const catchStart = host.lastIndexOf('} catch (error) {');
  const catchEnd = host.indexOf('} finally', catchStart);
  assert.ok(catchStart >= 0 && catchEnd > catchStart);
  const cleanup = host.slice(catchStart, catchEnd);
  assert.match(cleanup, /failedSession\?\.controller[\s\S]*?await failedSession\.controller\.revoke\(\)[\s\S]*?catch \{ failedSession\.controller\.close\?\.\(\); \}/);
  assert.match(cleanup, /if \(failedSession\) state\.liveCollaboration = null/);
});

test('subsequent guest invite setup closes and removes a peer if invite-field preparation fails', () => {
  const start = main.indexOf('async function addLiveHostGuest()');
  const end = main.indexOf('\nasync function ensureLiveReplicaDesign', start);
  assert.ok(start >= 0 && end > start);
  const addGuest = main.slice(start, end);
  assert.ok(addGuest.indexOf('peer.controller = controller') < addGuest.indexOf('setLiveHostInviteFields(controller)'));
  const catchStart = addGuest.lastIndexOf('} catch (error) {');
  const catchEnd = addGuest.indexOf('} finally', catchStart);
  assert.ok(catchStart >= 0 && catchEnd > catchStart);
  const cleanup = addGuest.slice(catchStart, catchEnd);
  assert.match(cleanup, /peer\.controller\?\.close\(\);\s*peer\.controller = null;\s*peer\.status = 'failed';\s*refreshLiveHostRoomUi\(session\)/);
});

test('host collaboration exposes a guest roster, selectable answers, independent offers, and per-peer disconnect controls', async () => {
  assert.match(html, /id="live-add-guest"/);
  assert.match(html, /<span>Up to 4 guests<\/span>/);
  assert.ok(html.indexOf('id="live-add-guest"') < html.indexOf('<details class="live-advanced">'), 'inviting another person should be visible without opening More options');
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
