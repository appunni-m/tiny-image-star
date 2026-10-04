import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const stylesheet = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

function ruleBlock(source, marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `expected ${marker}`);
  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, `expected an opening brace for ${marker}`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  assert.fail(`expected ${marker} block to close`);
}

test('live sharing reveals one clear next step for each person', () => {
  assert.match(html, /id="live-start-host"[^>]*>Start sharing<\/button>/);
  assert.match(html, /id="live-share-capsules"[^>]*>Share link<\/button>/);
  assert.match(html, /id="live-invite-share-url"/);
  assert.match(html, /<form class="dialog-dismiss-form" method="dialog"><button class="icon-button" id="live-collaboration-close" type="submit" data-dialog-dismiss aria-label="Close live collaboration">×<\/button><\/form>/,
    'the header close control should close natively and through the explicit dismissal handler');
  assert.match(html, /<div class="dialog-actions live-collaboration-dismiss-actions"><form class="dialog-dismiss-form" method="dialog"><button class="secondary-button" id="live-collaboration-close-action" type="submit" data-dialog-dismiss>Close sharing<\/button><\/form><\/div>/,
    'a native close action should remain available after scrolling through sharing options');
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
  assert.match(html, /While a guest is connected, your canvas follows their changes and you cannot edit\. Stop sharing to take control again\./,
    'the host should understand the read-only consequence before starting a session');
  assert.match(html, /Invite each person separately\. Every guest needs their own invite link and reply link\./,
    'the host should understand how to invite multiple people');
  assert.match(html, /Design identity link · cannot join by itself/,
    'the advanced stable link should not look like a standalone join link');
  assert.match(html, /Your chat app can see the invite/);
  assert.match(html, /Your chat app can see the invite and reply/);
  assert.match(main, /the owner’s app checks each change and updates the shared design automatically/);
  assert.doesNotMatch(main, /sent to the owner for approval/,
    'guest status should not imply that the owner manually approves every edit');
  assert.match(main, /Your device saves the original\. The guest can edit while you follow along\./);
  assert.match(main, /Your device saves a local copy\. The owner’s device saves the original\./);
  assert.match(main, /This link only identifies the design\. Ask the owner for the one-step share link or scan their invite QR code\./);
  assert.match(main, /revealLiveHostReplyStep\(\)/);
  assert.match(main, /\$\('#live-guest-join-step'\)\.hidden = true/);
  assert.match(main, /createLiveReplyLink\(baseUrl\.href, controller\.sessionId, controller\.answerCapsule\)/);
  assert.match(main, /startLiveReplyFromLink\(\)/);
  assert.match(main, /acceptLiveReplyInOpenHostTab\(reply\)/);
});

test('phone live-sharing close controls stay sticky, safe-area clear, and finger-sized', () => {
  const phoneRules = ruleBlock(stylesheet, '@media (max-width: 600px) {');
  const safeAreaStart = stylesheet.lastIndexOf('/* Respect cutouts and home indicators');
  assert.notEqual(safeAreaStart, -1, 'expected the final phone safe-area rules');
  const phoneSafeAreaRules = ruleBlock(stylesheet.slice(safeAreaStart), '@media (max-width: 820px) {');
  assert.match(phoneRules, /\.live-collaboration-content > \.modal-title-row\s*\{[^}]*position:\s*sticky[^}]*top:\s*0/,
    'the header close control should remain reachable while the sharing content scrolls');
  assert.match(phoneRules, /\.live-collaboration-content #live-collaboration-close\s*\{[^}]*width:\s*44px[^}]*min-width:\s*44px[^}]*height:\s*44px[^}]*min-height:\s*44px/,
    'the sticky header close icon should have a 44px hit area');
  assert.match(phoneRules, /\.live-collaboration-content > \.live-collaboration-dismiss-actions\s*\{[^}]*bottom:\s*0[^}]*padding:\s*12px 16px max\(12px,\s*env\(safe-area-inset-bottom\)\)/,
    'the pinned footer should keep its close action above the phone home-indicator area');
  assert.match(phoneRules, /#live-collaboration-close-action\s*\{[^}]*width:\s*100%[^}]*min-height:\s*44px[^}]*height:\s*44px/,
    'the footer close action should span the narrow dialog and meet the 44px target');
  assert.match(stylesheet, /\.live-collaboration-content > \.live-collaboration-dismiss-actions\s*\{[^}]*position:\s*sticky/,
    'the footer close control should stay pinned as the dialog scrolls');
  assert.match(stylesheet, /\.live-collaboration-dialog\s*\{[^}]*overflow:\s*auto/,
    'the full sharing dialog should keep normal scrolling beneath the sticky close controls');
  assert.match(phoneSafeAreaRules, /\.modal\s*\{[^}]*max-height:\s*calc\(100dvh - max\(16px, env\(safe-area-inset-top\)\) - max\(16px, env\(safe-area-inset-bottom\)\)\)/,
    'phone dialogs should fit between the top and bottom safe areas while remaining scrollable');
});

