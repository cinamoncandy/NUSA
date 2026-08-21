import type { PaperScenarioEvent, PaperScenarioRecord } from "../../../cloud/src/paperScenarioEvidenceLedger";

export interface PaperScenarioEventSink { append(event: PaperScenarioEvent): PaperScenarioRecord; }

export class PaperScenarioEvidenceRecorder {
  public constructor(private readonly sink: PaperScenarioEventSink, private readonly sessionId: string) {
    if (!sessionId.trim()) throw new Error("Paper evidence sessionId is required");
  }

  public record(event: Omit<PaperScenarioEvent, "sessionId">): PaperScenarioRecord {
    if (!event.eventId.trim()) throw new Error("Paper evidence eventId is required");
    return this.sink.append(Object.freeze({ ...event, sessionId: this.sessionId }));
  }
  public bind(event: Omit<PaperScenarioEvent, "sessionId">): PaperScenarioEvent { return Object.freeze({ ...event, sessionId: this.sessionId }); }

  public sessionObserved(eventId: string, occurredAt: number): PaperScenarioRecord { return this.record({ eventId, type: "SESSION_OBSERVED", occurredAt }); }
  public orderCompleted(eventId: string, occurredAt: number): PaperScenarioRecord { return this.record({ eventId, type: "ORDER_COMPLETED", occurredAt }); }
  public regimeObserved(eventId: string, occurredAt: number, scenario: string): PaperScenarioRecord { return this.record({ eventId, type: "REGIME_OBSERVED", occurredAt, scenario }); }
  public recoveryCompleted(eventId: string, occurredAt: number): PaperScenarioRecord { return this.record({ eventId, type: "RECOVERY_COMPLETED", occurredAt }); }
  public duplicateOrderChecked(eventId: string, occurredAt: number): PaperScenarioRecord { return this.record({ eventId, type: "DUPLICATE_ORDER_CHECKED", occurredAt }); }
  public faultScenarioPassed(eventId: string, occurredAt: number, scenario: string): PaperScenarioRecord { return this.record({ eventId, type: "FAULT_SCENARIO_PASSED", occurredAt, scenario }); }
}
