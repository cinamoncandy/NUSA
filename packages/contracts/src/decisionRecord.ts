import { DecisionAction, DecisionResult, DecisionState } from "./decision";

export enum DecisionRecordState {
  COLLECTING = "COLLECTING",
  ANALYZING = "ANALYZING",
  NO_QUORUM = "NO_QUORUM",
  ABSTAIN = "ABSTAIN",
  DISAGREEMENT = "DISAGREEMENT",
  BLOCKED = "BLOCKED",
  APPROVED_PAPER_ACTION = "APPROVED_PAPER_ACTION",
  EXECUTING_PAPER = "EXECUTING_PAPER",
  RECORDED = "RECORDED"
}

export interface DecisionRecord {
  readonly decisionId: string;
  readonly market: string;
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly state: DecisionRecordState;
  readonly action: DecisionAction;
  readonly reasons: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly codeVersion: string;
  readonly paperOrderIds: readonly string[];
  readonly paperFillIds: readonly string[];
}

export interface CreateDecisionRecordInput {
  readonly decisionId: string;
  readonly market: string;
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly createdAt: string;
  readonly codeVersion: string;
  readonly result: DecisionResult;
}

const terminalStates = new Set<DecisionRecordState>([
  DecisionRecordState.NO_QUORUM,
  DecisionRecordState.ABSTAIN,
  DecisionRecordState.DISAGREEMENT,
  DecisionRecordState.BLOCKED,
  DecisionRecordState.RECORDED
]);

const transitions: Readonly<Record<DecisionRecordState, readonly DecisionRecordState[]>> = Object.freeze({
  [DecisionRecordState.COLLECTING]: Object.freeze([DecisionRecordState.ANALYZING, DecisionRecordState.BLOCKED]),
  [DecisionRecordState.ANALYZING]: Object.freeze([
    DecisionRecordState.NO_QUORUM,
    DecisionRecordState.ABSTAIN,
    DecisionRecordState.DISAGREEMENT,
    DecisionRecordState.BLOCKED,
    DecisionRecordState.APPROVED_PAPER_ACTION
  ]),
  [DecisionRecordState.NO_QUORUM]: Object.freeze([]),
  [DecisionRecordState.ABSTAIN]: Object.freeze([]),
  [DecisionRecordState.DISAGREEMENT]: Object.freeze([]),
  [DecisionRecordState.BLOCKED]: Object.freeze([]),
  [DecisionRecordState.APPROVED_PAPER_ACTION]: Object.freeze([DecisionRecordState.EXECUTING_PAPER, DecisionRecordState.BLOCKED]),
  [DecisionRecordState.EXECUTING_PAPER]: Object.freeze([DecisionRecordState.RECORDED, DecisionRecordState.BLOCKED]),
  [DecisionRecordState.RECORDED]: Object.freeze([])
});

function requireText(value: string, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is required`);
  return value;
}

function recordStateFromResult(state: DecisionState): DecisionRecordState {
  switch (state) {
    case DecisionState.NO_QUORUM: return DecisionRecordState.NO_QUORUM;
    case DecisionState.ABSTAIN: return DecisionRecordState.ABSTAIN;
    case DecisionState.DISAGREEMENT: return DecisionRecordState.DISAGREEMENT;
    case DecisionState.BLOCKED: return DecisionRecordState.BLOCKED;
    case DecisionState.APPROVED_PAPER_ACTION: return DecisionRecordState.APPROVED_PAPER_ACTION;
    case DecisionState.COLLECTING: return DecisionRecordState.COLLECTING;
    case DecisionState.ANALYZING: return DecisionRecordState.ANALYZING;
  }
}

function freezeRecord(record: DecisionRecord): DecisionRecord {
  return Object.freeze({
    ...record,
    reasons: Object.freeze([...record.reasons]),
    paperOrderIds: Object.freeze([...record.paperOrderIds]),
    paperFillIds: Object.freeze([...record.paperFillIds])
  });
}

export function createDecisionRecord(input: CreateDecisionRecordInput): DecisionRecord {
  const state = recordStateFromResult(input.result.state);
  const action = state === DecisionRecordState.APPROVED_PAPER_ACTION ? input.result.action : input.result.action;
  return freezeRecord({
    decisionId: requireText(input.decisionId, "decisionId"),
    market: requireText(input.market, "market"),
    snapshotId: requireText(input.snapshotId, "snapshotId"),
    snapshotChecksum: requireText(input.snapshotChecksum, "snapshotChecksum"),
    policyId: requireText(input.result.policyId, "policyId"),
    policyVersion: requireText(input.result.policyVersion, "policyVersion"),
    state,
    action,
    reasons: input.result.reasons,
    createdAt: requireText(input.createdAt, "createdAt"),
    updatedAt: input.createdAt,
    codeVersion: requireText(input.codeVersion, "codeVersion"),
    paperOrderIds: [],
    paperFillIds: []
  });
}

export function canTransitionDecisionRecord(from: DecisionRecordState, to: DecisionRecordState): boolean {
  return transitions[from].includes(to);
}

export function transitionDecisionRecord(
  record: DecisionRecord,
  nextState: DecisionRecordState,
  updatedAt: string,
  links: { readonly paperOrderId?: string; readonly paperFillId?: string } = {}
): DecisionRecord {
  if (!canTransitionDecisionRecord(record.state, nextState)) {
    throw new Error(`invalid decision transition ${record.state} -> ${nextState}`);
  }
  if (nextState === DecisionRecordState.EXECUTING_PAPER && record.state !== DecisionRecordState.APPROVED_PAPER_ACTION) {
    throw new Error("Paper execution requires an approved decision");
  }
  const paperOrderIds = links.paperOrderId && !record.paperOrderIds.includes(links.paperOrderId)
    ? [...record.paperOrderIds, requireText(links.paperOrderId, "paperOrderId")]
    : [...record.paperOrderIds];
  const paperFillIds = links.paperFillId && !record.paperFillIds.includes(links.paperFillId)
    ? [...record.paperFillIds, requireText(links.paperFillId, "paperFillId")]
    : [...record.paperFillIds];
  return freezeRecord({
    ...record,
    state: nextState,
    updatedAt: requireText(updatedAt, "updatedAt"),
    paperOrderIds,
    paperFillIds
  });
}

export function isTerminalDecisionRecord(record: DecisionRecord): boolean {
  return terminalStates.has(record.state);
}
