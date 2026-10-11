import { createHash } from "node:crypto";

export const MODULE_STAGE_ORDER = Object.freeze([
  "MARKET_DATA",
  "INTELLIGENCE",
  "STRATEGY",
  "DECISION",
  "PORTFOLIO",
  "RISK",
  "EXECUTION",
  "PAPER_ADAPTER",
  "REVIEW",
  "MEMORY"
] as const);

export type ModuleStage = (typeof MODULE_STAGE_ORDER)[number];
export type NonLiveOperatingMode = "PAPER" | "SHADOW";

export const MODULE_TIER_ORDER = Object.freeze(["LEVEL_10", "10X", "10X-S"] as const);
export type ModuleTier = (typeof MODULE_TIER_ORDER)[number];

export const LEVEL_10_CRITERIA = Object.freeze([
  "CANONICAL_ENTRYPOINT",
  "DETERMINISTIC_IO",
  "STRICT_TYPED_CONTRACT",
  "FAIL_CLOSED",
  "IDEMPOTENT_OR_STATE_ISOLATED",
  "OBSERVABLE_EVIDENCE",
  "RECOVERY_PATH",
  "UNIT_TESTED",
  "INTEGRATION_TESTED",
  "ARCHITECTURE_VALIDATED"
] as const);

export type Level10Criterion = (typeof LEVEL_10_CRITERIA)[number];

export interface ModuleExecutionContext {
  readonly traceId: string;
  readonly idempotencyKey: string;
  readonly now: number;
  readonly mode: NonLiveOperatingMode;
}

export interface Level10Module<Input = unknown, Output = unknown> {
  readonly stage: ModuleStage;
  readonly version: "10";
  readonly tier?: ModuleTier;
  readonly execute: (input: Input, context: ModuleExecutionContext) => Output | Promise<Output>;
}

export interface ModuleExecutionEvidence {
  readonly schemaVersion: 1;
  readonly stage: ModuleStage;
  readonly moduleVersion: "10";
  readonly moduleTier: ModuleTier;
  readonly traceId: string;
  readonly idempotencyKey: string;
  readonly mode: NonLiveOperatingMode;
  readonly observedAt: number;
  readonly inputSha256?: string | undefined;
  readonly outputSha256?: string | undefined;
  readonly status: "COMPLETED" | "FAILED_CLOSED";
  readonly error?: string | undefined;
}

export interface ModuleExecutionResult<Output> {
  readonly status: "COMPLETED" | "FAILED_CLOSED";
  readonly output?: Output | undefined;
  readonly evidence: ModuleExecutionEvidence;
}

export interface Level10ModuleDefinition {
  readonly stage: ModuleStage;
  readonly canonicalEntrypoint: string;
  readonly criteria: Readonly<Record<Level10Criterion, boolean>>;
  readonly criterionEvidence: Readonly<Record<Level10Criterion, readonly string[]>>;
  readonly targetTier: ModuleTier;
  readonly certificationMode: "EVIDENCE_GATED";
  readonly rollbackRef: string;
}

function canonicalize(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("module evidence cannot serialize a non-finite number");
    return value;
  }
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (value === undefined) return null;
  if (typeof value === "function" || typeof value === "symbol") throw new Error("module evidence contains an unsupported value");
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error("module evidence cannot serialize a cyclic value");
    seen.add(value);
    const result = value.map((item) => canonicalize(item, seen));
    seen.delete(value);
    return result;
  }
  if (typeof value === "object") {
    if (seen.has(value)) throw new Error("module evidence cannot serialize a cyclic value");
    seen.add(value);
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) result[key] = canonicalize(record[key], seen);
    seen.delete(value);
    return result;
  }
  throw new Error("module evidence contains an unsupported value");
}

export function deterministicSha256(value: unknown): string {
  const canonical = JSON.stringify(canonicalize(value, new Set<object>()));
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function assertContext(context: ModuleExecutionContext): void {
  if (!context.traceId.trim()) throw new Error("traceId is required");
  if (!context.idempotencyKey.trim()) throw new Error("idempotencyKey is required");
  if (!Number.isSafeInteger(context.now) || context.now < 0) throw new Error("now must be a non-negative safe integer");
  if (context.mode !== "PAPER" && context.mode !== "SHADOW") throw new Error("LIVE authority is forbidden for level-10 modules");
}

function normalizeTier(tier: ModuleTier | undefined): ModuleTier {
  const resolved = tier ?? "LEVEL_10";
  if (!MODULE_TIER_ORDER.includes(resolved)) throw new Error(`unsupported module tier: ${resolved}`);
  return resolved;
}

export async function runLevel10Module<Input, Output>(
  module: Level10Module<Input, Output>,
  input: Input,
  context: ModuleExecutionContext
): Promise<ModuleExecutionResult<Output>> {
  let inputSha256: string | undefined;
  let moduleTier: ModuleTier = "LEVEL_10";
  try {
    assertContext(context);
    if (module.version !== "10") throw new Error("module version must be 10");
    moduleTier = normalizeTier(module.tier);
    inputSha256 = deterministicSha256(input);
    const output = await module.execute(input, context);
    if (output === undefined) throw new Error("module output is undefined");
    const outputSha256 = deterministicSha256(output);
    return Object.freeze({
      status: "COMPLETED",
      output,
      evidence: Object.freeze({
        schemaVersion: 1,
        stage: module.stage,
        moduleVersion: "10",
        moduleTier,
        traceId: context.traceId,
        idempotencyKey: context.idempotencyKey,
        mode: context.mode,
        observedAt: context.now,
        inputSha256,
        outputSha256,
        status: "COMPLETED"
      })
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown module failure";
    const safeTraceId = typeof context?.traceId === "string" ? context.traceId : "INVALID";
    const safeIdempotencyKey = typeof context?.idempotencyKey === "string" ? context.idempotencyKey : "INVALID";
    const safeMode = context?.mode === "SHADOW" ? "SHADOW" : "PAPER";
    const safeObservedAt = Number.isSafeInteger(context?.now) && context.now >= 0 ? context.now : 0;
    return Object.freeze({
      status: "FAILED_CLOSED",
      evidence: Object.freeze({
        schemaVersion: 1,
        stage: module.stage,
        moduleVersion: "10",
        moduleTier,
        traceId: safeTraceId,
        idempotencyKey: safeIdempotencyKey,
        mode: safeMode,
        observedAt: safeObservedAt,
        inputSha256,
        status: "FAILED_CLOSED",
        error: message
      })
    });
  }
}

export function assertLevel10Definition(definition: Level10ModuleDefinition): void {
  if (!definition.canonicalEntrypoint.trim()) throw new Error(`${definition.stage} canonical entrypoint is required`);
  if (!definition.rollbackRef.trim()) throw new Error(`${definition.stage} rollback ref is required`);
  if (definition.certificationMode !== "EVIDENCE_GATED") throw new Error(`${definition.stage} certification must be evidence-gated`);
  if (!MODULE_TIER_ORDER.includes(definition.targetTier)) throw new Error(`${definition.stage} target tier is invalid`);
  for (const criterion of LEVEL_10_CRITERIA) {
    if (definition.criteria[criterion] !== true) throw new Error(`${definition.stage} is not level-10: ${criterion}`);
    const refs = definition.criterionEvidence[criterion];
    if (!refs || refs.length === 0 || refs.some((ref) => !ref.trim())) {
      throw new Error(`${definition.stage} criterion lacks evidence: ${criterion}`);
    }
  }
}
