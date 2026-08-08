import { createHash } from "node:crypto";
import { DisasterRecoveryDecision, RecoveryStepStatus, type DisasterRecoveryResult } from "../../../packages/contracts/src/recovery";

export type RecoveryArtifactRole = "RUNTIME_STATE" | "AUDIT_CHAIN" | "EVIDENCE" | "CONFIG" | "SCHEMA";
export interface RecoveryArtifactInput { readonly path: string; readonly role: RecoveryArtifactRole; readonly bytes: Uint8Array; }
export interface RecoveryManifestArtifact { readonly path: string; readonly role: RecoveryArtifactRole; readonly size: number; readonly digest: string; }
export interface RecoveryRestoreManifest {
  readonly version: 1;
  readonly backupId: string;
  readonly createdAt: string;
  readonly codeRevision: string;
  readonly configurationHash: string;
  readonly auditReplayChainHash: string;
  readonly artifacts: readonly RecoveryManifestArtifact[];
  readonly manifestDigest: string;
}
export interface RestoredArtifact { readonly path: string; readonly bytes: Uint8Array; }
export interface RestoreVerificationResult {
  readonly decision: "PASS" | "SAFE_BLOCK";
  readonly blockers: readonly string[];
  readonly backupId: string;
  readonly manifestDigest: string;
  readonly recoveryRunId: string;
  readonly automaticRestartAllowed: false;
  readonly executionAuthority: false;
  readonly authorizesLive: false;
  readonly realMoneyExecutionAllowed: false;
}

export const DISASTER_RECOVERY_RESTORE_DESCRIPTOR = Object.freeze({
  mode: "VERIFY_ONLY" as const,
  exactArtifactSetRequired: true as const,
  auditReplayAnchorRequired: true as const,
  recoveryConsistencyRequired: true as const,
  automaticRestartAllowed: false as const,
  executionAuthority: false as const,
  authorizesLive: false as const,
  credentialExecutionUse: false as const,
  realMoneyExecutionAllowed: false as const
});

