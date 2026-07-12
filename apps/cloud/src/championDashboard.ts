export interface ChampionCandidate {
  readonly strategyId: string;
  readonly role: "CHAMPION" | "CHALLENGER";
  readonly status: "HEALTHY" | "WATCH" | "BLOCKED";
  readonly netPnl: number;
  readonly captureRatio: number;
  readonly maxDrawdownRatio: number;
  readonly paperDays: number;
}

export interface ChampionDashboard {
  readonly champion: ChampionCandidate | null;
  readonly challengers: readonly ChampionCandidate[];
  readonly blocked: readonly ChampionCandidate[];
  readonly promotionAllowed: false;
}

const assertRatio = (value: number, field: string): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${field} must be between 0 and 1`);
};

export function buildChampionDashboard(candidates: readonly ChampionCandidate[]): ChampionDashboard {
  if (new Set(candidates.map((item) => item.strategyId)).size !== candidates.length) throw new Error("strategyId values must be unique");
  for (const item of candidates) {
    if (!item.strategyId.trim()) throw new Error("strategyId is required");
    if (!Number.isFinite(item.netPnl)) throw new Error("netPnl must be finite");
    assertRatio(item.captureRatio, "captureRatio");
    assertRatio(item.maxDrawdownRatio, "maxDrawdownRatio");
    if (!Number.isSafeInteger(item.paperDays) || item.paperDays < 0) throw new Error("paperDays must be a non-negative safe integer");
  }
  const champions = candidates.filter((item) => item.role === "CHAMPION");
  if (champions.length > 1) throw new Error("only one Champion is allowed");
  const clone = (items: readonly ChampionCandidate[]) => Object.freeze(items.map((item) => Object.freeze({ ...item })));
  return Object.freeze({
    champion: champions[0] ? Object.freeze({ ...champions[0] }) : null,
    challengers: clone(candidates.filter((item) => item.role === "CHALLENGER" && item.status !== "BLOCKED").sort((a, b) => b.netPnl - a.netPnl || a.strategyId.localeCompare(b.strategyId))),
    blocked: clone(candidates.filter((item) => item.status === "BLOCKED").sort((a, b) => a.strategyId.localeCompare(b.strategyId))),
    promotionAllowed: false as const
  });
}
