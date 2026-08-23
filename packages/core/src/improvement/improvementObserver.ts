import { EventBus, type Subscription } from "../eventBus";
import { ImprovementBacklog } from "./improvementBacklog";
import { detectImprovementSignal, validateImprovementObserverPolicy } from "./problemDetector";
import {
  DEFAULT_IMPROVEMENT_OBSERVER_POLICY,
  type ImprovementDiagnosticsEvent,
  type ImprovementEventMap,
  type ImprovementObservationResult,
  type ImprovementObserverPolicy,
  type ImprovementSignal
} from "./improvementTypes";

export class ImprovementObserver {
  private readonly backlog: ImprovementBacklog;
  private readonly signalHistory: ImprovementSignal[] = [];

  constructor(private readonly policy: ImprovementObserverPolicy = DEFAULT_IMPROVEMENT_OBSERVER_POLICY) {
    if (validateImprovementObserverPolicy(policy).length > 0) throw new Error("invalid improvement observer policy");
    this.backlog = new ImprovementBacklog(policy);
  }

  observe(event: ImprovementDiagnosticsEvent): ImprovementObservationResult {
    const signal = detectImprovementSignal(event.diagnostics, event.observedAt, this.policy);
    if (signal === null) {
      return { signal: null, candidate: null, reason: "BELOW_THRESHOLD" };
    }
    this.signalHistory.push(signal);
    while (this.signalHistory.length > this.policy.maxSignals) this.signalHistory.shift();
    return { signal, candidate: this.backlog.record(signal) };
  }

  attach(events: EventBus<ImprovementEventMap>): Subscription {
    return events.subscribe("market.connection.diagnostics", async (event) => {
      const result = this.observe(event);
      if (result.signal !== null) await events.publish("improvement.signal", result.signal);
      if (result.candidate !== null) await events.publish("improvement.candidate", result.candidate);
    });
  }

  signals(): readonly ImprovementSignal[] { return Object.freeze([...this.signalHistory]); }

  candidates() { return this.backlog.candidates(); }
}
