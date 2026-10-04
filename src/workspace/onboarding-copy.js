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

/** Explain why a received live invite is waiting behind first-run storage setup. */
export function workspaceInvitationSetupMessage({ folderPickerAvailable = false, hasFullInvitation = true } = {}) {
  if (!hasFullInvitation) {
    return 'This design link does not start a live session by itself. Ask the owner for a live invite link.';
  }
  return folderPickerAvailable
    ? 'Design invite received. Choose a folder to save your local copy; Tiny Image Star will open the invite when setup finishes.'
    : 'Design invite received. This browser cannot choose the folder needed to join; open the link in a browser that can choose a folder.';
}

/** Require a storage choice only when there is no usable local design or folder workspace yet. */
export function shouldRequireWorkspaceOnboarding({
  folderReopened = false,
  workspaceActive = false,
  permissionNeeded = false,
  restoredSavedDesign = false,
} = {}) {
  return !folderReopened && !workspaceActive && !permissionNeeded && !restoredSavedDesign;
}
