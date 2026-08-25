import { createHash } from "node:crypto";
import type { PaperSafetySnapshot, PersistedTradingAlert } from "../../../../packages/contracts/src/paperSafetySnapshot";

type SnapshotInput = Omit<PaperSafetySnapshot, "schemaVersion" | "automaticTrading" | "snapshotSha256" | "productionMutationAllowed">;
export type RecoveryMode = "SHADOW" | "PAPER_MANUAL";
export interface PaperSafetyRecovery { readonly snapshot: PaperSafetySnapshot; readonly mode: RecoveryMode; readonly automaticTrading: false; readonly reconciliation: "REQUIRED"; readonly blocked: boolean; readonly reasonCodes: readonly string[]; }

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function digest(value: unknown): string { return createHash("sha256").update(canonical(value), "utf8").digest("hex"); }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function ids(values: readonly string[], name: string): void { if (!values.every((value) => typeof value === "string" && value.length > 0) || new Set(values).size !== values.length) throw new Error(`invalid ${name}`); }
function alert(alert: PersistedTradingAlert): void {
  if (!alert.alertId || !["P0", "P1", "P2"].includes(alert.severity) || !["OPEN", "ACKNOWLEDGED", "RESOLVED"].includes(alert.status) || !alert.reasonCode || !finite(alert.createdAt)) throw new Error("invalid persisted alert");
  if ((alert.status === "ACKNOWLEDGED" && !alert.acknowledgedBy) || (alert.status === "RESOLVED" && !alert.resolutionEvidence)) throw new Error("invalid persisted alert lifecycle");
}

/** Deterministically creates a snapshot that cannot persist automatic Paper trading. */
export function createPaperSafetySnapshot(input: SnapshotInput): PaperSafetySnapshot {
  const base = Object.freeze({ ...input, schemaVersion: 1 as const, automaticTrading: false as const, productionMutationAllowed: false as const });
  const snapshot = Object.freeze({ ...base, snapshotSha256: digest(base) });
  validatePaperSafetySnapshot(snapshot);
  return snapshot;
}

export function serializePaperSafetySnapshot(snapshot: PaperSafetySnapshot): string { validatePaperSafetySnapshot(snapshot); return canonical(snapshot); }

