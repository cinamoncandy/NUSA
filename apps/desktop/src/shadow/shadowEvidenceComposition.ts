import { ShadowEvidenceBus, DurableEvidenceSink, InMemoryEvidenceSink, type ShadowEvidenceHaltReason, type DurableEvidenceWriter } from "../shadow/shadowEvidenceBus";
import { ShadowEvidenceArchive } from "./shadowEvidenceArchive";
import type { ShadowPilotSession } from "./shadowPilotRuntime";
import type { ShadowCompletionEvidence } from "./shadowCompletionEvidence";
import type { MarketConnectionEvidence } from "../exchange/marketConnectionEvidence";

/**
 * The identity every archive written by this process carries. These are the same values the
 * Shadow runtime stamps on its own events, passed in rather than re-derived, so the archive
 * can never disagree with the events it stores.
 */
export interface ShadowEvidenceCompositionOptions {
  readonly root: string;
  readonly sourceCommitSha: string;
  readonly symbol: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly fingerprints: ShadowPilotSession["fingerprints"];
}

/**
 * Builds the `createEvidenceBus` dependency the Shadow runtime asks for.
 *
 * This lives in its own module, rather than inline in main.ts, so the composition the real
 * application uses is the same one the tests drive. A wiring asserted only by reading main.ts
 * as text can be right in shape and still broken in behaviour.
 *
 * One bus, one archive, one session. The runtime calls this once per started session, so a
 * halted bus is never reused and a previous session's queue can never leak into a new one.
 */
export function createShadowEvidenceBusFactory(
  options: ShadowEvidenceCompositionOptions
): (metadata: Readonly<{ sessionId: string; createdAt: number; onHalt: (reason: ShadowEvidenceHaltReason, detail: string) => void }>) => ShadowEvidenceBus {
  return ({ sessionId, createdAt, onHalt }) => {
    // Creating the archive is asynchronous -- it makes a directory and writes session.json --
    // but the runtime needs the bus synchronously. The sink awaits this same promise before
    // every write, so no event can outrun directory creation, and a creation failure surfaces
    // as a write failure that halts the bus rather than as a silent no-op.
    const archivePromise = ShadowEvidenceArchive.create(options.root, {
      sessionId,
      createdAt,
      sourceCommitSha: options.sourceCommitSha,
      symbol: options.symbol,
      strategyId: options.strategyId,
      strategyVersion: options.strategyVersion,
      controlOrigin: "LOCAL_INTERACTIVE_UI",
      authenticatedOwner: false,
      fingerprints: options.fingerprints
    });
    const writer: DurableEvidenceWriter = {
      append: async (event, receivedAt) => (await archivePromise).append(event, receivedAt),
      finalize: async (reason: string, generatedAt?: number, status?: "COMPLETED" | "ABORTED", completion?: ShadowCompletionEvidence, marketConnection?: MarketConnectionEvidence) => (await archivePromise).finalize(reason, generatedAt, status, completion, marketConnection)
    };
    // The in-memory sink is not the system of record; it refuses a sequence gap, so a
    // disagreement with the durable archive halts the bus instead of being smoothed over.
    return new ShadowEvidenceBus({ sessionId, sinks: [new InMemoryEvidenceSink(), new DurableEvidenceSink(writer)], onHalt });
  };
}
