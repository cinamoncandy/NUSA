export interface OperationalProgressDomain {
  readonly domain: string;
  readonly completionRatio: number;
}

export interface OperationalProgressSnapshot {
  readonly schemaVersion: 1;
  readonly scope: "OPERATIONAL_EVIDENCE_ONLY";
  readonly authority: "READ_ONLY";
  readonly headSha: string;
  readonly asOf: number;
  readonly level: number;
  readonly overallProgressRatio: number;
  readonly domains: readonly OperationalProgressDomain[];
  readonly achievedCriteria: readonly string[];
  readonly blockedCriteria: readonly string[];
  readonly reasons: readonly string[];
  readonly blockers: readonly string[];
}

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const strings = (value: unknown, name: string): readonly string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${name} must be a string array`);
  return freeze([...value]);
};
const ratio = (value: unknown, name: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be a finite ratio in [0,1]`);
  return value;
};

/** Validates the serializable, read-only projection consumed by Supervisor clients. */
export function validateOperationalProgressSnapshot(value: unknown, now = Date.now(), maxAgeMs = 15 * 60_000): OperationalProgressSnapshot {
  if (value == null || typeof value !== "object") throw new Error("operational progress snapshot is required");
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== 1) throw new Error("unsupported operational progress schema");
  if (input.scope !== "OPERATIONAL_EVIDENCE_ONLY") throw new Error("operational progress scope is invalid");
  if (input.authority !== "READ_ONLY") throw new Error("operational progress authority must remain READ_ONLY");
  if (typeof input.headSha !== "string" || !/^[0-9a-f]{40}$/i.test(input.headSha)) throw new Error("operational progress headSha is invalid");
  if (typeof input.asOf !== "number" || !Number.isFinite(input.asOf) || input.asOf <= 0) throw new Error("operational progress asOf is invalid");
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) throw new Error("operational progress maxAgeMs is invalid");
  if (input.asOf > now + 60_000 || now - input.asOf > maxAgeMs) throw new Error("operational progress snapshot is stale");
  if (!Number.isSafeInteger(input.level) || (input.level as number) < 0) throw new Error("operational progress level is invalid");
  if (!Array.isArray(input.domains)) throw new Error("operational progress domains are invalid");
  const domains = freeze(input.domains.map((item, index) => {
    if (item == null || typeof item !== "object") throw new Error(`operational progress domain ${index} is invalid`);
    const domain = item as Record<string, unknown>;
    if (typeof domain.domain !== "string" || !domain.domain.trim()) throw new Error(`operational progress domain ${index} name is invalid`);
    return freeze({ domain: domain.domain, completionRatio: ratio(domain.completionRatio, `domain ${domain.domain} completionRatio`) });
  }));
  return freeze({
    schemaVersion: 1,
    scope: "OPERATIONAL_EVIDENCE_ONLY",
    authority: "READ_ONLY",
    headSha: input.headSha,
    asOf: input.asOf,
    level: input.level as number,
    overallProgressRatio: ratio(input.overallProgressRatio, "overallProgressRatio"),
    domains,
    achievedCriteria: strings(input.achievedCriteria, "achievedCriteria"),
    blockedCriteria: strings(input.blockedCriteria, "blockedCriteria"),
    reasons: strings(input.reasons, "reasons"),
    blockers: strings(input.blockers, "blockers")
  });
}