export function validatePaperSafetySnapshot(value: unknown): asserts value is PaperSafetySnapshot {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.automaticTrading !== false || value.productionMutationAllowed !== false) throw new Error("unsupported or unsafe paper safety snapshot");
  const snapshot = value as unknown as PaperSafetySnapshot;
  if (!snapshot.snapshotId || !finite(snapshot.createdAt) || !snapshot.sourceCommitSha || !/^[a-f0-9]{64}$/i.test(snapshot.snapshotSha256)) throw new Error("invalid paper safety snapshot identity");
  if (!["SHADOW", "PAPER_MANUAL", "PAPER_CANARY", "PAPER_EXTENDED"].includes(snapshot.tradingMode)) throw new Error("invalid paper safety trading mode");
  if (!isRecord(snapshot.killSwitch) || typeof snapshot.killSwitch.active !== "boolean" || (snapshot.killSwitch.activatedAt !== null && !finite(snapshot.killSwitch.activatedAt)) || (snapshot.killSwitch.reason !== null && typeof snapshot.killSwitch.reason !== "string")) throw new Error("invalid paper safety kill switch");
  if (!isRecord(snapshot.fingerprints) || !Object.values(snapshot.fingerprints).every((item) => typeof item === "string" && item.length > 0)) throw new Error("invalid paper safety fingerprints");
  if (snapshot.approval !== null) {
    const approval = snapshot.approval as unknown as Record<string, unknown>;
    const required = ["approvalId", "approvedBy", "allowedSymbol", "strategyFingerprint", "configFingerprint", "runtimeFingerprint", "riskPolicyFingerprint"];
    if (!isRecord(approval) || !required.every((key) => typeof approval[key] === "string" && String(approval[key]).length > 0) || !["PAPER_MANUAL", "SHADOW", "CANARY"].includes(String(approval.mode)) || !["approvedAt", "expiresAt", "maximumOrders", "maximumCompletedTrades", "maximumSessionLoss", "maximumSessionDuration"].every((key) => finite(approval[key])) || Number(approval.expiresAt) < Number(approval.approvedAt)) throw new Error("invalid paper trading approval");
  }
  if (!isRecord(snapshot.deploymentIntegrity) || !["PASS", "FAIL", "UNKNOWN"].includes(snapshot.deploymentIntegrity.status) || !Array.isArray(snapshot.deploymentIntegrity.reasonCodes)) throw new Error("invalid deployment integrity");
  if (!isRecord(snapshot.reconciliation) || !["PASS", "FAIL", "REQUIRED", "UNKNOWN"].includes(snapshot.reconciliation.status) || !Array.isArray(snapshot.reconciliation.reasonCodes)) throw new Error("invalid reconciliation");
  if (!isRecord(snapshot.idempotency)) throw new Error("invalid idempotency state");
  for (const [name, values] of Object.entries(snapshot.idempotency)) { if (!Array.isArray(values)) throw new Error("invalid idempotency state"); ids(values as string[], name); }
  if (!Array.isArray(snapshot.openAlerts) || new Set(snapshot.openAlerts.map((item) => item.alertId)).size !== snapshot.openAlerts.length) throw new Error("invalid persisted alerts");
  snapshot.openAlerts.forEach(alert);
  if (!isRecord(snapshot.lossState) || !Object.values(snapshot.lossState).slice(1).every(finite) || typeof snapshot.lossState.tradingDay !== "string" || snapshot.lossState.consecutiveLossCount < 0) throw new Error("invalid loss state");
  if (!isRecord(snapshot.marketDataRecovery) || snapshot.marketDataRecovery.status !== "WARMING_UP" || snapshot.marketDataRecovery.consecutiveHealthyClosedCandles !== 0 || !finite(snapshot.marketDataRecovery.reconnectCount) || snapshot.marketDataRecovery.reconnectCount < 0) throw new Error("invalid market recovery state");
  const { snapshotSha256, ...withoutHash } = snapshot;
  if (digest(withoutHash) !== snapshotSha256) throw new Error("paper safety snapshot hash mismatch");
}

/** Restores safety state only. A restart always waits for fresh data and reconciliation. */
export function recoverPaperSafetySnapshot(value: unknown, expected: Readonly<{ sourceCommitSha: string; fingerprints: PaperSafetySnapshot["fingerprints"] }>): PaperSafetyRecovery {
  validatePaperSafetySnapshot(value);
  const snapshot = value;
  const reasons: string[] = [];
  if (snapshot.sourceCommitSha !== expected.sourceCommitSha) reasons.push("SOURCE_COMMIT_MISMATCH");
  for (const key of ["strategy", "config", "runtime", "riskPolicy"] as const) if (snapshot.fingerprints[key] !== expected.fingerprints[key]) reasons.push(`FINGERPRINT_${key.toUpperCase()}_MISMATCH`);
  if (snapshot.killSwitch.active) reasons.push("KILL_SWITCH_ACTIVE");
  if (snapshot.openAlerts.some((item) => item.severity === "P0" && item.status !== "RESOLVED")) reasons.push("OPEN_P0_ALERT");
  if (snapshot.deploymentIntegrity.status !== "PASS") reasons.push("DEPLOYMENT_INTEGRITY_REQUIRED");
  if (snapshot.reconciliation.status === "FAIL") reasons.push("RECONCILIATION_FAILED");
  reasons.push("RECONCILIATION_REQUIRED", "AUTOMATIC_TRADING_OFF_AFTER_RESTART", "MARKET_DATA_WARMING_UP");
  return Object.freeze({ snapshot, mode: snapshot.tradingMode === "PAPER_MANUAL" ? "PAPER_MANUAL" : "SHADOW", automaticTrading: false, reconciliation: "REQUIRED", blocked: reasons.length > 3, reasonCodes: Object.freeze([...new Set(reasons)].sort()) });
}
