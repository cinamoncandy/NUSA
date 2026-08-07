export type LiveGovernanceState = "DISABLED" | "ARMED" | "AUTHORIZED" | "ACTIVE" | "COOLDOWN" | "HALT";

export interface LiveGovernancePolicy {
  readonly realMoneyExecutionAllowed: boolean;
  readonly executionTransportConnected: boolean;
  readonly executionCredentialUseAllowed: boolean;
  readonly operationalState: "SAFE" | "DEGRADED" | "RESTRICTED" | "HALT" | "UNKNOWN";
  readonly hardRiskPass: boolean;
  readonly killSwitchInactive: boolean;
}

export interface HumanAuthorization {
  readonly authorizationId: string;
  readonly approvedBy: readonly [string, string];
  readonly scope: Readonly<Record<string, string | number | boolean>>;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly singleUse: true;
  readonly consumed: boolean;
}

const states = <T extends readonly LiveGovernanceState[]>(...values: T): T => values;

const transitions: Readonly<Record<LiveGovernanceState, readonly LiveGovernanceState[]>> = Object.freeze({
  DISABLED: states("ARMED"),
  ARMED: states("AUTHORIZED", "DISABLED", "HALT"),
  AUTHORIZED: states("ACTIVE", "COOLDOWN", "DISABLED", "HALT"),
  ACTIVE: states("COOLDOWN", "HALT"),
  COOLDOWN: states("DISABLED", "HALT"),
  HALT: states("DISABLED"),
});

export function allowedLiveGovernanceTransitions(): Readonly<Record<LiveGovernanceState, readonly LiveGovernanceState[]>> {
  return transitions;
}

function validIso(value: string): boolean { return !Number.isNaN(Date.parse(value)); }

export function validateHumanAuthorization(auth: HumanAuthorization | null, nowIso: string): boolean {
  if (!auth || !validIso(nowIso) || !validIso(auth.issuedAt) || !validIso(auth.expiresAt)) return false;
  if (!auth.authorizationId.trim() || auth.approvedBy.length !== 2 || auth.approvedBy[0] === auth.approvedBy[1]) return false;
  if (!auth.approvedBy.every((value) => value.trim().length > 0)) return false;
  if (auth.singleUse !== true || auth.consumed) return false;
  const now = Date.parse(nowIso); const issued = Date.parse(auth.issuedAt); const expires = Date.parse(auth.expiresAt);
  if (issued > now || expires <= now || expires <= issued) return false;
  const serializedScope = JSON.stringify(auth.scope).toLowerCase();
  if (/credential|secret|token|authorization.?header|private.?key/.test(serializedScope)) return false;
  return true;
}

export function canEnterActive(policy: LiveGovernancePolicy, auth: HumanAuthorization | null, nowIso: string): boolean {
  return policy.realMoneyExecutionAllowed === true
    && policy.executionTransportConnected === true
    && policy.executionCredentialUseAllowed === true
    && policy.operationalState === "SAFE"
    && policy.hardRiskPass === true
    && policy.killSwitchInactive === true
    && validateHumanAuthorization(auth, nowIso);
}

export function assertLiveGovernanceTransition(
  from: LiveGovernanceState,
  to: LiveGovernanceState,
  policy: LiveGovernancePolicy,
  auth: HumanAuthorization | null,
  nowIso: string,
): void {
  if (!transitions[from] || !transitions[to]) throw new Error("LIVE_STATE_UNKNOWN_FAIL_CLOSED");
  if (!transitions[from].includes(to)) throw new Error(`LIVE_STATE_TRANSITION_REJECTED:${from}->${to}`);
  if (to === "AUTHORIZED" && !validateHumanAuthorization(auth, nowIso)) throw new Error("LIVE_AUTHORIZATION_INVALID_FAIL_CLOSED");
  if (to === "ACTIVE" && !canEnterActive(policy, auth, nowIso)) throw new Error("LIVE_ACTIVE_PROHIBITED_FAIL_CLOSED");
}

export function failClosedState(input: unknown): LiveGovernanceState {
  return typeof input === "string" && Object.prototype.hasOwnProperty.call(transitions, input) ? input as LiveGovernanceState : "HALT";
}
