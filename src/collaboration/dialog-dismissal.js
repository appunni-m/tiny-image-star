function dialogIsOpen(dialog) {
  if (!dialog) return false;
  // In native dialogs `open` reflects this attribute. Some embedded WebViews
  // keep the property stale when close() is unavailable, so prefer the DOM
  // attribute when it can be queried.
  if (typeof dialog.hasAttribute === 'function') return dialog.hasAttribute('open');
  if (typeof dialog.open === 'boolean') return dialog.open;
  return typeof dialog.getAttribute === 'function' && dialog.getAttribute('open') !== null;
}

export function openDialog(dialog) {
  if (!dialog || dialogIsOpen(dialog)) return Boolean(dialog);
  if (typeof dialog.showModal === 'function') {
    try {
      dialog.showModal();
      if (dialogIsOpen(dialog)) return true;
    } catch { /* Fall back to the reflected open attribute in embedded browsers. */ }
  }
  dialog.setAttribute('open', '');
  return dialogIsOpen(dialog);
}

export function closeDialog(dialog, returnValue = 'dismiss') {
  if (!dialogIsOpen(dialog)) return false;
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
    dialog.removeEventListener('click', dismissOnBackdrop);
    dialog.removeEventListener('click', dismissOnControlClick, true);
    dialog.removeEventListener('submit', dismissOnDialogSubmit, true);
    dialog.removeEventListener('cancel', dismissOnEscape);
    dialog.removeEventListener('keydown', dismissOnEscapeKey);
  };
}
