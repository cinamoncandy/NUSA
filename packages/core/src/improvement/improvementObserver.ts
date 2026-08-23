import { EventBus, type Subscription } from "../eventBus";
import { ImprovementBacklog } from "./improvementBacklog";
import { detectImprovementSignal, validateImprovementObserverPolicy } from "./problemDetector";
import {
  DEFAULT_IMPROVEMENT_OBSERVER_POLICY,
  type ImprovementDiagnosticsEvent,
  type ImprovementCandidateMemory,
  type ImprovementEventMap,
  type ImprovementObservationResult,
  type ImprovementObserverPolicy,
  type ImprovementSignal
} from "./improvementTypes";

export class ImprovementObserver {
  private readonly backlog: ImprovementBacklog;
  private readonly signalHistory: ImprovementSignal[] = [];
  private persistenceAvailable = true;

  constructor(private readonly policy: ImprovementObserverPolicy = DEFAULT_IMPROVEMENT_OBSERVER_POLICY, private readonly memory?: ImprovementCandidateMemory) {
    if (validateImprovementObserverPolicy(policy).length > 0) throw new Error("invalid improvement observer policy");
    this.backlog = new ImprovementBacklog(policy);
    if (memory != null) {
      try { for (const history of memory.load()) this.backlog.restore(history); }
      catch { this.persistenceAvailable = false; }
    }
  }

  observe(event: ImprovementDiagnosticsEvent): ImprovementObservationResult {
    const signal = detectImprovementSignal(event.diagnostics, event.observedAt, this.policy);
    if (signal === null) {
      return { signal: null, candidate: null, reason: "BELOW_THRESHOLD" };
    }
    this.signalHistory.push(signal);
    while (this.signalHistory.length > this.policy.maxSignals) this.signalHistory.shift();
    if (this.memory != null && !this.persistenceAvailable) return { signal, candidate: null, reason: "PERSISTENCE_UNAVAILABLE" };
    const candidate = this.backlog.record(signal);
    if (this.memory != null && this.persistenceAvailable) {
      try {
        const history = this.backlog.history(signal.fingerprint);
        if (history == null) throw new Error("improvement history missing after record");
        this.memory.save(history);
      } catch { this.persistenceAvailable = false; return { signal, candidate: null, reason: "PERSISTENCE_UNAVAILABLE" }; }
    }
    return { signal, candidate };
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

  histories() { return this.backlog.histories(); }

  persistenceStatus(): "AVAILABLE" | "UNAVAILABLE" | "DISABLED" { return this.memory == null ? "DISABLED" : this.persistenceAvailable ? "AVAILABLE" : "UNAVAILABLE"; }
}
