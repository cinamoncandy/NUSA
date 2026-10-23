import { createHash } from "node:crypto";
import { canonicalResearchJson } from "../../../packages/contracts/src/researchRuntime";
import { createEvolutionLearningRecord, type EvolutionLearningRecord } from "../../autopilot/src/evolveLearningMemory";
import type { SqliteEvolutionLearningLedger } from "../../../packages/storage/src/evolutionLearningLedger";
import {
  assertSupersessionLink,
  buildSupersessionLink,
  SUPERSESSION_POLICY_VERSION,
  SupersessionError,
  SupersessionRegistry,
  type SupersessionLink,
  type SupersessionLinkInput,
} from "./supersession";

const RECORD_KIND = "LEARNING_SUPERSESSION";
const PROBLEM = "NUSA learning supersession: immutable decision lineage link";
const ID_PREFIX = "learning-supersession-v1:";

type EvolutionLedgerPort = Pick<SqliteEvolutionLearningLedger, "appendWithValidation" | "list">;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function opportunityId(link: SupersessionLink): string {
  return ID_PREFIX + sha256(canonicalResearchJson({
    surface: link.surface,
    previousDecisionFingerprint: link.previousDecisionFingerprint,
    nextDecisionFingerprint: link.nextDecisionFingerprint,
    supersessionPolicyVersion: link.supersessionPolicyVersion,
  }));
}

function parseLink(record: EvolutionLearningRecord): SupersessionLink {
  const recordedAt = Date.parse(record.recordedAt);
  if (
    record.validationStatus !== RECORD_KIND ||
    !record.opportunityId.startsWith(ID_PREFIX) ||
    record.problem !== PROBLEM ||
    record.changeReference !== SUPERSESSION_POLICY_VERSION ||
    record.outcome !== "SUCCESS" ||
    record.failureReason !== null ||
    record.rollbackReference !== null ||
    record.reusable !== true ||
    !Number.isFinite(recordedAt) ||
    new Date(recordedAt).toISOString() !== record.recordedAt
  ) {
    throw new SupersessionError("MALFORMED_LINK", "durable supersession record discriminator is inconsistent");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(record.hypothesis);
  } catch {
    throw new SupersessionError("MALFORMED_LINK", "durable supersession payload is not valid JSON");
  }
  assertSupersessionLink(parsed);
  const expectedEvidenceReferences = [parsed.previousDecisionFingerprint, parsed.nextDecisionFingerprint, parsed.surface]
    .sort((left, right) => left.localeCompare(right));
  if (
    canonicalResearchJson(parsed) !== record.hypothesis ||
    Buffer.byteLength(record.hypothesis, "utf8") > 2_000 ||
    record.evidenceReferences.length !== expectedEvidenceReferences.length ||
    record.evidenceReferences.some((reference, index) => reference !== expectedEvidenceReferences[index])
  ) {
    throw new SupersessionError("MALFORMED_LINK", "durable supersession envelope does not match the canonical link");
  }
  if (opportunityId(parsed) !== record.opportunityId) {
    throw new SupersessionError("IDENTITY_CONFLICT", "durable supersession record does not match its canonical identity");
  }
  return parsed;
}

/**
 * Durable A5 adapter over the existing append-only, hash-chained Evolution Learning ledger.
 * It adds no table or store. The edge identity is predecessor + successor + surface; a retry
 * with different explanatory metadata restores the first immutable record.
 */
export class LearningSupersessionLedger {
  public constructor(private readonly ledger: EvolutionLedgerPort, private readonly now: () => number = Date.now) {}

  private linksFromRecords(records: readonly EvolutionLearningRecord[]): readonly SupersessionLink[] {
    const candidates = records.filter((record) => record.validationStatus === RECORD_KIND || record.opportunityId.startsWith(ID_PREFIX));
    return Object.freeze(candidates.map(parseLink));
  }

  private links(): readonly SupersessionLink[] {
    return this.linksFromRecords(this.ledger.list());
  }

  public registry(): SupersessionRegistry {
    const registry = new SupersessionRegistry();
    registry.rehydrate(this.links());
    return registry;
  }

  public supersede(input: SupersessionLinkInput): SupersessionLink {
    const registry = this.registry();
    const candidate = buildSupersessionLink(input);
    const existing = registry.successorOf(input.previousDecisionFingerprint, input.surface);
    if (existing != null) return registry.supersede(input);

    // Validate the complete graph before attempting the single canonical append.
    registry.supersede(input);
    const timestamp = this.now();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0 || !Number.isFinite(timestamp)) {
      throw new SupersessionError("DURABLE_WRITE_FAILED", "durable supersession clock is invalid");
    }
    const id = opportunityId(candidate);
    const hypothesis = canonicalResearchJson(candidate);
    // createEvolutionLearningRecord trims hypotheses to 2,000 characters. Reject
    // oversized A5 payloads before that generic factory can persist a truncated link.
    if (Buffer.byteLength(hypothesis, "utf8") > 2_000 || hypothesis.length > 2_000) {
      throw new SupersessionError("DURABLE_WRITE_FAILED", "canonical supersession payload exceeds the durable learning-record bound");
    }
    const record = createEvolutionLearningRecord({
      opportunityId: id,
      problem: PROBLEM,
      evidenceReferences: [candidate.previousDecisionFingerprint, candidate.nextDecisionFingerprint, candidate.surface].sort(),
      hypothesis,
      changeReference: SUPERSESSION_POLICY_VERSION,
      validationStatus: RECORD_KIND,
      outcome: "SUCCESS",
      failureReason: null,
      rollbackReference: null,
      reusable: true,
      recordedAt: new Date(timestamp).toISOString(),
    });

    try {
      this.ledger.appendWithValidation(record, (records) => {
        const current = new SupersessionRegistry();
        current.rehydrate(this.linksFromRecords(records));
        current.supersede(input);
      });
    } catch {
      // The existing ledger serializes concurrent appends. Re-read only to classify an
      // idempotent same-edge winner; all other persistence errors remain fail-closed.
      try {
        const raced = this.registry().successorOf(input.previousDecisionFingerprint, input.surface);
        if (raced?.nextDecisionFingerprint === input.nextDecisionFingerprint) return raced;
        if (raced != null) throw new SupersessionError("SUPERSESSION_FORK", "a concurrent append recorded a different successor");
      } catch (readError) {
        if (readError instanceof SupersessionError && readError.code !== "DURABLE_WRITE_FAILED") throw readError;
      }
      throw new SupersessionError("DURABLE_WRITE_FAILED", "durable supersession append failed");
    }

    const persisted = this.registry().successorOf(input.previousDecisionFingerprint, input.surface);
    if (persisted == null || persisted.nextDecisionFingerprint !== input.nextDecisionFingerprint) {
      throw new SupersessionError("DURABLE_WRITE_FAILED", "supersession append did not survive canonical ledger replay");
    }
    return persisted;
  }
}
