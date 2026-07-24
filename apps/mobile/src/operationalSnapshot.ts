export type ServiceHealth = "HEALTHY" | "DEGRADED" | "DOWN";
export type TradingMode = "PAPER" | "STOPPED" | "FAULTED";

export interface OperationalSnapshotInput {
  readonly now: number;
  readonly mode: TradingMode;
  readonly killSwitchActive: boolean;
  readonly api: ServiceHealth;
  readonly database: ServiceHealth;
  readonly marketData: ServiceHealth;
  readonly intelligence: ServiceHealth;
  readonly exchange: ServiceHealth;
  readonly lastDecisionAt?: number;
}

export interface OperationalSnapshot {
  readonly overall: ServiceHealth;
  readonly tradingAllowed: boolean;
  readonly headline: string;
  readonly issues: readonly string[];
  readonly nextAction: "NONE" | "WAIT" | "CHECK_SYSTEM" | "EMERGENCY_STOP";
  readonly generatedAt: number;
}

export function buildOperationalSnapshot(input: OperationalSnapshotInput): OperationalSnapshot {
  if (!Number.isSafeInteger(input.now) || input.now < 0) throw new Error("now must be a non-negative safe integer");
  if (input.lastDecisionAt !== undefined && (!Number.isSafeInteger(input.lastDecisionAt) || input.lastDecisionAt < 0 || input.lastDecisionAt > input.now)) {
    throw new Error("lastDecisionAt is invalid");
  }

  const services = [
    ["API", input.api],
    ["Database", input.database],
    ["Market data", input.marketData],
    ["Intelligence", input.intelligence],
    ["Exchange", input.exchange]
  ] as const;
  const issues = services.filter(([, health]) => health !== "HEALTHY").map(([name, health]) => `${name}: ${health}`);
  if (input.killSwitchActive) issues.unshift("Kill switch active");
  if (input.mode === "FAULTED") issues.unshift("Trading runtime faulted");

  const anyDown = services.some(([, health]) => health === "DOWN");
  const anyDegraded = services.some(([, health]) => health === "DEGRADED");
  const overall: ServiceHealth = input.mode === "FAULTED" || input.killSwitchActive || anyDown ? "DOWN" : anyDegraded ? "DEGRADED" : "HEALTHY";
  const tradingAllowed = input.mode === "PAPER" && overall === "HEALTHY";

  let nextAction: OperationalSnapshot["nextAction"] = "NONE";
  if (input.mode === "FAULTED" || anyDown) nextAction = "EMERGENCY_STOP";
  else if (input.killSwitchActive || input.mode === "STOPPED") nextAction = "CHECK_SYSTEM";
  else if (anyDegraded) nextAction = "WAIT";

  const headline = overall === "HEALTHY"
    ? "DOKKAEBI is operating normally"
    : overall === "DEGRADED"
      ? "DOKKAEBI is operating cautiously"
      : "DOKKAEBI has stopped trading for safety";

  return Object.freeze({
    overall,
    tradingAllowed,
    headline,
    issues: Object.freeze(issues),
    nextAction,
    generatedAt: input.now
  });
}
