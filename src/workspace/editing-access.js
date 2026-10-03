/** Derive which editor surfaces may be used while local storage is recovering. */
export function workspaceEditingAccess({ blocked = false, onboarding = false, permissionNeeded = false } = {}) {
  const hasRecoveryPath = Boolean(permissionNeeded);
  return {
    topbarInert: Boolean(onboarding || (blocked && !hasRecoveryPath)),
    workspaceInert: Boolean(blocked || onboarding || permissionNeeded)
  };
}
