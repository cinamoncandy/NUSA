import type { AiCioCommandCenterEnvelopeV1 } from "./aiCioCommandCenterAdapter";
import { buildDecisionSnapshot, type DecisionReadResult } from "./decisionSnapshot";

export class DecisionSnapshotService {
  constructor(private readonly source: { current(): AiCioCommandCenterEnvelopeV1 | null }, private readonly now: () => number = Date.now) {}
  get(): DecisionReadResult {
    try {
      const envelope = this.source.current();
      return envelope == null ? { ok: false, status: "NO_DATA", message: "Decision data is not available" } : { ok: true, snapshot: buildDecisionSnapshot(envelope, this.now()) };
    } catch {
      return { ok: false, status: "UNAVAILABLE", message: "Decision data is not available" };
    }
  }
}
