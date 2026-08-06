import { buildPortfolioPlan } from "./portfolioOrchestrator";
import type { CloudDashboardStateProvider } from "./cloudDashboardStateProvider";
import type { DashboardPrincipal } from "./mobileDashboardHttp";
import type { MobileDashboardApiInput } from "./mobileDashboardApi";
import {
  CLOUD_DASHBOARD_SNAPSHOT_SCHEMA_VERSION,
  type CloudDashboardSnapshot,
  type CloudDashboardSnapshotRepository
} from "./cloudDashboardSnapshotRepository";

const MAX_SNAPSHOT_AGE_MS = 24 * 60 * 60 * 1000;

function safeRecoveredInput(snapshot: CloudDashboardSnapshot, now: number): MobileDashboardApiInput {
  const staleSources = new Set(snapshot.payload.intelligence.staleSources);
  for (const signal of snapshot.payload.intelligence.signals) staleSources.add(signal.source);
  const decisions = snapshot.payload.decisions.map((decision) => Object.freeze({
    ...decision,
    action: "WAIT" as const,
    allocation: 0,
    leverage: 1,
    risk: "CRITICAL" as const,
    reasons: Object.freeze([...decision.reasons, "Recovered snapshot is read-only until fresh market data arrives"])
  }));
  return Object.freeze({
    now,
    mode: "PAPER",
    killSwitchActive: true,
    overallHealth: "DOWN",
    headline: "Dashboard state recovered; waiting for fresh market data",
    issues: Object.freeze(["Recovered snapshot requires fresh market data"]),
    portfolio: buildPortfolioPlan({ now, deployableCapital: 0, reservedCapital: 0, candidates: [], maxFuturesShare: 0, maxGrossShare: 0 }),
    decisions: Object.freeze(decisions),
    intelligence: Object.freeze({ signals: Object.freeze([]), staleSources: Object.freeze([...staleSources].sort()), generatedAt: now })
  });
}

export class DurableCloudDashboardStateProvider implements CloudDashboardStateProvider {
  public constructor(
    private readonly memory: CloudDashboardStateProvider,
    private readonly repository: CloudDashboardSnapshotRepository,
    private readonly sourceCommit: string,
    private readonly sourceVersion: string,
    private readonly now: () => number = () => Date.now()
  ) {}

  public read(principal: DashboardPrincipal): MobileDashboardApiInput | undefined { return this.memory.read(principal); }

  public set(state: MobileDashboardApiInput): void {
    this.memory.set(state);
    try {
      const savedAt = this.now();
      const snapshot: CloudDashboardSnapshot = {
        schemaVersion: CLOUD_DASHBOARD_SNAPSHOT_SCHEMA_VERSION,
        sourceCommit: this.sourceCommit,
        sourceVersion: this.sourceVersion,
        generatedAt: state.now,
        savedAt,
        payload: state
      };
      this.repository.save(snapshot);
    } catch (error) {
      this.memory.clear();
      try { this.repository.clear(); } catch { /* fail closed even if storage is unavailable */ }
      throw error;
    }
  }

  public clear(): void {
    this.memory.clear();
    try { this.repository.clear(); } catch { /* provider remains unavailable */ }
  }

  public recover(): boolean {
    try {
      const snapshot = this.repository.loadLatest();
      this.memory.clear();
      if (snapshot == null) return false;
      const now = this.now();
      if (snapshot.savedAt > now || now - snapshot.savedAt > MAX_SNAPSHOT_AGE_MS) return false;
      this.memory.set(safeRecoveredInput(snapshot, now));
      return true;
    } catch {
      this.memory.clear();
      return false;
    }
  }

  public close(): void { this.repository.close(); }
}
