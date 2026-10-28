/**
 * Display only: raises an alarm when the same learning-pipeline stop code persists past a bound, so a stall such as
 * "every order intent fails" (2026-10-18..27, 4824 of 4824) or "research candles stale" is surfaced by the runtime itself
 * instead of being found by hand days later. Input is the learningPipeline projection (fixed codes); output is fixed codes
 * and integers. It never changes execution, risk or research, and an alarm is not a fix.
 */
import type { LearningPipelineProjection } from "./learningPipelineStage";

export const LEARNING_PIPELINE_ALARM_BOUND_MS = 6 * 60 * 60_000;

export interface LearningPipelineAlarmEntry {
  /** The current non-PASS code, or PASS. */
  readonly code: string;
  /** When this exact code was first seen in the current unbroken run; absent while PASS. */
  readonly sinceMs?: number;
  readonly alarm: boolean;
}

export interface LearningPipelineAlarmSnapshot {
  readonly boundMs: number;
  readonly trading: LearningPipelineAlarmEntry;
  readonly research: LearningPipelineAlarmEntry;
  readonly learning: LearningPipelineAlarmEntry;
}

type Branch = "trading" | "research" | "learning";
const BRANCHES: readonly Branch[] = ["trading", "research", "learning"];

export class LearningPipelineAlarmTracker {
  private readonly since = new Map<Branch, { code: string; at: number; alarmed: boolean }>();

  public constructor(
    private readonly boundMs: number = LEARNING_PIPELINE_ALARM_BOUND_MS,
    private readonly log: (line: string) => void = (line) => { process.stderr.write(`${line}\n`); },
  ) {}

  /** Feeds one projection observed at `now` and returns the alarm state. Never throws into the caller. */
  public update(projection: LearningPipelineProjection, now: number): LearningPipelineAlarmSnapshot {
    const codes: Record<Branch, string> = { trading: projection.trading.code, research: projection.research.code, learning: projection.learning };
    const entries = {} as Record<Branch, LearningPipelineAlarmEntry>;
    for (const branch of BRANCHES) {
      const code = codes[branch];
      const previous = this.since.get(branch);
      if (code === "PASS") {
        if (previous?.alarmed) this.emit(`[learning-pipeline-alarm] ${branch.toUpperCase()} CLEARED`);
        this.since.delete(branch);
        entries[branch] = Object.freeze({ code, alarm: false });
        continue;
      }
      const current = previous !== undefined && previous.code === code ? previous : { code, at: now, alarmed: false };
      if (previous?.alarmed && previous.code !== code) this.emit(`[learning-pipeline-alarm] ${branch.toUpperCase()} CLEARED`);
      const alarm = now - current.at >= this.boundMs;
      if (alarm && !current.alarmed) this.emit(`[learning-pipeline-alarm] ${branch.toUpperCase()} ${code} sinceMs=${current.at}`);
      this.since.set(branch, { ...current, alarmed: alarm });
      entries[branch] = Object.freeze({ code, sinceMs: current.at, alarm });
    }
    return Object.freeze({ boundMs: this.boundMs, ...entries });
  }

  private emit(line: string): void {
    try { this.log(line); } catch { /* display only */ }
  }
}
