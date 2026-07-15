import { createHash } from "node:crypto";
import { DecisionAction } from "./decision";
import { DecisionAuditEnvelope, verifyDecisionAuditEnvelope } from "./decisionAudit";
import { DecisionRecordState } from "./decisionRecord";

export enum DecisionExecutionMode {
  PAPER = "PAPER"
}

export interface DecisionExecutionAuthorization {
  readonly authorizationId: string;
  readonly decisionId: string;
  readonly auditChecksum: string;
  readonly mode: DecisionExecutionMode.PAPER;
  readonly market: string;
  readonly action: DecisionAction.LONG | DecisionAction.SHORT | DecisionAction.EXIT;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly codeVersion: string;
  readonly nonce: string;
  readonly checksum: string;
}

export interface IssueDecisionAuthorizationInput {
  readonly authorizationId: string;
  readonly envelope: DecisionAuditEnvelope;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
}

function requireText(value: string, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is required`);
  return value;
}

function canonicalAuthorization(value: Omit<DecisionExecutionAuthorization, "checksum">): string {
  return JSON.stringify({
    action: value.action,
    auditChecksum: value.auditChecksum,
    authorizationId: value.authorizationId,
    codeVersion: value.codeVersion,
    decisionId: value.decisionId,
    expiresAt: value.expiresAt,
    issuedAt: value.issuedAt,
    market: value.market,
    mode: value.mode,
    nonce: value.nonce,
    policyId: value.policyId,
    policyVersion: value.policyVersion
  });
}

function checksumAuthorization(value: Omit<DecisionExecutionAuthorization, "checksum">): string {
  return createHash("sha256").update(canonicalAuthorization(value)).digest("hex");
}

function isExecutableAction(action: DecisionAction): action is DecisionAction.LONG | DecisionAction.SHORT | DecisionAction.EXIT {
  return action === DecisionAction.LONG || action === DecisionAction.SHORT || action === DecisionAction.EXIT;
}

export function issueDecisionExecutionAuthorization(input: IssueDecisionAuthorizationInput): DecisionExecutionAuthorization {
  if (!verifyDecisionAuditEnvelope(input.envelope)) throw new Error("decision audit envelope is invalid");
  const record = input.envelope.record;
  if (record.state !== DecisionRecordState.APPROVED_PAPER_ACTION) throw new Error("decision is not approved for Paper execution");
  if (!isExecutableAction(record.action)) throw new Error("decision action is not executable");

  const issuedAt = requireText(input.issuedAt, "issuedAt");
  const expiresAt = requireText(input.expiresAt, "expiresAt");
  const issuedMs = Date.parse(issuedAt);
  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(issuedMs) || !Number.isFinite(expiresMs) || expiresMs <= issuedMs) {
    throw new Error("expiresAt must be after issuedAt");
  }

  const unsigned = Object.freeze({
    authorizationId: requireText(input.authorizationId, "authorizationId"),
    decisionId: record.decisionId,
    auditChecksum: input.envelope.checksum,
    mode: DecisionExecutionMode.PAPER,
    market: record.market,
    action: record.action,
    issuedAt,
    expiresAt,
    policyId: record.policyId,
    policyVersion: record.policyVersion,
    codeVersion: record.codeVersion,
    nonce: requireText(input.nonce, "nonce")
  });

  return Object.freeze({ ...unsigned, checksum: checksumAuthorization(unsigned) });
}

export function verifyDecisionExecutionAuthorization(
  authorization: DecisionExecutionAuthorization,
  envelope: DecisionAuditEnvelope,
  now: string
): boolean {
  if (!verifyDecisionAuditEnvelope(envelope)) return false;
  if (authorization.mode !== DecisionExecutionMode.PAPER) return false;
  if (authorization.decisionId !== envelope.record.decisionId) return false;
  if (authorization.auditChecksum !== envelope.checksum) return false;
  if (authorization.market !== envelope.record.market) return false;
  if (authorization.action !== envelope.record.action) return false;
  if (authorization.policyId !== envelope.record.policyId || authorization.policyVersion !== envelope.record.policyVersion) return false;
  if (authorization.codeVersion !== envelope.record.codeVersion) return false;
  if (authorization.checksum !== checksumAuthorization(authorization)) return false;
  const nowMs = Date.parse(now);
  const issuedMs = Date.parse(authorization.issuedAt);
  const expiresMs = Date.parse(authorization.expiresAt);
  return Number.isFinite(nowMs) && Number.isFinite(issuedMs) && Number.isFinite(expiresMs) && nowMs >= issuedMs && nowMs < expiresMs;
}
