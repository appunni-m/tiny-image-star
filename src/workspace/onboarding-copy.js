/** Return onboarding copy for the storage choices this browser can actually use. */
export function workspaceOnboardingCopy({ folderPickerAvailable = false } = {}) {
  if (folderPickerAvailable) {
    return {
      description: 'Choose a folder to keep your designs as local files. Existing browser designs are copied and verified before editing.',
      status: 'Choose a folder to create or reconnect your workspace. If folder setup is unavailable here, you can continue with browser storage instead.'
    };
  }
  return {
    description: 'This browser can keep your designs in its local profile. Export a local design file from the File menu for backup or transfer.',
    status: 'This browser cannot choose a writable folder. You can continue with browser-profile storage; your designs will stay in this browser profile.'
  };
}
