import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type AutonomousTaskStatus = "queued" | "running" | "blocked" | "completed" | "cancelled";

export interface AutonomousSafetyPolicy {
  readonly mode: "PAPER_ONLY";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

export const SAFE_AUTONOMOUS_POLICY: AutonomousSafetyPolicy = {
  mode: "PAPER_ONLY",
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  aiAuthority: "ZERO_AUTHORITY",
};

export interface AutonomousCorrection {
  readonly id: string;
  readonly instruction: string;
  readonly createdAt: string;
}

export interface AutonomousTask {
  readonly id: string;
  readonly workOrderId: string;
  readonly priority: number;
  readonly enqueuedAt: string;
  readonly status: AutonomousTaskStatus;
  readonly dependencies: readonly string[];
  readonly corrections: readonly AutonomousCorrection[];
  readonly workerId?: string;
  readonly leaseExpiresAt?: string;
  readonly completionEvidenceIds?: readonly string[];
  readonly blockReason?: string;
}

export interface AutonomousWorkState {
  readonly version: 1;
  readonly frozen: boolean;
  readonly freezeReason?: string;
  readonly tasks: readonly AutonomousTask[];
  readonly updatedAt: string;
}

export interface AutonomousWorkStore {
  load(): Promise<AutonomousWorkState>;
  save(state: AutonomousWorkState): Promise<void>;
}

export class JsonAutonomousWorkStore implements AutonomousWorkStore {
  constructor(private readonly path: string, private readonly initialState: AutonomousWorkState) {}

  async load(): Promise<AutonomousWorkState> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as AutonomousWorkState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return this.initialState;
      throw error;
    }
  }

  async save(state: AutonomousWorkState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.path);
  }
}

export class InMemoryAutonomousWorkStore implements AutonomousWorkStore {
  constructor(private state: AutonomousWorkState) {}
  async load(): Promise<AutonomousWorkState> { return this.state; }
  async save(state: AutonomousWorkState): Promise<void> { this.state = state; }
}

export function createAutonomousWorkState(now = new Date()): AutonomousWorkState {
  return { version: 1, frozen: false, tasks: [], updatedAt: now.toISOString() };
}

export type LoopDecision =
  | { readonly kind: "frozen"; readonly reason: string }
  | { readonly kind: "dispatch"; readonly taskId: string }
  | { readonly kind: "waiting"; readonly reason: string }
  | { readonly kind: "idle" };

export class AutonomousWorkController {
  constructor(
    private readonly store: AutonomousWorkStore,
    policy: AutonomousSafetyPolicy = SAFE_AUTONOMOUS_POLICY,
  ) {
    if (
      policy.mode !== "PAPER_ONLY" ||
      policy.liveAuthority !== "NONE" ||
      policy.productionMutationAllowed !== false ||
      policy.aiAuthority !== "ZERO_AUTHORITY"
    ) {
      throw new Error("Autonomous work rejected unsafe authority policy");
    }
  }

  async enqueue(input: {
    id?: string;
    workOrderId: string;
    priority?: number;
    dependencies?: readonly string[];
  }, now = new Date()): Promise<AutonomousTask> {
    const state = await this.store.load();
    const id = input.id ?? randomUUID();
    if (state.tasks.some((task) => task.id === id)) throw new Error(`Duplicate autonomous task: ${id}`);
    const task: AutonomousTask = {
      id,
      workOrderId: input.workOrderId,
      priority: input.priority ?? 0,
      enqueuedAt: now.toISOString(),
      status: "queued",
      dependencies: [...(input.dependencies ?? [])],
      corrections: [],
    };
    await this.persist(state, [...state.tasks, task], now);
    return task;
  }

  async correct(taskId: string, instruction: string, now = new Date()): Promise<AutonomousCorrection> {
    if (!instruction.trim()) throw new Error("Correction instruction must not be empty");
    const state = await this.store.load();
    const correction: AutonomousCorrection = { id: randomUUID(), instruction: instruction.trim(), createdAt: now.toISOString() };
    const tasks = state.tasks.map((task) => task.id === taskId
      ? { ...task, corrections: [...task.corrections, correction] }
      : task);
    if (!tasks.some((task) => task.id === taskId)) throw new Error(`Autonomous task not found: ${taskId}`);
    await this.persist(state, tasks, now);
    return correction;
  }

