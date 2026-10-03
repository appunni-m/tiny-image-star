import {
  createLiveAnswerQrPayload,
  createLiveInvitationQrPayload,
  createQrTransferAssembler,
  createQrTransferFrames,
  readLiveQrPayload
} from './qr-transport.js';

function makeButton(id, label, { hidden = false, disabled = false } = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.id = id;
  button.className = 'secondary-button live-qr-action';
  button.textContent = label;
  button.hidden = hidden;
  button.disabled = disabled;
  return button;
}

function installDialog() {
  const dialog = document.createElement('dialog');
  dialog.id = 'live-qr-dialog';
  dialog.className = 'modal live-qr-dialog';
  dialog.setAttribute('aria-labelledby', 'live-qr-title');
  dialog.innerHTML = `
    <section class="live-qr-content">
      <div class="modal-title-row">
        <div><span class="modal-eyebrow">SHARE BY QR CODE</span><h2 id="live-qr-title">Share live design</h2></div>
        <button class="icon-button" id="live-qr-close" type="button" aria-label="Close QR sharing">×</button>
      </div>
      <p class="modal-copy" id="live-qr-note"></p>
      <div id="live-qr-display" hidden>
        <canvas id="live-qr-canvas" width="560" height="560" aria-label="Animated QR code for live-sharing handoff"></canvas>
        <div class="live-qr-controls"><button class="secondary-button" id="live-qr-previous" type="button" aria-label="Previous QR frame">‹</button><span id="live-qr-frame-status" role="status" aria-live="polite"></span><button class="secondary-button" id="live-qr-next" type="button" aria-label="Next QR frame">›</button></div>
      </div>
      <div id="live-qr-scan" hidden>
        <video id="live-qr-video" class="live-qr-video" muted playsinline></video>
        <p class="live-qr-progress" id="live-qr-scan-status" role="status" aria-live="polite">Start the camera or scan QR images one by one.</p>
        <div class="live-qr-scan-actions">
          <button class="secondary-button" id="live-qr-start-camera" type="button">Use camera</button>
          <label class="secondary-button live-qr-image-label" for="live-qr-image-input">Choose QR image</label>
          <input id="live-qr-image-input" class="sr-only" type="file" accept="image/*" />
          <button class="secondary-button" id="live-qr-reset-scan" type="button">Start over</button>
        </div>
      </div>
      <div class="dialog-actions"><button class="secondary-button" id="live-qr-close-action" type="button">Close</button></div>
    </section>`;
  document.body.append(dialog);
  return dialog;
}

