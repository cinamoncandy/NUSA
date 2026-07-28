import { mkdir } from "node:fs/promises";
import { DomainEventBus, DurableEvidenceSink } from "./domainEventBus";
import { ShadowEvidenceArchive } from "./shadowEvidenceArchive";
import type { ShadowPilotEvent, ShadowPilotSession } from "./shadowPilotRuntime";

/**
 * The identity every archive written by this process carries. These are the same values the
 * Shadow runtime stamps on its own events, passed in rather than re-derived so the archive
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
 * This exists as its own module, rather than inline in main.ts, so the composition the real
 * application uses is the same one the tests drive. A wiring that is only asserted by reading
 * main.ts as text can be correct in shape and still broken in behaviour.
 *
 * One bus, one archive, one session. The runtime calls this once per started session, so a
 * halted bus is never reused and a previous session's queue can never leak into a new one.
 */
export function createShadowEvidenceBusFactory(
  options: ShadowEvidenceCompositionOptions
): (metadata: Readonly<{ sessionId: string; createdAt: number }>) => DomainEventBus {
  return ({ sessionId, createdAt }) => {
    // Creating the archive is asynchronous -- it makes a directory and writes session.json --
    // but the runtime needs the bus synchronously. The sink awaits this same promise before
    // every write, so no event can outrun directory creation, and a creation failure surfaces
    // as a write failure that halts the bus rather than as a silent no-op.
    const pending = mkdir(options.root, { recursive: true }).then(() =>
      ShadowEvidenceArchive.create(options.root, {
        sessionId,
        createdAt,
        sourceCommitSha: options.sourceCommitSha,
        symbol: options.symbol,
        strategyId: options.strategyId,
        strategyVersion: options.strategyVersion,
        controlOrigin: "LOCAL_INTERACTIVE_UI",
        authenticatedOwner: false,
        fingerprints: options.fingerprints
      })
    );
    const writer = {
      append: async (event: ShadowPilotEvent, receivedAt?: number) => (await pending).append(event, receivedAt),
      finalize: async (reason: string, generatedAt?: number, status?: "COMPLETED" | "ABORTED") =>
        (await pending).finalize(reason, generatedAt, status)
    };
    return new DomainEventBus({ sessionId, sinks: [new DurableEvidenceSink(writer)] });
  };
}