  async claimNext(workerId: string, leaseMs: number, now = new Date()): Promise<AutonomousTask | undefined> {
    if (!workerId.trim()) throw new Error("Worker id must not be empty");
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error("Lease duration must be positive");
    const recovered = await this.recoverExpiredLeases(now);
    if (recovered.frozen) return undefined;
    const completed = new Set(recovered.tasks.filter((task) => task.status === "completed").map((task) => task.id));
    const candidate = recovered.tasks
      .filter((task) => task.status === "queued")
      .filter((task) => task.dependencies.every((dependency) => completed.has(dependency)))
      .sort(compareTasks)[0];
    if (!candidate) return undefined;
    const claimed: AutonomousTask = {
      ...candidate,
      status: "running",
      workerId,
      leaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString(),
    };
    await this.persist(recovered, recovered.tasks.map((task) => task.id === claimed.id ? claimed : task), now);
    return claimed;
  }

  async complete(taskId: string, workerId: string, evidenceIds: readonly string[], now = new Date()): Promise<void> {
    if (evidenceIds.length === 0) throw new Error("Completion requires durable evidence");
    const state = await this.store.load();
    if (state.frozen) throw new Error(`Autonomous work is frozen: ${state.freezeReason ?? "unspecified"}`);
    const current = requireTask(state, taskId);
    if (current.status !== "running" || current.workerId !== workerId) throw new Error(`Worker does not own running task: ${taskId}`);
    const completed: AutonomousTask = {
      ...current,
      status: "completed",
      workerId: undefined,
      leaseExpiresAt: undefined,
      completionEvidenceIds: [...evidenceIds],
    };
    await this.persist(state, state.tasks.map((task) => task.id === taskId ? completed : task), now);
  }

  async freeze(reason: string, now = new Date()): Promise<void> {
    if (!reason.trim()) throw new Error("Freeze reason must not be empty");
    const state = await this.store.load();
    await this.store.save({ ...state, frozen: true, freezeReason: reason.trim(), updatedAt: now.toISOString() });
  }

  async unfreeze(now = new Date()): Promise<void> {
    const state = await this.store.load();
    await this.store.save({ ...state, frozen: false, freezeReason: undefined, updatedAt: now.toISOString() });
  }

  async recoverExpiredLeases(now = new Date()): Promise<AutonomousWorkState> {
    const state = await this.store.load();
    let changed = false;
    const tasks = state.tasks.map((task) => {
      if (task.status !== "running" || !task.leaseExpiresAt || Date.parse(task.leaseExpiresAt) > now.getTime()) return task;
      changed = true;
      return { ...task, status: "queued" as const, workerId: undefined, leaseExpiresAt: undefined };
    });
    if (!changed) return state;
    const next = { ...state, tasks, updatedAt: now.toISOString() };
    await this.store.save(next);
    return next;
  }

  async decideNext(now = new Date()): Promise<LoopDecision> {
    const state = await this.recoverExpiredLeases(now);
    if (state.frozen) return { kind: "frozen", reason: state.freezeReason ?? "unspecified" };
    const completed = new Set(state.tasks.filter((task) => task.status === "completed").map((task) => task.id));
    const candidate = state.tasks
      .filter((task) => task.status === "queued")
      .filter((task) => task.dependencies.every((dependency) => completed.has(dependency)))
      .sort(compareTasks)[0];
    if (candidate) return { kind: "dispatch", taskId: candidate.id };
    if (state.tasks.some((task) => task.status === "running" || task.status === "queued" || task.status === "blocked")) {
      return { kind: "waiting", reason: "No dependency-ready task is currently dispatchable" };
    }
    return { kind: "idle" };
  }

  private async persist(state: AutonomousWorkState, tasks: readonly AutonomousTask[], now: Date): Promise<void> {
    await this.store.save({ ...state, tasks, updatedAt: now.toISOString() });
  }
}

function requireTask(state: AutonomousWorkState, taskId: string): AutonomousTask {
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error(`Autonomous task not found: ${taskId}`);
  return task;
}

function compareTasks(left: AutonomousTask, right: AutonomousTask): number {
  return right.priority - left.priority || left.enqueuedAt.localeCompare(right.enqueuedAt) || left.id.localeCompare(right.id);
}