/** Add the local QR transport beside the existing text-based collaboration controls. */
export function initializeCollaborationQrHandoff({ validateInvitation, onGuestHandoff, onHostAnswer, onInvitationShown = () => {}, notify = () => {} } = {}) {
  const invitationField = document.querySelector('#live-invite-value');
  const offerField = document.querySelector('#live-offer-value');
  const shareButton = document.querySelector('#live-share-capsules');
  const hostAnswerField = document.querySelector('#live-answer-value');
  const hostAnswerActions = document.querySelector('#live-answer-actions');
  const joinInvitationField = document.querySelector('#live-join-invite');
  const joinOfferField = document.querySelector('#live-join-offer');
  const answerField = document.querySelector('#live-guest-answer');
  const copyAnswerButton = document.querySelector('#live-copy-answer');
  if (!invitationField || !offerField || !shareButton || !hostAnswerField || !hostAnswerActions || !joinInvitationField || !joinOfferField || !answerField || !copyAnswerButton) {
    throw new Error('The live collaboration QR controls could not find their handoff fields.');
  }

  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = new URL('./qr-handoff.css', import.meta.url).href;
  stylesheet.dataset.liveQrStyles = 'true';
  document.head.append(stylesheet);

  const joinMessageField = document.querySelector('#live-join-message');
  const joinActions = document.querySelector('#live-join-actions');
  if (!joinMessageField || !joinActions) throw new Error('The live collaboration invite message controls are missing.');

  const showInvitationButton = makeButton('live-show-invitation-qr', 'Show invite QR', { hidden: true });
  shareButton.after(showInvitationButton);
  const scanAnswerButton = makeButton('live-scan-answer-qr', 'Scan reply QR', { disabled: true });
  hostAnswerActions.append(scanAnswerButton);
  const scanInvitationButton = makeButton('live-scan-invitation-qr', 'Scan invite QR');
  joinActions.append(scanInvitationButton);
  const showAnswerButton = makeButton('live-show-answer-qr', 'Show reply QR', { hidden: true });
  copyAnswerButton.after(showAnswerButton);
  const dialog = installDialog();
  let runtimePromise = null;
  let playback = null;
  let scanner = null;
  let assembler = null;
  let mode = null;
  let frameIndex = 0;
  let decodeBusy = false;

  function runtime() {
    runtimePromise ||= import('./qr-runtime.bundle.js');
    return runtimePromise;
  }
  async function stopActivities() {
    if (playback?.timer) clearTimeout(playback.timer);
    if (playback?.frames) playback.frames.fill('');
    playback = null;
    frameIndex = 0;
    const activeScanner = scanner;
    scanner = null;
    assembler?.reset();
    assembler = null;
    mode = null;
    decodeBusy = false;
    if (activeScanner) {
      try { await activeScanner.stop(); } catch {}
    }
    const canvas = dialog.querySelector('#live-qr-canvas');
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    const video = dialog.querySelector('#live-qr-video');
    if (video && !scanner) video.srcObject = null;
    const imageInput = dialog.querySelector('#live-qr-image-input');
    if (imageInput) imageInput.value = '';
  }
  function closeDialog() {
    if (dialog.open) dialog.close();
    else void stopActivities();
  }
  async function drawFrame() {
    const current = playback;
    if (!current?.frames.length) return;
    const currentIndex = frameIndex % current.frames.length;
    try {
      await current.runtime.drawLiveSharingQr(dialog.querySelector('#live-qr-canvas'), current.frames[currentIndex]);
      if (playback !== current) return;
      dialog.querySelector('#live-qr-frame-status').textContent = current.frames.length > 1
        ? `Code ${currentIndex + 1} of ${current.frames.length} · changes automatically`
        : 'Ready to scan';
    } catch (error) {
      dialog.querySelector('#live-qr-frame-status').textContent = error.message || 'Could not draw this QR frame.';
    }
    if (playback === current && current.frames.length > 1) {
      current.timer = setTimeout(() => {
        frameIndex = (frameIndex + 1) % current.frames.length;
        void drawFrame();
      }, 900);
    }
  }
  async function showTransfer(payload, title, note) {
    try {
      await stopActivities();
      if (dialog.open) dialog.close();
      const [qrRuntime, transfer] = await Promise.all([runtime(), createQrTransferFrames(payload)]);
      mode = 'display';
      playback = { runtime: qrRuntime, frames: transfer.frames, timer: 0 };
      dialog.querySelector('#live-qr-title').textContent = title;
      dialog.querySelector('#live-qr-note').textContent = note;
      dialog.querySelector('#live-qr-display').hidden = false;
      dialog.querySelector('#live-qr-scan').hidden = true;
      dialog.showModal();
      await drawFrame();
      return true;
    } catch (error) {
      await stopActivities();
      notify(error.message || 'Could not prepare the local QR handoff.');
      return false;
    }
  }
  async function showInvitation() {
    try {
      const invitation = invitationField.value.trim();
      const offer = offerField.value.trim();
      validateInvitation(invitation);
      const shown = await showTransfer(createLiveInvitationQrPayload(invitation, offer), 'Show your invite',
        'Have the other person open Join a design and scan this screen. Keep it open while their camera reads the changing code.');
      if (shown) onInvitationShown();
    } catch (error) { notify(error.message || 'The live invitation is not ready to share.'); }
  }
  async function showAnswer() {
    try {
      await showTransfer(createLiveAnswerQrPayload(answerField.value.trim()), 'Show your reply',
        'Have the design owner scan this screen to finish connecting. Keep it open while their camera reads the changing code.');
    } catch (error) { notify(error.message || 'The guest answer is not ready to share.'); }
  }
  async function openScanner(target) {
    try {
      await stopActivities();
      const qrRuntime = await runtime();
      mode = target;
      assembler = createQrTransferAssembler();
      dialog.querySelector('#live-qr-title').textContent = target === 'guest' ? 'Scan the owner’s invite' : 'Scan their reply';
      dialog.querySelector('#live-qr-note').textContent = target === 'guest'
        ? 'Point your camera at the owner’s screen and keep the code in view until it is read.'
        : 'Point your camera at the other person’s screen and keep the code in view until it is read.';
      dialog.querySelector('#live-qr-display').hidden = true;
      dialog.querySelector('#live-qr-scan').hidden = false;
      dialog.querySelector('#live-qr-scan-status').textContent = 'Start your camera, or choose a saved QR image.';
      dialog.querySelector('#live-qr-start-camera').disabled = false;
      dialog.querySelector('#live-qr-start-camera').textContent = 'Use camera';
      dialog.showModal();
      scanner = qrRuntime.createLiveSharingScanner(dialog.querySelector('#live-qr-video'), value => { void acceptFrame(value); }, () => {});
    } catch (error) {
      void stopActivities();
      notify(error.message || 'The local QR scanner could not be prepared.');
    }
  }
  async function completePayload(value) {
    const payload = readLiveQrPayload(value);
    if (mode === 'guest') {
      if (payload.kind !== 'live-invitation') throw new TypeError('Scan the design owner’s invite QR code.');
      validateInvitation(payload.invitation);
      onGuestHandoff(payload);
    } else if (mode === 'host') {
      if (payload.kind !== 'live-answer') throw new TypeError('Scan the other person’s reply QR code.');
      onHostAnswer(payload.answer);
    } else {
      throw new Error('The QR scanner is no longer active.');
    }
    closeDialog();
  }
  async function acceptFrame(value) {
    if (!assembler || decodeBusy) return;
    decodeBusy = true;
    try {
      const result = await assembler.accept(value);
      if (result.status === 'different-transfer') {
        dialog.querySelector('#live-qr-scan-status').textContent = 'Another code is being read. Start over to scan a different one.';
      } else if (result.status === 'progress' || result.status === 'duplicate') {
        dialog.querySelector('#live-qr-scan-status').textContent = `Reading code · ${result.received} of ${result.total} parts`;
      } else if (result.status === 'complete') {
        await completePayload(result.value);
      }
    } catch (error) {
      dialog.querySelector('#live-qr-scan-status').textContent = error.message || 'This QR frame could not be read.';
    } finally { decodeBusy = false; }
  }
  async function startCamera() {
    if (!scanner) return;
    const button = dialog.querySelector('#live-qr-start-camera');
    button.disabled = true;
    dialog.querySelector('#live-qr-scan-status').textContent = 'Requesting camera access…';
    try {
      await scanner.start();
      button.textContent = 'Camera on';
      dialog.querySelector('#live-qr-scan-status').textContent = 'Keep the other person’s changing QR code in view.';
    } catch (error) {
      button.disabled = false;
      dialog.querySelector('#live-qr-scan-status').textContent = error?.name === 'NotAllowedError'
        ? 'Camera access is unavailable. Choose a saved QR image or use copy and paste instead.'
        : 'Camera unavailable. Choose a saved QR image or use copy and paste instead.';
    }
  }
  async function scanImage(file) {
    if (!file || !assembler) return;
    if (!file.type.startsWith('image/') || file.size > 16 * 1024 * 1024) {
      dialog.querySelector('#live-qr-scan-status').textContent = 'Choose an image file no larger than 16 MiB.';
      return;
    }
    try {
      const qrRuntime = await runtime();
      await acceptFrame(await qrRuntime.readLiveSharingQrImage(file));
    } catch (error) {
      dialog.querySelector('#live-qr-scan-status').textContent = error.message || 'No readable QR frame was found in that image.';
    } finally { dialog.querySelector('#live-qr-image-input').value = ''; }
  }
  function syncActions() {
    showInvitationButton.hidden = shareButton.hidden;
    scanAnswerButton.disabled = shareButton.hidden;
    showAnswerButton.hidden = copyAnswerButton.hidden;
  }

  showInvitationButton.addEventListener('click', () => { void showInvitation(); });
  scanAnswerButton.addEventListener('click', () => { void openScanner('host'); });
  scanInvitationButton.addEventListener('click', () => { void openScanner('guest'); });
  showAnswerButton.addEventListener('click', () => { void showAnswer(); });
  dialog.querySelector('#live-qr-start-camera').addEventListener('click', () => { void startCamera(); });
  dialog.querySelector('#live-qr-reset-scan').addEventListener('click', () => {
    assembler?.reset();
    dialog.querySelector('#live-qr-scan-status').textContent = 'Ready. Scan a QR code again.';
  });
  dialog.querySelector('#live-qr-image-input').addEventListener('change', event => { void scanImage(event.currentTarget.files?.[0]); });
  for (const [id, direction] of [['live-qr-previous', -1], ['live-qr-next', 1]]) {
    dialog.querySelector(`#${id}`).addEventListener('click', () => {
      if (!playback?.frames.length) return;
      if (playback.timer) clearTimeout(playback.timer);
      frameIndex = (frameIndex + direction + playback.frames.length) % playback.frames.length;
      void drawFrame();
    });
  }
  dialog.querySelector('#live-qr-close').addEventListener('click', closeDialog);
  dialog.querySelector('#live-qr-close-action').addEventListener('click', closeDialog);
  dialog.addEventListener('close', () => { void stopActivities(); });
  const actionsObserver = new MutationObserver(syncActions);
  actionsObserver.observe(shareButton, { attributes: true, attributeFilter: ['hidden'] });
  actionsObserver.observe(copyAnswerButton, { attributes: true, attributeFilter: ['hidden'] });
  syncActions();
}
