export type NusaConcurrencyEvidence = {
  mergedWorkCount: number;
  reworkCount: number;
  conflictCount: number;
  ciCapacitySlots: number | null;
  ciPeakConcurrentJobs: number | null;
  /** Number of canonical packages currently READY and not parked. */
  readyBacklog?: number | null;
  /** Measured executor slots available to this development lane. */
  executorCapacitySlots?: number | null;
  /** Number of observations supporting the supply/capacity measurement. */
  observationCount?: number | null;
  /** Stale-head observations must be zero before scaling the lane. */
  staleHeadCount?: number | null;
  /** Counted for the operating read model; positive evidence favors scale-up. */
  avoidableIdleCount?: number | null;
};

export type NusaConcurrencyDecision = {
  maximumActiveWorkPerOwner: number;
  classification: "CONSERVATIVE" | "MEASURED";
  reasons: string[];
};

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateEvidence(evidence: NusaConcurrencyEvidence): void {
  for (const [name, value] of Object.entries({
    mergedWorkCount: evidence.mergedWorkCount,
    reworkCount: evidence.reworkCount,
    conflictCount: evidence.conflictCount,
  })) {
    if (!isNonNegativeInteger(value)) throw new Error(`ADAPTIVE_CONCURRENCY_INVALID_${name.toUpperCase()}`);
  }

  if (evidence.ciCapacitySlots !== null && (!Number.isSafeInteger(evidence.ciCapacitySlots) || evidence.ciCapacitySlots <= 0)) {
    throw new Error("ADAPTIVE_CONCURRENCY_INVALID_CICAPACITYSLOTS");
  }
  if (evidence.ciPeakConcurrentJobs !== null && (!Number.isSafeInteger(evidence.ciPeakConcurrentJobs) || evidence.ciPeakConcurrentJobs < 0)) {
    throw new Error("ADAPTIVE_CONCURRENCY_INVALID_CIPEAKCONCURRENTJOBS");
  }

  for (const [name, value] of Object.entries({
    readyBacklog: evidence.readyBacklog,
    executorCapacitySlots: evidence.executorCapacitySlots,
    observationCount: evidence.observationCount,
    staleHeadCount: evidence.staleHeadCount,
    avoidableIdleCount: evidence.avoidableIdleCount,
  })) {
    if (value !== undefined && value !== null && !isNonNegativeInteger(value)) {
      throw new Error(`ADAPTIVE_CONCURRENCY_INVALID_${name.toUpperCase()}`);
    }
  }
}

function conservative(reason: string): NusaConcurrencyDecision {
  return {
    maximumActiveWorkPerOwner: 1,
    classification: "CONSERVATIVE",
    reasons: [reason],
  };
}

export function decideNusaAdaptiveConcurrency(evidence: NusaConcurrencyEvidence): NusaConcurrencyDecision {
  validateEvidence(evidence);

  if (evidence.mergedWorkCount < 4 || evidence.ciCapacitySlots === null || evidence.ciPeakConcurrentJobs === null) {
    return conservative("INSUFFICIENT_THROUGHPUT_OR_CI_CAPACITY_EVIDENCE");
  }

  const conflictRate = evidence.conflictCount / evidence.mergedWorkCount;
  const reworkRate = evidence.reworkCount / evidence.mergedWorkCount;
  if (conflictRate > 0.1 || reworkRate > 0.2) {
    return {
      maximumActiveWorkPerOwner: 1,
      classification: "MEASURED",
      reasons: [conflictRate > 0.1 ? "CONFLICT_RATE_TOO_HIGH" : "REWORK_RATE_TOO_HIGH"],
    };
  }

  const spareCiSlots = evidence.ciCapacitySlots - evidence.ciPeakConcurrentJobs;
  if (spareCiSlots < 1) {
    return {
      maximumActiveWorkPerOwner: 1,
      classification: "MEASURED",
      reasons: ["NO_EVIDENCED_CI_SPARE_CAPACITY"],
    };
  }

  const supplyEvidence = [
    evidence.readyBacklog,
    evidence.executorCapacitySlots,
    evidence.observationCount,
    evidence.staleHeadCount,
  ];
  const usesSupplyEvidence = supplyEvidence.some((value) => value !== undefined);
  if (usesSupplyEvidence) {
    if (supplyEvidence.some((value) => value === undefined || value === null)) {
      return conservative("INSUFFICIENT_READY_SUPPLY_EVIDENCE");
    }
    if (evidence.observationCount! < 4) return conservative("INSUFFICIENT_READY_SUPPLY_OBSERVATIONS");
    if (evidence.staleHeadCount! > 0) {
      return {
        maximumActiveWorkPerOwner: 1,
        classification: "MEASURED",
        reasons: ["STALE_HEAD_EVIDENCE_PRESENT"],
      };
    }
    if (evidence.readyBacklog! < 2) {
      return {
        maximumActiveWorkPerOwner: 1,
        classification: "MEASURED",
        reasons: ["NO_READY_BACKLOG_TO_SCALE"],
      };
    }
    if (evidence.executorCapacitySlots! < 1) {
      return {
        maximumActiveWorkPerOwner: 1,
        classification: "MEASURED",
        reasons: ["NO_EVIDENCED_EXECUTOR_CAPACITY"],
      };
    }

    // Keep the lane work-conserving while retaining an even, auditable ramp
    // (1 -> 2 -> 4 -> 6 -> 8+) instead of the former hard cap of two.
    const rawCapacity = Math.min(evidence.readyBacklog!, evidence.executorCapacitySlots!, 1 + spareCiSlots);
    const rampedCapacity = rawCapacity < 2 ? 1 : rawCapacity - (rawCapacity % 2);
    const reasons = [
      "READY_BACKLOG_PRESENT",
      "NO_STALE_HEAD_EVIDENCE",
      "EXECUTOR_CAPACITY_AVAILABLE",
      "ADAPTIVE_CONCURRENCY_MEASURED",
    ];
    if ((evidence.avoidableIdleCount ?? 0) > 0) reasons.push("AVOIDABLE_IDLE_SUPPORTS_SCALE_UP");
    return {
      maximumActiveWorkPerOwner: Math.max(1, rampedCapacity),
      classification: "MEASURED",
      reasons,
    };
  }

  return {
    maximumActiveWorkPerOwner: Math.min(2, 1 + spareCiSlots),
    classification: "MEASURED",
    reasons: ["LOW_CONFLICT_REWORK_WITH_SPARE_CI_CAPACITY"],
  };
}
