import { type AiCioDashboardReadResult } from "../../../../packages/contracts/src/aiCioDashboard";
import type { AiCioCommandCenterEnvelopeV1 } from "./aiCioCommandCenterAdapter";
import { validateAiCioCommandCenterEnvelope } from "./aiCioCommandCenterAdapter";

export interface AiCioEnvelopeSource {
  current(): AiCioCommandCenterEnvelopeV1 | null;
}

const freeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
};

export class AiCioDashboardService {
  constructor(private readonly source: AiCioEnvelopeSource, private readonly now: () => number = Date.now) {}

  getAiCioDashboard(): AiCioDashboardReadResult<AiCioCommandCenterEnvelopeV1> {
    try {
      const envelope = this.source.current();
      if (envelope == null) return freeze({ ok: false, status: "NO_DATA", message: "AI CIO dashboard is not available" as const });
      return freeze({ ok: true, snapshot: validateAiCioCommandCenterEnvelope(envelope, this.now()) });
    } catch {
      return freeze({ ok: false, status: "UNAVAILABLE", message: "AI CIO dashboard is not available" as const });
    }
  }
}
