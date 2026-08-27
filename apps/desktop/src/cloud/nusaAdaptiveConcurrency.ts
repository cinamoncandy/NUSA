export type NusaConcurrencyEvidence = {
  mergedWorkCount: number;
  reworkCount: number;
  conflictCount: number;
  ciCapacitySlots: number | null;
  ciPeakConcurrentJobs: number | null;
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

  for (const [name, value] of Object.entries({
    ciCapacitySlots: evidence.ciCapacitySlots,
    ciPeakConcurrentJobs: evidence.ciPeakConcurrentJobs,
  })) {
    if (value !== null && (!Number.isSafeInteger(value) || value <= 0)) {
      throw new Error(`ADAPTIVE_CONCURRENCY_INVALID_${name.toUpperCase()}`);
    }
  }
}

export function decideNusaAdaptiveConcurrency(evidence: NusaConcurrencyEvidence): NusaConcurrencyDecision {
  validateEvidence(evidence);

  if (evidence.mergedWorkCount < 4 || evidence.ciCapacitySlots === null || evidence.ciPeakConcurrentJobs === null) {
    return {
      maximumActiveWorkPerOwner: 1,
      classification: "CONSERVATIVE",
      reasons: ["INSUFFICIENT_THROUGHPUT_OR_CI_CAPACITY_EVIDENCE"],
    };
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

  return {
    maximumActiveWorkPerOwner: Math.min(2, 1 + spareCiSlots),
    classification: "MEASURED",
    reasons: ["LOW_CONFLICT_REWORK_WITH_SPARE_CI_CAPACITY"],
  };
}
