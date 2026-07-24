export enum WebSocketRecoveryStatus {
  SYNCHRONIZED = "SYNCHRONIZED",
  GAP_DETECTED = "GAP_DETECTED",
  SNAPSHOT_REQUIRED = "SNAPSHOT_REQUIRED",
  RECOVERING = "RECOVERING",
  UNSAFE = "UNSAFE"
}

export interface SequencedStreamEvent {
  readonly eventId: string;
  readonly firstSequence: bigint;
  readonly finalSequence: bigint;
  readonly previousFinalSequence?: bigint;
}

export interface StreamRecoveryState {
  readonly status: WebSocketRecoveryStatus;
  readonly lastAppliedSequence?: bigint;
  readonly gapDetectedAtSequence?: bigint;
  readonly snapshotSequence?: bigint;
}

export interface StreamRecoveryDecision {
  readonly state: StreamRecoveryState;
  readonly applyEvent: boolean;
  readonly requestSnapshot: boolean;
  readonly reason?: string;
}

function assertEvent(event: SequencedStreamEvent): void {
  if (event.eventId.trim() === "") throw new Error("eventId is required");
  if (event.firstSequence < 0n || event.finalSequence < event.firstSequence) throw new Error("event sequence range is invalid");
  if (event.previousFinalSequence != null && event.previousFinalSequence < 0n) throw new Error("previousFinalSequence is invalid");
}

export function applySequencedEvent(state: StreamRecoveryState, event: SequencedStreamEvent): StreamRecoveryDecision {
  assertEvent(event);
  if (state.status === WebSocketRecoveryStatus.UNSAFE || state.status === WebSocketRecoveryStatus.SNAPSHOT_REQUIRED || state.status === WebSocketRecoveryStatus.GAP_DETECTED) {
    return Object.freeze({ state, applyEvent: false, requestSnapshot: true, reason: "stream requires snapshot recovery before events can be applied" });
  }
  if (state.status === WebSocketRecoveryStatus.RECOVERING) {
    return Object.freeze({ state, applyEvent: false, requestSnapshot: false, reason: "recovery snapshot has not been committed" });
  }
  if (state.lastAppliedSequence == null) {
    return Object.freeze({ state: Object.freeze({ status: WebSocketRecoveryStatus.SYNCHRONIZED, lastAppliedSequence: event.finalSequence }), applyEvent: true, requestSnapshot: false });
  }
  if (event.finalSequence <= state.lastAppliedSequence) {
    return Object.freeze({ state, applyEvent: false, requestSnapshot: false, reason: "duplicate or stale event" });
  }
  const expected = state.lastAppliedSequence + 1n;
  const continuityBroken = event.firstSequence > expected || (event.previousFinalSequence != null && event.previousFinalSequence !== state.lastAppliedSequence);
  if (continuityBroken) {
    return Object.freeze({
      state: Object.freeze({ status: WebSocketRecoveryStatus.GAP_DETECTED, lastAppliedSequence: state.lastAppliedSequence, gapDetectedAtSequence: expected }),
      applyEvent: false,
      requestSnapshot: true,
      reason: "sequence gap detected"
    });
  }
  if (event.finalSequence < expected) return Object.freeze({ state, applyEvent: false, requestSnapshot: false, reason: "event does not advance stream" });
  return Object.freeze({ state: Object.freeze({ status: WebSocketRecoveryStatus.SYNCHRONIZED, lastAppliedSequence: event.finalSequence }), applyEvent: true, requestSnapshot: false });
}

export function beginSnapshotRecovery(state: StreamRecoveryState): StreamRecoveryState {
  if (state.status !== WebSocketRecoveryStatus.GAP_DETECTED && state.status !== WebSocketRecoveryStatus.SNAPSHOT_REQUIRED) throw new Error("snapshot recovery requires a detected gap");
  return Object.freeze({ ...state, status: WebSocketRecoveryStatus.RECOVERING });
}

export function commitRecoverySnapshot(state: StreamRecoveryState, snapshotSequence: bigint): StreamRecoveryState {
  if (state.status !== WebSocketRecoveryStatus.RECOVERING) throw new Error("stream is not recovering");
  if (snapshotSequence < 0n) throw new Error("snapshotSequence is invalid");
  if (state.lastAppliedSequence != null && snapshotSequence < state.lastAppliedSequence) throw new Error("recovery snapshot regresses sequence");
  return Object.freeze({ status: WebSocketRecoveryStatus.SYNCHRONIZED, lastAppliedSequence: snapshotSequence, snapshotSequence });
}

export function markStreamUnsafe(state: StreamRecoveryState): StreamRecoveryState {
  return Object.freeze({ ...state, status: WebSocketRecoveryStatus.UNSAFE });
}
