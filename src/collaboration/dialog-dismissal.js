const modelessBackdrops = new WeakMap();

function dialogIsOpen(dialog) {
  if (!dialog) return false;
  // In native dialogs `open` reflects this attribute. Some embedded WebViews
  // keep the property stale when close() is unavailable, so prefer the DOM
  // attribute when it can be queried.
  if (typeof dialog.hasAttribute === 'function') return dialog.hasAttribute('open');
  if (typeof dialog.open === 'boolean') return dialog.open;
  return typeof dialog.getAttribute === 'function' && dialog.getAttribute('open') !== null;
}

function createModelessBackdrop(dialog) {
  if (modelessBackdrops.has(dialog)) return;
  const parent = dialog.parentNode;
  const document = dialog.ownerDocument;
  if (!parent || typeof parent.insertBefore !== 'function' || typeof document?.createElement !== 'function') return;
  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-modeless-fallback-backdrop';
  backdrop.setAttribute('aria-hidden', 'true');
  backdrop.addEventListener('click', () => closeDialog(dialog, 'close'));
  parent.insertBefore(backdrop, dialog);
  modelessBackdrops.set(dialog, backdrop);
}

function removeModelessBackdrop(dialog) {
  const backdrop = modelessBackdrops.get(dialog);
  if (!backdrop) return;
  backdrop.remove?.();
  modelessBackdrops.delete(dialog);
}

export function openDialog(dialog) {
  if (!dialog || dialogIsOpen(dialog)) return Boolean(dialog);
  if (typeof dialog.showModal === 'function') {
    try {
      dialog.showModal();
      if (dialogIsOpen(dialog)) {
        dialog.removeAttribute?.('data-dialog-modeless-fallback');
        removeModelessBackdrop(dialog);
        return true;
      }
    } catch { /* Fall back to the reflected open attribute in embedded browsers. */ }
  }
  // A plain `open` attribute creates a modeless dialog. Give that fallback
  // viewport positioning and a top stacking order so fixed editor controls
  // cannot sit over the visible panel and steal taps from its close buttons.
  dialog.setAttribute('data-dialog-modeless-fallback', '');
  createModelessBackdrop(dialog);
  dialog.setAttribute('open', '');
  return dialogIsOpen(dialog);
}

export function closeDialog(dialog, returnValue = 'dismiss') {
  if (!dialogIsOpen(dialog)) {
    dialog?.removeAttribute?.('data-dialog-modeless-fallback');
    if (dialog) removeModelessBackdrop(dialog);
    return false;
  }
  let closedNatively = false;
  if (typeof dialog.close === 'function') {
    try { dialog.close(returnValue); }
    catch { /* Older embedded browsers can expose close() without supporting it for this dialog. */ }
    closedNatively = !dialogIsOpen(dialog);
  }
  if (dialogIsOpen(dialog)) {
    dialog.returnValue = returnValue;
    if (typeof dialog.removeAttribute === 'function') dialog.removeAttribute('open');
    else if ('open' in dialog) dialog.open = false;
    else if ('hidden' in dialog) dialog.hidden = true;
  }
  dialog.removeAttribute?.('data-dialog-modeless-fallback');
  removeModelessBackdrop(dialog);
  if (closedNatively) return true;
  if (!dialogIsOpen(dialog)) {
    const EventConstructor = dialog.ownerDocument?.defaultView?.Event || globalThis.Event;
    if (typeof EventConstructor === 'function') dialog.dispatchEvent(new EventConstructor('close'));
  }
  return !dialogIsOpen(dialog);
}

export function bindDialogDismissal(dialog, closeControls, { onDismiss = null } = {}) {
  const providedControls = typeof closeControls?.addEventListener === 'function'
    ? [closeControls]
    : Array.from(closeControls || []);
  const dismissButtons = Array.from(dialog?.querySelectorAll?.('[data-dialog-dismiss]') || []);
  const controls = [...new Set([...providedControls, ...dismissButtons])];
  const close = event => {
    if (!closeDialog(dialog)) return;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    onDismiss?.(event);
  };
  const pointerDismissHandlers = controls.map(control => {
    let pressedPointerId = null;
    const onPointerDown = event => {
      if (!Number.isSafeInteger(event.pointerId) || event.isPrimary === false
        || (typeof event.button === 'number' && event.button !== 0)) return;
      pressedPointerId = event.pointerId;
    };
    const onPointerUp = event => {
      if (pressedPointerId === null || event.pointerId !== pressedPointerId) return;
      pressedPointerId = null;
      // A few embedded browsers deliver a touch pointer release but omit the
      // synthesized click. Dismiss on a completed press/release of the same
      // close control as a fallback; a press alone never closes the panel.
      close(event);
    };
    const onPointerCancel = event => {
      if (event.pointerId === pressedPointerId) pressedPointerId = null;
    };
    control.addEventListener('pointerdown', onPointerDown);
    control.addEventListener('pointerup', onPointerUp);
    control.addEventListener('pointercancel', onPointerCancel);
    return () => {
      control.removeEventListener('pointerdown', onPointerDown);
      control.removeEventListener('pointerup', onPointerUp);
      control.removeEventListener('pointercancel', onPointerCancel);
    };
  });
  const dismissOnControlClick = event => {
    const control = event.target?.closest?.('[data-dialog-dismiss]');
    if (!control || (typeof dialog.contains === 'function' && !dialog.contains(control))) return;
    close(event);
  };
  const dismissOnDialogSubmit = event => {
    const form = event.target;
    if (!form?.matches?.('form[method="dialog"]')) return;
    close(event);
  };
  const dismissOnBackdrop = event => {
    if (event.target === dialog) close();
  };
  const dismissOnEscape = event => {
    event.preventDefault();
    close();
  };
  const dismissOnEscapeKey = event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  for (const control of controls) control.addEventListener('click', close);
  dialog.addEventListener('click', dismissOnBackdrop);
  // Capture the explicit close action before button, form, or app-level click
  // handlers can suppress it. This works the same in browsers and embedded views.
  dialog.addEventListener('click', dismissOnControlClick, true);
  // Some embedded browsers dispatch the dialog form's submit but do not honor
  // method="dialog". Keep the submit path as a fallback for both close buttons.
  dialog.addEventListener('submit', dismissOnDialogSubmit, true);
  dialog.addEventListener('cancel', dismissOnEscape);
  dialog.addEventListener('keydown', dismissOnEscapeKey);

  return () => {
    for (const control of controls) control.removeEventListener('click', close);
    for (const removePointerHandlers of pointerDismissHandlers) removePointerHandlers();
    dialog.removeEventListener('click', dismissOnBackdrop);
    dialog.removeEventListener('click', dismissOnControlClick, true);
    dialog.removeEventListener('submit', dismissOnDialogSubmit, true);
    dialog.removeEventListener('cancel', dismissOnEscape);
    dialog.removeEventListener('keydown', dismissOnEscapeKey);
  };
}
