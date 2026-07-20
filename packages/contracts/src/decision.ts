export enum DecisionAction {
  LONG = "LONG",
  SHORT = "SHORT",
  EXIT = "EXIT",
  HOLD = "HOLD",
  ABSTAIN = "ABSTAIN"
}

export enum DecisionState {
  COLLECTING = "COLLECTING",
  ANALYZING = "ANALYZING",
  NO_QUORUM = "NO_QUORUM",
  ABSTAIN = "ABSTAIN",
  DISAGREEMENT = "DISAGREEMENT",
  BLOCKED = "BLOCKED",
  APPROVED_PAPER_ACTION = "APPROVED_PAPER_ACTION"
}

export interface DecisionBallot {
  readonly memberId: string;
  readonly memberVersion: string;
  readonly family: string;
  readonly action: DecisionAction;
  readonly support: number;
  readonly evidenceRefs: readonly string[];
  readonly evaluatedAt: string;
  readonly stale?: boolean;
  readonly failed?: boolean;
}

export interface DecisionGate {
  readonly gateId: string;
  readonly passed: boolean;
  readonly reason?: string;
}

export interface DecisionPolicy {
  readonly policyId: string;
  readonly policyVersion: string;
  readonly eligibleMembers: number;
  readonly minimumQuorum: number;
  readonly minimumAgreementRatio: number;
  readonly maximumFamilyVotes?: number;
}

export interface DecisionResult {
  readonly state: DecisionState;
  readonly action: DecisionAction;
  readonly respondingMembers: number;
  readonly countedMembers: number;
  readonly agreementCount: number;
  readonly agreementRatio: number;
  readonly reasons: readonly string[];
  readonly ballots: readonly DecisionBallot[];
  readonly gates: readonly DecisionGate[];
  readonly policyId: string;
  readonly policyVersion: string;
}

function requireText(value: string, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is required`);
  return value;
}

function requireInteger(value: number, name: string, minimum: number): number {
  if (!Number.isInteger(value) || value < minimum) throw new Error(`${name} must be an integer >= ${minimum}`);
  return value;
}

function requireRatio(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be between 0 and 1`);
  return value;
}

export function validateDecisionPolicy(policy: DecisionPolicy): DecisionPolicy {
  requireText(policy.policyId, "policyId");
  requireText(policy.policyVersion, "policyVersion");
  requireInteger(policy.eligibleMembers, "eligibleMembers", 1);
  requireInteger(policy.minimumQuorum, "minimumQuorum", 1);
  if (policy.minimumQuorum > policy.eligibleMembers) throw new Error("minimumQuorum cannot exceed eligibleMembers");
  requireRatio(policy.minimumAgreementRatio, "minimumAgreementRatio");
  if (policy.maximumFamilyVotes != null) requireInteger(policy.maximumFamilyVotes, "maximumFamilyVotes", 1);
  return Object.freeze({ ...policy });
}

export function validateDecisionBallot(ballot: DecisionBallot): DecisionBallot {
  requireText(ballot.memberId, "memberId");
  requireText(ballot.memberVersion, "memberVersion");
  requireText(ballot.family, "family");
  requireText(ballot.evaluatedAt, "evaluatedAt");
  requireRatio(ballot.support, "support");
  return Object.freeze({ ...ballot, evidenceRefs: Object.freeze([...ballot.evidenceRefs]) });
}

function capCorrelatedFamilies(ballots: readonly DecisionBallot[], maximumFamilyVotes?: number): DecisionBallot[] {
  if (maximumFamilyVotes == null) return [...ballots];
  const familyCounts = new Map<string, number>();
  return ballots.filter((ballot) => {
    const count = familyCounts.get(ballot.family) ?? 0;
    if (count >= maximumFamilyVotes) return false;
    familyCounts.set(ballot.family, count + 1);
    return true;
  });
}

export function evaluateDecision(
  policyInput: DecisionPolicy,
  ballotInputs: readonly DecisionBallot[],
  gateInputs: readonly DecisionGate[] = []
): DecisionResult {
  const policy = validateDecisionPolicy(policyInput);
  const ballots = ballotInputs.map(validateDecisionBallot);
  const gates = gateInputs.map((gate) => Object.freeze({
    gateId: requireText(gate.gateId, "gateId"),
    passed: gate.passed,
    reason: gate.reason
  }));
  const reasons: string[] = [];
  const responding = ballots.filter((ballot) => !ballot.failed && !ballot.stale);

  if (responding.length < policy.minimumQuorum) {
    reasons.push(`quorum ${responding.length}/${policy.minimumQuorum}`);
    return freezeResult(DecisionState.NO_QUORUM, DecisionAction.ABSTAIN, responding.length, 0, 0, 0, reasons, ballots, gates, policy);
  }

  const failedGate = gates.find((gate) => !gate.passed);
  if (failedGate) {
    reasons.push(failedGate.reason || `${failedGate.gateId} blocked`);
    return freezeResult(DecisionState.BLOCKED, DecisionAction.ABSTAIN, responding.length, 0, 0, 0, reasons, ballots, gates, policy);
  }

  const counted = capCorrelatedFamilies(responding, policy.maximumFamilyVotes);
  const directional = counted.filter((ballot) => ballot.action !== DecisionAction.ABSTAIN);
  if (directional.length === 0) {
    reasons.push("all eligible members abstained");
    return freezeResult(DecisionState.ABSTAIN, DecisionAction.ABSTAIN, responding.length, counted.length, 0, 0, reasons, ballots, gates, policy);
  }

  const actionCounts = new Map<DecisionAction, number>();
  for (const ballot of directional) actionCounts.set(ballot.action, (actionCounts.get(ballot.action) ?? 0) + 1);
  const ranked = [...actionCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const [winningAction, agreementCount] = ranked[0];
  const agreementRatio = agreementCount / directional.length;

  if (agreementRatio < policy.minimumAgreementRatio) {
    reasons.push(`agreement ${agreementRatio.toFixed(4)} below ${policy.minimumAgreementRatio.toFixed(4)}`);
    return freezeResult(DecisionState.DISAGREEMENT, DecisionAction.ABSTAIN, responding.length, counted.length, agreementCount, agreementRatio, reasons, ballots, gates, policy);
  }

  if (winningAction === DecisionAction.HOLD) {
    reasons.push("committee selected hold");
    return freezeResult(DecisionState.ABSTAIN, DecisionAction.HOLD, responding.length, counted.length, agreementCount, agreementRatio, reasons, ballots, gates, policy);
  }

  reasons.push(`approved ${winningAction} with ${agreementCount}/${directional.length}`);
  return freezeResult(DecisionState.APPROVED_PAPER_ACTION, winningAction, responding.length, counted.length, agreementCount, agreementRatio, reasons, ballots, gates, policy);
}

function freezeResult(
  state: DecisionState,
  action: DecisionAction,
  respondingMembers: number,
  countedMembers: number,
  agreementCount: number,
  agreementRatio: number,
  reasons: string[],
  ballots: DecisionBallot[],
  gates: readonly DecisionGate[],
  policy: DecisionPolicy
): DecisionResult {
  return Object.freeze({
    state,
    action,
    respondingMembers,
    countedMembers,
    agreementCount,
    agreementRatio,
    reasons: Object.freeze([...reasons]),
    ballots: Object.freeze([...ballots]),
    gates: Object.freeze([...gates]),
    policyId: policy.policyId,
    policyVersion: policy.policyVersion
  });
}
