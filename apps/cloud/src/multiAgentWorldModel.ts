import type { MarketRegime, WorldModelSnapshot } from "./worldModel";

export interface MultiAgentWorldModel {
  readonly regime: MarketRegime;
  readonly consensus: number;
  readonly contributingSnapshotIds: readonly string[];
  readonly conflictingSnapshotIds: readonly string[];
  readonly recommendationOnly: true;
}

export const combineWorldModels = (snapshots: readonly WorldModelSnapshot[]): MultiAgentWorldModel => {
  if (snapshots.length === 0) return Object.freeze({ regime: "UNKNOWN", consensus: 0, contributingSnapshotIds: Object.freeze([]), conflictingSnapshotIds: Object.freeze([]), recommendationOnly: true });
  const sourceIds = new Set<string>();
  for (const snapshot of snapshots) {
    if (sourceIds.has(snapshot.source)) throw new Error(`duplicate world model source: ${snapshot.source}`);
    sourceIds.add(snapshot.source);
  }
  const weighted = new Map<MarketRegime, number>();
  for (const snapshot of snapshots) weighted.set(snapshot.regime, (weighted.get(snapshot.regime) ?? 0) + snapshot.confidence);
  const ordered = [...weighted.entries()].sort(([leftRegime, leftWeight], [rightRegime, rightWeight]) => rightWeight - leftWeight || leftRegime.localeCompare(rightRegime));
  const [winner, winnerWeight] = ordered[0] ?? ["UNKNOWN", 0];
  const totalWeight = ordered.reduce((sum, [, weight]) => sum + weight, 0);
  const consensus = totalWeight === 0 ? 0 : winnerWeight / totalWeight;
  const regime = consensus < 0.6 || winner === "UNKNOWN" ? "UNKNOWN" : winner;
  return Object.freeze({ regime, consensus, contributingSnapshotIds: Object.freeze(snapshots.filter((snapshot) => snapshot.regime === regime).map((snapshot) => snapshot.snapshotId)), conflictingSnapshotIds: Object.freeze(snapshots.filter((snapshot) => snapshot.regime !== regime).map((snapshot) => snapshot.snapshotId)), recommendationOnly: true });
};
