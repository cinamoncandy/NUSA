import type {
  NusaAcceptanceClass,
  NusaProgressDomain,
  NusaProgressItemResult,
  NusaProgressScorecard,
} from "./nusaProgressScorecard";

export type NusaProgressLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface NusaProgressLevelAssessment {
  readonly schemaVersion: 1;
  readonly level: NusaProgressLevel;
  readonly reasons: readonly string[];
  readonly achievedCriteria: readonly string[];
  readonly blockedCriteria: readonly string[];
}

export class NusaProgressLevelError extends Error {
  public constructor(readonly code: string, message: string) {
    super(message);
    this.name = "NusaProgressLevelError";
  }
}

const DOMAINS: readonly NusaProgressDomain[] = Object.freeze([
  "VERIFIED_ECONOMIC_EDGE",
  "AUTONOMY",
  "RELIABILITY_RECOVERY",
  "SAFETY_RESEARCH_INTEGRITY",
  "PRODUCT_UX",
  "INFRASTRUCTURE_MODULE_HEALTH",
]);

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function passed(items: readonly NusaProgressItemResult[]): readonly NusaProgressItemResult[] {
  return items.filter((item) => item.status === "PASS");
}

function passingDomains(items: readonly NusaProgressItemResult[]): ReadonlySet<NusaProgressDomain> {
  return new Set(passed(items).map((item) => item.domain));
}

function hasPassedClass(items: readonly NusaProgressItemResult[], acceptance: NusaAcceptanceClass, domain?: NusaProgressDomain): boolean {
  return items.some((item) => item.status === "PASS" && item.requiredAcceptance === acceptance && (domain == null || item.domain === domain));
}

function criteria(scorecard: NusaProgressScorecard): readonly Readonly<{ level: Exclude<NusaProgressLevel, 0>; id: string; met: boolean }>[] {
  if (scorecard.schemaVersion !== 1) throw new NusaProgressLevelError("UNSUPPORTED_SCORECARD_SCHEMA", "unsupported NUSA progress scorecard schema");
  const items = scorecard.items;
  const domains = passingDomains(items);
  const noFailures = !items.some((item) => item.status === "FAIL");
  const noUnknowns = !items.some((item) => item.status === "UNKNOWN");
  const allConfiguredItemsPass = items.length > 0 && items.every((item) => item.status === "PASS");

  // These levels are deliberately semantic rather than percentage bands. A level is earned by
  // stronger evidence classes and broader domain coverage, so adding a weak item cannot inflate
  // the level merely by moving an average. Recompute from the same evidence and the level can
  // fall immediately when evidence becomes stale, UNKNOWN, or FAIL.
  return freeze([
    { level: 1, id: "ANY_VERIFIED_PROGRESS", met: passed(items).length >= 1 },
    { level: 2, id: "TWO_DOMAIN_COVERAGE", met: domains.size >= 2 },
    { level: 3, id: "FOUR_DOMAIN_COVERAGE", met: domains.size >= 4 },
    { level: 4, id: "ALL_DOMAIN_COVERAGE", met: DOMAINS.every((domain) => domains.has(domain)) },
    { level: 5, id: "RUNTIME_EVIDENCE_PRESENT", met: hasPassedClass(items, "RUNTIME_VERIFIED") },
    { level: 6, id: "RELIABILITY_RUNTIME_VERIFIED", met: hasPassedClass(items, "RUNTIME_VERIFIED", "RELIABILITY_RECOVERY") },
    { level: 7, id: "ECONOMIC_EVIDENCE_VERIFIED", met: hasPassedClass(items, "EVIDENCE_VERIFIED", "VERIFIED_ECONOMIC_EDGE") },
    { level: 8, id: "NO_FAILED_EVIDENCE", met: noFailures && hasPassedClass(items, "EVIDENCE_VERIFIED", "VERIFIED_ECONOMIC_EDGE") },
    { level: 9, id: "PRODUCT_PHYSICALLY_ACCEPTED", met: noFailures && hasPassedClass(items, "PRODUCT_ACCEPTED", "PRODUCT_UX") },
    { level: 10, id: "ALL_CONFIGURED_EVIDENCE_SATISFIED", met: allConfiguredItemsPass && noUnknowns && noFailures && DOMAINS.every((domain) => domains.has(domain)) },
  ]);
}

/**
 * Projects a scorecard to the highest contiguous evidence level. Higher criteria never leap over
 * an unmet lower criterion, and there is no sticky historical state: regression in the scorecard
 * immediately lowers the returned level on recomputation.
 */
export function assessNusaProgressLevel(scorecard: NusaProgressScorecard): NusaProgressLevelAssessment {
  const checks = criteria(scorecard);
  let level: NusaProgressLevel = 0;
  const achieved: string[] = [];
  const blocked: string[] = [];
  let blockedLowerLevel = false;

  for (const check of checks) {
    if (!blockedLowerLevel && check.met) {
      level = check.level;
      achieved.push(`LV${check.level}_${check.id}`);
      continue;
    }
    blockedLowerLevel = true;
    blocked.push(`LV${check.level}_${check.id}`);
  }

  const reasons = [`EVIDENCE_BACKED_LEVEL_${level}`];
  if (scorecard.items.some((item) => item.status === "FAIL")) reasons.push("FAILED_EVIDENCE_DEMOTES_LEVEL");
  if (scorecard.items.some((item) => item.status === "UNKNOWN")) reasons.push("UNKNOWN_EVIDENCE_BLOCKS_HIGHER_LEVEL");

  return freeze({
    schemaVersion: 1,
    level,
    reasons: freeze(reasons),
    achievedCriteria: freeze(achieved),
    blockedCriteria: freeze(blocked),
  });
}
