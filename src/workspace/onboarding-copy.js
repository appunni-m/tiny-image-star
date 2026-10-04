/** Return onboarding copy for the storage choices this browser can actually use. */
export function workspaceOnboardingCopy({ folderPickerAvailable = false } = {}) {
  if (folderPickerAvailable) {
    return {
      description: 'Choose a folder to save your designs as local files. A folder is required for live sharing; browser storage is for editing on this device.',
      status: 'Existing browser designs are copied and checked before editing. You can choose browser storage for solo editing and add a folder later.'
    };
  }
  return {
    description: 'This browser can keep designs in its local profile for editing on this device. Live sharing needs a writable folder, which this browser cannot select.',
    status: 'Continue with browser storage for solo editing. Your designs stay in this browser profile; export a local design file from File for backup or transfer.'
  };
}
