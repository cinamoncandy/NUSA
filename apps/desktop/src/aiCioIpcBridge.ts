import type { AiCioCommandCenterEnvelopeV1 } from "./aiCioCommandCenterAdapter";
import { validateAiCioCommandCenterEnvelope } from "./aiCioCommandCenterAdapter";

export const AI_CIO_SNAPSHOT_CHANNEL = "ai-cio:snapshot";

export interface ReadOnlyIpcRegistrar {
  handle(channel: string, listener: () => unknown): void;
}

export interface AiCioEnvelopeSource {
  current(): AiCioCommandCenterEnvelopeV1 | null;
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
  registrar.handle(AI_CIO_SNAPSHOT_CHANNEL, () => {
    const envelope = source.current();
    if (envelope == null) return null;
    return validateAiCioCommandCenterEnvelope(envelope, now());
  });
}
