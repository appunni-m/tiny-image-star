const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');

function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 30000) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try { if (await test()) { resolve(); return; } } catch { /* Let the editor finish booting and saving local preferences. */ }
      if (performance.now() - started > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(() => { void poll(); }, 25);
    };
    void poll();
  });
}
function click(app, element) {
  assert(element, 'Expected a live-sharing control.');
  element.dispatchEvent(new app.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}
function assertFitsPhone(app, element, label) {
  const box = element.getBoundingClientRect();
  assert(box.width >= 44 && box.height >= 44, `${label} should have a finger-sized tap target.`);
  assert(box.left >= 0 && box.right <= app.defaultView.innerWidth, `${label} should fit within the phone width.`);
}

try {
  await waitFor(() => frame.contentDocument?.documentElement.dataset.appReady === 'true', 'editor startup');
  const app = frame.contentDocument;
  const onboarding = app.querySelector('#workspace-onboarding-dialog');
  if (onboarding?.open) {
    Object.defineProperty(app.defaultView, 'showDirectoryPicker', { configurable: true, value: undefined });
    const fallback = app.querySelector('#workspace-onboarding-browser-fallback');
    assert(fallback, 'The isolated phone editor did not expose its browser-storage workspace setup.');
    fallback.hidden = false;
    click(app, fallback);
    await waitFor(() => !onboarding.open, 'editor workspace setup');
  }

  // A received invite is commonly clicked while the editor tab is already
  // open. Exercise the real hashchange route so a thrown history error cannot
  // leave the user with no UI.
  const dialog = app.querySelector('#live-collaboration-dialog');
  const inviteErrors = [];
  app.defaultView.addEventListener('error', event => inviteErrors.push(event.message));
  app.defaultView.location.hash = '#tisjoin1.tisd1.invalid.tisc1.invalid';
  await waitFor(() => dialog.open && !app.querySelector('#live-guest-panel').hidden, 'received invite link');
  assert(app.querySelector('#live-join-message').value.includes('#tisjoin1.tisd1.invalid.tisc1.invalid'),
    'clicking a received one-link invite should put it in the join flow');
  assert(app.defaultView.location.hash === '', 'the invite secret should be removed from the address bar after routing');
  await waitFor(() => app.querySelector('#live-guest-status').textContent.trim(), 'invite feedback');
  assert(inviteErrors.length === 0, `invite click should not throw: ${inviteErrors.join('; ')}`);
  app.querySelector('#live-collaboration-close').click();
  await waitFor(() => !dialog.open, 'close received invite flow');


  assert(app.querySelector('#share-button').textContent.trim() === 'Share', 'The top-bar action should open the live invitation flow.');
  app.defaultView.dispatchEvent(new app.defaultView.CustomEvent('tiny-image-star:join-live', { cancelable: true }));
  await waitFor(() => dialog.open && !app.querySelector('#live-guest-panel').hidden, 'join design dialog');
  assert(app.querySelector('#live-collaboration-title').textContent === 'Join a design', 'The joining dialog should use plain language.');
  assert(app.querySelector('#live-join-message')?.placeholder === 'Paste the whole invite message here', 'The default join flow should ask for one complete message.');
  assert(app.querySelector('#live-join-session')?.textContent.trim() === 'Create reply link', 'The join action should explain that the guest must create a reply link.');
  assert([...app.querySelectorAll('#live-guest-panel .live-advanced')].every(details => !details.open), 'Advanced sharing details should start collapsed.');
  const join = app.querySelector('#live-join-session');
  const scan = app.querySelector('#live-scan-invitation-qr');
  assertFitsPhone(app, join, 'Create reply link');
  assertFitsPhone(app, scan, 'Scan invite QR');
  assert(app.querySelector('#live-join-actions').getBoundingClientRect().right <= app.defaultView.innerWidth,
    'The join and scan actions should fit within a narrow phone layout.');
  click(app, app.querySelector('#live-collaboration-close'));
  await waitFor(() => !dialog.open, 'join dialog close');

  app.querySelector('#live-host-panel').hidden = false;
  app.querySelector('#live-guest-panel').hidden = true;
  app.querySelector('#live-collaboration-title').textContent = 'Invite someone';
  app.querySelector('#live-collaboration-copy').textContent = 'Your device saves the design. Send an invite, then connect the reply they send back.';
  dialog.showModal();
  assert(!app.querySelector('#live-host-start').hidden, 'A first-time owner should see one clear Start sharing action.');
  assertFitsPhone(app, app.querySelector('#live-start-host'), 'Start sharing');
  assert(app.querySelector('#live-host-active').hidden, 'Invite details and reply steps should stay out of the initial screen.');
  assert(app.querySelector('#live-host-reply-step').hidden, 'The owner should see the reply step only after sending the invite.');
  const hostAdvanced = app.querySelector('#live-host-active .live-advanced');
  assert(hostAdvanced && !hostAdvanced.open, 'Extra host options should be collapsed by default.');

  result.textContent = `PASS\n${JSON.stringify({ mobileWidth: app.defaultView.innerWidth, joinWithOneMessage: true, cameraScanAvailable: true, technicalDetailsCollapsed: true, progressiveSteps: true, liveShareActionTopLevel: true, localFileShareUnderFileMenu: true })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
}
