export type RuntimeStageStatus = "SUCCESS" | "BLOCKED" | "FAILED" | "SKIPPED";

export interface RuntimeContext {
  readonly runId: string;
  readonly paperSessionId: string;
  readonly startedAt: number;
  readonly killSwitchActive: boolean;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface RuntimeStageResult {
  readonly stage: string;
  readonly status: Exclude<RuntimeStageStatus, "SKIPPED">;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly durationMs: number;
  readonly reason?: string;
  readonly output?: Readonly<Record<string, unknown>>;
}

export interface RuntimeStage {
  readonly name: string;
  execute(context: RuntimeContext): RuntimeStageResult | Promise<RuntimeStageResult>;
}

export interface RuntimeRunRecord {
  readonly runId: string;
  readonly status: "SUCCESS" | "BLOCKED" | "FAILED";
  readonly startedAt: number;
  readonly completedAt: number;
  readonly stages: readonly RuntimeStageResult[];
  readonly skippedStages: readonly string[];
  readonly killSwitchRecommended: boolean;
}

export interface RuntimeRecorder {
  append(record: RuntimeRunRecord): void;
}

const assertTime = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
};

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
};

const clonePlain = <T>(value: T): T => {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("runtime result is not serializable");
  return JSON.parse(serialized) as T;
};

const validateStageResult = (expectedStage: string, result: RuntimeStageResult): RuntimeStageResult => {
  if (result.stage !== expectedStage) throw new Error(`runtime stage mismatch: expected ${expectedStage}`);
  if (result.status !== "SUCCESS" && result.status !== "BLOCKED" && result.status !== "FAILED") {
    throw new Error(`invalid runtime stage status for ${expectedStage}`);
  }
  assertTime(result.startedAt, `${expectedStage}.startedAt`);
  assertTime(result.completedAt, `${expectedStage}.completedAt`);
  assertTime(result.durationMs, `${expectedStage}.durationMs`);
  if (result.completedAt < result.startedAt) throw new Error(`${expectedStage} completed before it started`);
  if (result.durationMs !== result.completedAt - result.startedAt) throw new Error(`${expectedStage} duration mismatch`);
  if (result.status !== "SUCCESS" && (!result.reason || result.reason.trim().length === 0)) {
    throw new Error(`${expectedStage} must provide a reason when not successful`);
  }
  return deepFreeze(clonePlain(result));
};

export class InMemoryRuntimeRecorder implements RuntimeRecorder {
  private readonly records: RuntimeRunRecord[] = [];

  append(record: RuntimeRunRecord): void {
    if (this.records.some((existing) => existing.runId === record.runId)) throw new Error(`duplicate runtime runId: ${record.runId}`);
    this.records.push(deepFreeze(clonePlain(record)));
  }

  all(): readonly RuntimeRunRecord[] {
    return deepFreeze(clonePlain(this.records));
  }
}

export class RuntimeOrchestrator {
  constructor(
    private readonly stages: readonly RuntimeStage[],
    private readonly recorder: RuntimeRecorder
  ) {
    if (stages.length === 0) throw new Error("runtime orchestrator requires at least one stage");
    const names = stages.map((stage) => stage.name);
    if (names.some((name) => name.trim().length === 0)) throw new Error("runtime stage name is required");
    if (new Set(names).size !== names.length) throw new Error("runtime stage names must be unique");
  }

  async run(context: RuntimeContext, now: () => number = Date.now): Promise<RuntimeRunRecord> {
    if (!context.runId.trim()) throw new Error("runId is required");
    if (!context.paperSessionId.trim()) throw new Error("paperSessionId is required");
    assertTime(context.startedAt, "startedAt");

    const results: RuntimeStageResult[] = [];
    let terminal: "SUCCESS" | "BLOCKED" | "FAILED" = "SUCCESS";
    let stopIndex = this.stages.length;

    if (context.killSwitchActive) {
      terminal = "BLOCKED";
      stopIndex = 0;
    } else {
      for (let index = 0; index < this.stages.length; index += 1) {
        const stage = this.stages[index];
        try {
          const result = validateStageResult(stage.name, await stage.execute(context));
          results.push(result);
          if (result.status === "BLOCKED" || result.status === "FAILED") {
            terminal = result.status;
            stopIndex = index + 1;
            break;
          }
        } catch (error) {
          const timestamp = now();
          assertTime(timestamp, "now");
          const failed = deepFreeze({
            stage: stage.name,
            status: "FAILED" as const,
            startedAt: timestamp,
            completedAt: timestamp,
            durationMs: 0,
            reason: error instanceof Error ? error.message : String(error)
          });
          results.push(failed);
          terminal = "FAILED";
          stopIndex = index + 1;
          break;
        }
      }
    }

    const completedAt = now();
    assertTime(completedAt, "completedAt");
    if (completedAt < context.startedAt) throw new Error("runtime completed before it started");

    const record = deepFreeze({
      runId: context.runId,
      status: terminal,
      startedAt: context.startedAt,
      completedAt,
      stages: results,
      skippedStages: this.stages.slice(stopIndex).map((stage) => stage.name),
      killSwitchRecommended: terminal === "FAILED"
    } satisfies RuntimeRunRecord);

    this.recorder.append(record);
    return record;
  }
}
