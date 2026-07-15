export type PaperFaultScenario = "PERSISTENCE_FAILURE" | "PARTIAL_WRITE";

export interface PaperFaultDrillState {
  readonly runtime: unknown;
  readonly persistedOrderIds: readonly string[];
  readonly persistedSignalKeys: readonly string[];
  readonly strategyStatus: "RUNNING" | "STOPPED";
  readonly autoTradeEnabled: boolean;
  readonly controlState: "RUNNING" | "STOPPED" | "FAULTED";
}

export interface PaperFaultDrillHooks {
  snapshot(): PaperFaultDrillState;
  injectFault(scenario: PaperFaultScenario): void;
  restore(state: PaperFaultDrillState): void;
  stopStrategy(): void;
  disableAutoTrade(): void;
  faultControlPlane(): void;
  isCommandBlocked(): boolean;
}

export interface PaperFaultDrillResult {
  readonly scenario: PaperFaultScenario;
  readonly status: "PASS" | "FAIL";
  readonly errorObserved: boolean;
  readonly rollbackVerified: boolean;
  readonly noPartialPersistenceVerified: boolean;
  readonly strategyStopped: boolean;
  readonly autoTradeDisabled: boolean;
  readonly controlFaulted: boolean;
  readonly commandsBlocked: boolean;
}

const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

export function runPaperFaultDrill(scenario: PaperFaultScenario, hooks: PaperFaultDrillHooks): PaperFaultDrillResult {
  const before = hooks.snapshot();
  let errorObserved = false;
  try {
    hooks.injectFault(scenario);
  } catch {
    errorObserved = true;
  }
  if (!errorObserved) return result(scenario, false, false, false, false, false, false, false);
  hooks.restore(before);
  hooks.stopStrategy();
  hooks.disableAutoTrade();
  hooks.faultControlPlane();
  const after = hooks.snapshot();
  const rollbackVerified = same(after.runtime, before.runtime);
  const noPartialPersistenceVerified = same(after.persistedOrderIds, before.persistedOrderIds) && same(after.persistedSignalKeys, before.persistedSignalKeys);
  const strategyStopped = after.strategyStatus === "STOPPED";
  const autoTradeDisabled = after.autoTradeEnabled === false;
  const controlFaulted = after.controlState === "FAULTED";
  const commandsBlocked = hooks.isCommandBlocked();
  return result(scenario, errorObserved, rollbackVerified, noPartialPersistenceVerified, strategyStopped, autoTradeDisabled, controlFaulted, commandsBlocked);
}

function result(scenario: PaperFaultScenario, errorObserved: boolean, rollbackVerified: boolean, noPartialPersistenceVerified: boolean, strategyStopped: boolean, autoTradeEnabled: boolean, controlFaulted: boolean, commandsBlocked: boolean): PaperFaultDrillResult {
  return Object.freeze({ scenario, status: errorObserved && rollbackVerified && noPartialPersistenceVerified && strategyStopped && !autoTradeEnabled && controlFaulted && commandsBlocked ? "PASS" as const : "FAIL" as const, errorObserved, rollbackVerified, noPartialPersistenceVerified, strategyStopped, autoTradeDisabled: !autoTradeEnabled, controlFaulted, commandsBlocked });
}
