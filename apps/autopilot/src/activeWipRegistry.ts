export interface ActiveWorkClaim {
  readonly workId: string;
  readonly executionId: string;
  readonly touchedModules: readonly string[];
  readonly touchedFiles: readonly string[];
  readonly claimedAt: number;
  readonly leaseExpiresAt: number;
}

export interface ActiveWorkConflict {
  readonly workId: string;
  readonly executionId: string;
  readonly modules: readonly string[];
  readonly files: readonly string[];
}

export interface ActiveWorkDecision {
  readonly accepted: boolean;
  readonly reason: "ACCEPTED" | "WIP_LIMIT_REACHED" | "RESOURCE_CONFLICT" | "INVALID_CLAIM";
  readonly conflicts: readonly ActiveWorkConflict[];
}

function normalized(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values.map((value) => value.trim()).filter(Boolean))].sort());
}

export function normalizeActiveWorkClaim(claim: ActiveWorkClaim): ActiveWorkClaim | null {
  if (!claim.workId.trim() || !claim.executionId.trim()) return null;
  if (!Number.isSafeInteger(claim.claimedAt) || !Number.isSafeInteger(claim.leaseExpiresAt) || claim.claimedAt < 0 || claim.leaseExpiresAt <= claim.claimedAt) return null;
  const touchedModules = normalized(claim.touchedModules);
  const touchedFiles = normalized(claim.touchedFiles);
  if (touchedModules.length === 0 && touchedFiles.length === 0) return null;
  return Object.freeze({ ...claim, workId: claim.workId.trim(), executionId: claim.executionId.trim(), touchedModules, touchedFiles });
}

export function activeWorkSnapshot(claims: readonly ActiveWorkClaim[], now: number): readonly ActiveWorkClaim[] {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("ACTIVE_WIP_NOW_INVALID");
  const byWork = new Map<string, ActiveWorkClaim>();
  for (const raw of claims) {
    const claim = normalizeActiveWorkClaim(raw);
    if (!claim || claim.leaseExpiresAt <= now) continue;
    const existing = byWork.get(claim.workId);
    if (existing && existing.executionId !== claim.executionId) throw new Error("ACTIVE_WIP_IDENTITY_CONFLICT");
    byWork.set(claim.workId, claim);
  }
  return Object.freeze([...byWork.values()].sort((a, b) => a.workId.localeCompare(b.workId) || a.executionId.localeCompare(b.executionId)));
}

export function decideActiveWorkClaim(candidateRaw: ActiveWorkClaim, currentRaw: readonly ActiveWorkClaim[], now: number, maxActiveWip: number): ActiveWorkDecision {
  const candidate = normalizeActiveWorkClaim(candidateRaw);
  if (!candidate || !Number.isSafeInteger(maxActiveWip) || maxActiveWip < 1) return Object.freeze({ accepted: false, reason: "INVALID_CLAIM", conflicts: Object.freeze([]) });
  const current = activeWorkSnapshot(currentRaw, now);
  if (current.some((claim) => claim.workId === candidate.workId && claim.executionId === candidate.executionId)) return Object.freeze({ accepted: true, reason: "ACCEPTED", conflicts: Object.freeze([]) });
  const candidateModules = new Set(candidate.touchedModules);
  const candidateFiles = new Set(candidate.touchedFiles);
  const conflicts = current.flatMap((claim) => {
    const modules = claim.touchedModules.filter((value) => candidateModules.has(value));
    const files = claim.touchedFiles.filter((value) => candidateFiles.has(value));
    return modules.length || files.length ? [Object.freeze({ workId: claim.workId, executionId: claim.executionId, modules: Object.freeze(modules), files: Object.freeze(files) })] : [];
  });
  if (conflicts.length > 0) return Object.freeze({ accepted: false, reason: "RESOURCE_CONFLICT", conflicts: Object.freeze(conflicts) });
  if (current.length >= maxActiveWip) return Object.freeze({ accepted: false, reason: "WIP_LIMIT_REACHED", conflicts: Object.freeze([]) });
  return Object.freeze({ accepted: true, reason: "ACCEPTED", conflicts: Object.freeze([]) });
}
