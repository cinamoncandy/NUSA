import { AI_CIO_DASHBOARD_CHANNEL } from "../../../../packages/contracts/src/aiCioDashboard";
import type { AiCioCommandCenterEnvelopeV1 } from "./aiCioCommandCenterAdapter";
import { validateAiCioCommandCenterEnvelope } from "./aiCioCommandCenterAdapter";
import { AiCioDashboardService, type AiCioEnvelopeSource } from "./aiCioDashboardService";
export type { AiCioEnvelopeSource } from "./aiCioDashboardService";

export const AI_CIO_SNAPSHOT_CHANNEL = AI_CIO_DASHBOARD_CHANNEL;

export interface ReadOnlyIpcRegistrar {
  handle(channel: string, listener: () => unknown): void;
}

export class InMemoryAiCioEnvelopeSource implements AiCioEnvelopeSource {
  private envelope: AiCioCommandCenterEnvelopeV1 | null = null;

  publish(envelope: AiCioCommandCenterEnvelopeV1): void {
    this.envelope = validateAiCioCommandCenterEnvelope(envelope, Date.now());
  }

  clear(): void {
    this.envelope = null;
  }

  current(): AiCioCommandCenterEnvelopeV1 | null {
    return this.envelope;
  }
}

export function registerAiCioReadOnlyIpc(
  registrar: ReadOnlyIpcRegistrar,
  source: AiCioEnvelopeSource,
  now: () => number = Date.now
): void {
  const service = new AiCioDashboardService(source, now);
  registrar.handle(AI_CIO_SNAPSHOT_CHANNEL, () => service.getAiCioDashboard());
}
