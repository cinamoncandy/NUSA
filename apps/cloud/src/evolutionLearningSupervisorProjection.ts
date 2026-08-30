import { validateEvolutionLearningSupervisorSnapshot, type EvolutionLearningSupervisorSnapshot } from "../../../packages/contracts/src/evolutionLearningSupervisor";
import type { EvolutionLearningLedgerReplay } from "../../../packages/storage/src/evolutionLearningLedger";

const RECENT_LIMIT = 5;

export function buildEvolutionLearningSupervisorSnapshot(
  replay: EvolutionLearningLedgerReplay,
): EvolutionLearningSupervisorSnapshot {
  const latest = replay.records.at(-1) ?? null;
  const recent = replay.records.slice(-RECENT_LIMIT).reverse();
  return validateEvolutionLearningSupervisorSnapshot({
    schemaVersion: 1,
    scope: "EVOLUTION_LEARNING_EVIDENCE_ONLY",
    authority: "READ_ONLY",
    aiAuthority: "ZERO_AUTHORITY",
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    eventCount: replay.eventCount,
    headHash: replay.headHash,
    latest,
    recent,
  });
}
