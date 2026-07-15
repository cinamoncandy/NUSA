import { createHash } from "node:crypto";
import { DecisionBallot, DecisionGate, DecisionResult } from "./decision";
import { CreateDecisionRecordInput, DecisionRecord, createDecisionRecord } from "./decisionRecord";

export interface DecisionAuditEnvelope {
  readonly schemaVersion: "decision-audit-v1";
  readonly record: DecisionRecord;
  readonly ballots: readonly DecisionBallot[];
  readonly gates: readonly DecisionGate[];
  readonly respondingMembers: number;
  readonly countedMembers: number;
  readonly agreementCount: number;
  readonly agreementRatio: number;
  readonly envelopeChecksum: string;
}

export interface CreateDecisionAuditEnvelopeInput extends Omit<CreateDecisionRecordInput, "result"> {
  readonly result: DecisionResult;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(",")}}`;
}

export function decisionAuditChecksum(value: Omit<DecisionAuditEnvelope, "envelopeChecksum">): string {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

export function createDecisionAuditEnvelope(input: CreateDecisionAuditEnvelopeInput): DecisionAuditEnvelope {
  const record = createDecisionRecord(input);
  const payload = Object.freeze({
    schemaVersion: "decision-audit-v1" as const,
    record,
    ballots: Object.freeze([...input.result.ballots]),
    gates: Object.freeze([...input.result.gates]),
    respondingMembers: input.result.respondingMembers,
    countedMembers: input.result.countedMembers,
    agreementCount: input.result.agreementCount,
    agreementRatio: input.result.agreementRatio
  });
  return Object.freeze({ ...payload, envelopeChecksum: decisionAuditChecksum(payload) });
}

export function verifyDecisionAuditEnvelope(envelope: DecisionAuditEnvelope): boolean {
  const { envelopeChecksum, ...payload } = envelope;
  if (!/^[a-f0-9]{64}$/.test(envelopeChecksum)) return false;
  if (envelope.record.policyId.trim() === "" || envelope.record.policyVersion.trim() === "") return false;
  return decisionAuditChecksum(payload) === envelopeChecksum;
}
