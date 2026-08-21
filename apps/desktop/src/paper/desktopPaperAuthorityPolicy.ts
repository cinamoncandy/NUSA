let cloudCanonicalAuthorityActive = false;

export function activateCloudCanonicalDesktopAuthority(): void {
  cloudCanonicalAuthorityActive = true;
}

export function isCloudCanonicalDesktopAuthorityActive(): boolean {
  return cloudCanonicalAuthorityActive;
}

export function assertLocalSimulationPaperOrderAllowed(): void {
  if (cloudCanonicalAuthorityActive) {
    throw new Error("Local Paper order mutation is disabled while Cloud canonical PAPER authority is active.");
  }
}
