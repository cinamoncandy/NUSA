export type PaperAccessState =
  | "PUBLIC_OBSERVATION"
  | "DEVICE_APPROVAL_REQUIRED"
  | "SECURE_SESSION"
  | "BLOCKED";

export interface PaperAccessSnapshot {
  readonly state: PaperAccessState;
  readonly deviceSessionVerified: boolean;
  readonly publicObservationAllowed: true;
  readonly paperMutationAllowed: boolean;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

export function resolvePaperAccess(input: Readonly<{
  deviceSessionVerified: boolean;
  sessionBlocked?: boolean;
}>): PaperAccessSnapshot {
  const blocked = input.sessionBlocked === true;
  const verified = input.deviceSessionVerified && !blocked;

  return Object.freeze({
    state: blocked ? "BLOCKED" : verified ? "SECURE_SESSION" : "DEVICE_APPROVAL_REQUIRED",
    deviceSessionVerified: verified,
    publicObservationAllowed: true,
    paperMutationAllowed: verified,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}