test('live sharing offers a bundled QR handoff and a local answer scanner without removing text fallback', async () => {
  const script = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const qrUi = await readFile(new URL('../src/collaboration/qr-handoff-ui.js', import.meta.url), 'utf8');
  const dismissal = await readFile(new URL('../src/collaboration/dialog-dismissal.js', import.meta.url), 'utf8');
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
  assert.match(qrUi, /bindDialogDismissal\(dialog,/,
    'the QR sharing panel should use the shared dismissal behavior and stop its camera or animation after closing');
  assert.match(dismissal, /if \(event\.target === dialog\) close\(\)/,
    'clicking outside the QR sharing panel should dismiss it');
  assert.match(dismissal, /\[data-dialog-dismiss\]/,
    'visible sharing close buttons should use a captured explicit dismissal action');
  assert.match(dismissal, /dialog\.addEventListener\('click', dismissOnControlClick, true\)/,
    'dialog dismissal should run before app-level click handlers can suppress it');
  assert.match(qrUi, /<form class="dialog-dismiss-form" method="dialog"><button class="icon-button" id="live-qr-close" type="submit" value="close" data-dialog-dismiss aria-label="Close sharing">×<\/button><\/form>/,
    'the QR panel close icon should work natively and through the explicit dismissal handler');
  assert.match(qrUi, /<form class="dialog-dismiss-form" method="dialog"><button class="secondary-button" id="live-qr-close-action" type="submit" value="close" data-dialog-dismiss>Close sharing<\/button><\/form>/,
    'the QR panel should offer a native action that exits the sharing flow');
  assert.match(qrUi, /bindDialogDismissal\(dialog, \[\], \{ onDismiss:/,
    'QR dismissal should use shared keyboard, backdrop, and explicit close handling');
  assert.match(qrUi, /bindDialogDismissal\(dialog, \[\], \{ onDismiss: \(\) => \{\s*void stopActivities\(\);\s*closeSharing\(\);\s*\} \}\)/,
    'explicitly dismissing the QR window should close the sharing panel beneath it');
  assert.match(qrUi, /dialog\.addEventListener\('close', \(\) => \{\s*void stopActivities\(\);\s*if \(dialog\.returnValue === 'close'\) closeSharing\(\);\s*\}\)/,
    'closing the QR window should stop its camera or animation and close the sharing parent on a native fallback');
  assert.match(main, /closeSharing: \(\) => closeDialog\(\$\('#live-collaboration-dialog'\), 'close'\)/,
    'the QR panel should close its parent sharing dialog without stopping the session');
  assert.match(qrUi, /Show your invite/);
  assert.match(qrUi, /File → Join a shared design, then Scan invite QR/);
  assert.match(qrUi, /choose Scan reply QR in their sharing window/);
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
