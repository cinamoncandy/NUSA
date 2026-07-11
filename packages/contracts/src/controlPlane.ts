export type ControlCommandType = "PAUSE" | "EMERGENCY_STOP" | "RESUME_PAPER";
export type ControlAuthStrength = "SESSION" | "STRONG";
export type ControlDecisionStatus = "ACCEPTED" | "REJECTED" | "DUPLICATE";

export interface ControlCommandRequest {
  readonly id: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly type: ControlCommandType;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly authStrength: ControlAuthStrength;
  readonly reason: string;
}

export interface ControlRuntimeSnapshot {
  readonly mode: "PAPER" | "STOPPED" | "FAULTED";
  readonly killSwitchActive: boolean;
  readonly healthy: boolean;
  readonly lastAcceptedCommandAt?: number;
}

export interface ControlAuditEvent {
  readonly commandId: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly type: ControlCommandType;
  readonly status: ControlDecisionStatus;
  readonly decidedAt: number;
  readonly reason: string;
  readonly resultingMode: ControlRuntimeSnapshot["mode"];
  readonly cancelOpenOrders: boolean;
}

export interface ControlCommandResult {
  readonly status: ControlDecisionStatus;
  readonly runtime: ControlRuntimeSnapshot;
  readonly audit: ControlAuditEvent;
}