const roles = new Set<RecoveryArtifactRole>(["RUNTIME_STATE", "AUDIT_CHAIN", "EVIDENCE", "CONFIG", "SCHEMA"]);
const prohibitedPath = /(^|[\/_.-])(credential|secret|token|private.?key|access.?key|authorization)([\/_.-]|$)/i;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Bytes(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function sha256Text(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function text(value: string, code: string): string { const normalized = value.trim(); if (!normalized) throw new Error(code); return normalized; }
function iso(value: string): string { if (Number.isNaN(Date.parse(value))) throw new Error("RECOVERY_RESTORE_TIMESTAMP_INVALID"); return value; }
function hash(value: string, length: 40 | 64, code: string): string { if (!new RegExp(`^[0-9a-f]{${length}}$`).test(value)) throw new Error(code); return value; }
function normalizePath(value: string): string {
  const normalized = text(value, "RECOVERY_RESTORE_PATH_REQUIRED").replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.split("/").some((part) => part === ".." || part === "." || !part)) throw new Error("RECOVERY_RESTORE_PATH_INVALID");
  if (prohibitedPath.test(normalized)) throw new Error("RECOVERY_RESTORE_SECRET_PATH_PROHIBITED");
  return normalized;
}
function manifestBody(manifest: Omit<RecoveryRestoreManifest, "manifestDigest">): string { return canonical(manifest); }
function expectedManifestDigest(manifest: Omit<RecoveryRestoreManifest, "manifestDigest">): string { return sha256Text(manifestBody(manifest)); }

export function createRecoveryRestoreManifest(input: {
  readonly backupId: string;
  readonly createdAt: string;
  readonly codeRevision: string;
  readonly configurationHash: string;
  readonly auditReplayChainHash: string;
  readonly artifacts: readonly RecoveryArtifactInput[];
}): RecoveryRestoreManifest {
  const backupId = text(input.backupId, "RECOVERY_RESTORE_BACKUP_ID_REQUIRED");
  const createdAt = iso(input.createdAt);
  const codeRevision = hash(input.codeRevision, 40, "RECOVERY_RESTORE_CODE_REVISION_INVALID");
  const configurationHash = hash(input.configurationHash, 64, "RECOVERY_RESTORE_CONFIGURATION_HASH_INVALID");
  const auditReplayChainHash = hash(input.auditReplayChainHash, 64, "RECOVERY_RESTORE_AUDIT_ANCHOR_INVALID");
  if (input.artifacts.length === 0) throw new Error("RECOVERY_RESTORE_ARTIFACTS_REQUIRED");
  const seen = new Set<string>();
  const artifacts = input.artifacts.map((artifact): RecoveryManifestArtifact => {
    const path = normalizePath(artifact.path);
    if (!roles.has(artifact.role)) throw new Error("RECOVERY_RESTORE_ROLE_INVALID");
    if (seen.has(path)) throw new Error("RECOVERY_RESTORE_DUPLICATE_PATH");
    seen.add(path);
    return Object.freeze({ path, role: artifact.role, size: artifact.bytes.byteLength, digest: sha256Bytes(artifact.bytes) });
  }).sort((a, b) => a.path.localeCompare(b.path));
  const body = Object.freeze({ version: 1 as const, backupId, createdAt, codeRevision, configurationHash, auditReplayChainHash, artifacts: Object.freeze(artifacts) });
  return Object.freeze({ ...body, manifestDigest: expectedManifestDigest(body) });
}

function verifyManifest(manifest: RecoveryRestoreManifest): readonly string[] {
  const blockers: string[] = [];
  try {
    text(manifest.backupId, "RECOVERY_RESTORE_BACKUP_ID_REQUIRED");
    iso(manifest.createdAt);
    hash(manifest.codeRevision, 40, "RECOVERY_RESTORE_CODE_REVISION_INVALID");
    hash(manifest.configurationHash, 64, "RECOVERY_RESTORE_CONFIGURATION_HASH_INVALID");
    hash(manifest.auditReplayChainHash, 64, "RECOVERY_RESTORE_AUDIT_ANCHOR_INVALID");
    if (manifest.version !== 1 || manifest.artifacts.length === 0) blockers.push("MANIFEST_SHAPE_INVALID");
    const paths = new Set<string>();
    for (const artifact of manifest.artifacts) {
      const path = normalizePath(artifact.path);
      if (paths.has(path)) blockers.push(`MANIFEST_DUPLICATE_PATH:${path}`);
      paths.add(path);
      if (!roles.has(artifact.role) || !Number.isSafeInteger(artifact.size) || artifact.size < 0 || !/^[0-9a-f]{64}$/.test(artifact.digest)) blockers.push(`MANIFEST_ARTIFACT_INVALID:${path}`);
    }
    const { manifestDigest: _ignored, ...body } = manifest;
    if (expectedManifestDigest(body) !== manifest.manifestDigest) blockers.push("MANIFEST_DIGEST_MISMATCH");
  } catch (error) {
    blockers.push(`MANIFEST_INVALID:${error instanceof Error ? error.message : "UNKNOWN"}`);
  }
  return blockers;
}

export function verifyDisasterRecoveryRestore(input: {
  readonly manifest: RecoveryRestoreManifest;
  readonly restoredArtifacts: readonly RestoredArtifact[];
  readonly restoredAuditReplayChainHash: string;
  readonly recovery: DisasterRecoveryResult;
}): RestoreVerificationResult {
  const blockers = [...verifyManifest(input.manifest)];
  const restored = new Map<string, RestoredArtifact>();
  try {
    for (const artifact of input.restoredArtifacts) {
      const path = normalizePath(artifact.path);
      if (restored.has(path)) blockers.push(`RESTORE_DUPLICATE_PATH:${path}`);
      else restored.set(path, artifact);
    }
  } catch (error) {
    blockers.push(`RESTORE_PATH_INVALID:${error instanceof Error ? error.message : "UNKNOWN"}`);
  }

  const expectedPaths = new Set(input.manifest.artifacts.map((artifact) => artifact.path));
  for (const expected of input.manifest.artifacts) {
    const actual = restored.get(expected.path);
    if (!actual) { blockers.push(`RESTORE_MISSING:${expected.path}`); continue; }
    if (actual.bytes.byteLength !== expected.size) blockers.push(`RESTORE_SIZE_MISMATCH:${expected.path}`);
    if (sha256Bytes(actual.bytes) !== expected.digest) blockers.push(`RESTORE_DIGEST_MISMATCH:${expected.path}`);
  }
  for (const path of restored.keys()) if (!expectedPaths.has(path)) blockers.push(`RESTORE_EXTRA:${path}`);

  if (!/^[0-9a-f]{64}$/.test(input.restoredAuditReplayChainHash) || input.restoredAuditReplayChainHash !== input.manifest.auditReplayChainHash) blockers.push("RESTORE_AUDIT_ANCHOR_MISMATCH");
  if (!input.recovery.runId.trim() || !Number.isSafeInteger(input.recovery.completedAtMs) || input.recovery.completedAtMs < 0) blockers.push("RECOVERY_EVIDENCE_INVALID");
  if (input.recovery.decision !== DisasterRecoveryDecision.CONSISTENT) blockers.push("RECOVERY_NOT_CONSISTENT");
  if (input.recovery.blockingDomains.length !== 0) blockers.push("RECOVERY_BLOCKING_DOMAINS_PRESENT");
  for (const domain of input.recovery.domains) if (domain.status !== RecoveryStepStatus.PASS) blockers.push(`RECOVERY_DOMAIN_NOT_PASS:${domain.domain}`);

  const unique = Object.freeze([...new Set(blockers)].sort());
  return Object.freeze({
    decision: unique.length === 0 ? "PASS" : "SAFE_BLOCK",
    blockers: unique,
    backupId: input.manifest.backupId,
    manifestDigest: input.manifest.manifestDigest,
    recoveryRunId: input.recovery.runId,
    automaticRestartAllowed: false,
    executionAuthority: false,
    authorizesLive: false,
    realMoneyExecutionAllowed: false
  });
}
