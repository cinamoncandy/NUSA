import { createHash } from "node:crypto";

/**
 * A5 - the supersession registry.
 *
 * Learning decisions are immutable history. When a later cycle changes a surface that an earlier
 * decision already changed, the earlier decision is not edited, replaced, or removed; a successor
 * decision is appended and a link records that it superseded its predecessor. The record of what was
 * thought, decided, and applied stays intact, so a receipt from three cycles ago still reads exactly
 * as it did then.
 *
 * The property that makes this safe rather than merely tidy is **fork detection**. If one predecessor
 * on one surface acquires two different successors, the history no longer says which change took
 * effect. That is not a tie to break by timestamp, and silently keeping the newer one would discard
 * the fact that two successors were ever produced. Such a fork is refused outright and reported as a
 * conflict, so the only way to get a successor recorded is for the surface to have exactly one
 * successor lineage.
 *
 * There is deliberately no update path, no delete path, and no re-parenting. Links are derived from
 * content, so an edited link stops matching its own identity and replay fails closed rather than
 * reading back as a plausible history (v2 sections 23-24).
 */

export const SUPERSESSION_SCHEMA_VERSION = 1;
export const SUPERSESSION_POLICY_VERSION = "supersession-v1";

export class SupersessionError extends Error {
  public constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SupersessionError";
  }
}

export interface SupersessionLinkInput {
  readonly surface: string;
  readonly previousDecisionFingerprint: string;
  readonly nextDecisionFingerprint: string;
  readonly reason: string;
  readonly timestamp: string;
}

export interface SupersessionLink {
  readonly schemaVersion: typeof SUPERSESSION_SCHEMA_VERSION;
  readonly surface: string;
  readonly previousDecisionFingerprint: string;
  readonly nextDecisionFingerprint: string;
  readonly reason: string;
  readonly timestamp: string;
  readonly linkFingerprint: string;
  readonly supersessionPolicyVersion: typeof SUPERSESSION_POLICY_VERSION;
}

const SHA64 = /^[a-f0-9]{64}$/;
const BOUNDED = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,1023}$/;
/** A reason is prose, so spaces are allowed; control characters are not, or one reason could render as another. */
const REASON = /^[A-Za-z0-9][A-Za-z0-9 ._,'():;/#&+-]{0,1023}$/;

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new SupersessionError("NON_FINITE_VALUE", "supersession link contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (typeof value === "object") {
    return (
      "{" +
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => JSON.stringify(key) + ":" + canonical(entry))
        .join(",") +
      "}"
    );
  }
  throw new SupersessionError("NON_CANONICAL_VALUE", "supersession link contains a value with no canonical form");
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

/**
 * Builds a supersession link by pure derivation.
 *
 * Exported because the durable adapter and replay paths must be able to reconstruct a link from its
 * recorded fields and verify it still carries the same identity, rather than trusting a stored
 * fingerprint.
 */
export function buildSupersessionLink(input: SupersessionLinkInput): SupersessionLink {
  assertInput(input);
  const base: Omit<SupersessionLink, "linkFingerprint"> = {
    schemaVersion: SUPERSESSION_SCHEMA_VERSION,
    surface: input.surface,
    previousDecisionFingerprint: input.previousDecisionFingerprint,
    nextDecisionFingerprint: input.nextDecisionFingerprint,
    reason: input.reason,
    timestamp: input.timestamp,
    supersessionPolicyVersion: SUPERSESSION_POLICY_VERSION,
  };
  return Object.freeze({ ...base, linkFingerprint: digest(base) });
}

function assertInput(input: SupersessionLinkInput): void {
  if (input == null || typeof input !== "object") throw new SupersessionError("MALFORMED_LINK", "supersession link input is required");
  if (typeof input.surface !== "string" || !BOUNDED.test(input.surface)) throw new SupersessionError("MALFORMED_LINK", "surface must be a bounded identifier");
  if (typeof input.previousDecisionFingerprint !== "string" || !SHA64.test(input.previousDecisionFingerprint)) throw new SupersessionError("MALFORMED_LINK", "previous decision fingerprint must be a SHA-256 digest");
  if (typeof input.nextDecisionFingerprint !== "string" || !SHA64.test(input.nextDecisionFingerprint)) throw new SupersessionError("MALFORMED_LINK", "next decision fingerprint must be a SHA-256 digest");
  if (input.previousDecisionFingerprint === input.nextDecisionFingerprint) throw new SupersessionError("MALFORMED_LINK", "a decision cannot supersede itself");
  if (typeof input.reason !== "string" || !REASON.test(input.reason) || hasControlCharacter(input.reason)) throw new SupersessionError("MALFORMED_LINK", "reason must be a bounded identifier");
  if (typeof input.timestamp !== "string" || !BOUNDED.test(input.timestamp)) throw new SupersessionError("MALFORMED_LINK", "timestamp must be a bounded identifier");
}

/** Fails closed on anything that is not exactly a supersession link. */
export function assertSupersessionLink(value: unknown): asserts value is SupersessionLink {
  if (value == null || typeof value !== "object") throw new SupersessionError("MALFORMED_LINK", "supersession link is required");
  const candidate = value as Partial<SupersessionLink>;
  if (candidate.schemaVersion !== SUPERSESSION_SCHEMA_VERSION) throw new SupersessionError("MALFORMED_LINK", "supersession link schema version is unsupported");
  if (candidate.supersessionPolicyVersion !== SUPERSESSION_POLICY_VERSION) throw new SupersessionError("MALFORMED_LINK", "supersession policy version is unsupported");
  if (typeof candidate.linkFingerprint !== "string" || !SHA64.test(candidate.linkFingerprint)) throw new SupersessionError("MALFORMED_LINK", "link fingerprint is invalid");
  const { linkFingerprint: recorded, ...content } = candidate as SupersessionLink;
  if (digest(content) !== recorded) throw new SupersessionError("IDENTITY_CONFLICT", "supersession link does not match its own fingerprint");
}

/**
 * Append-only store of supersession links.
 *
 * It holds only links: no decision, no receipt, and no application is stored or reachable here, so
 * there is structurally no way to rewrite a decision through this object. Membership is enforced by
 * the two identities a link carries, which is what lets the fork check be exact rather than
 * heuristic.
 */
export class SupersessionRegistry {
  private readonly links: SupersessionLink[] = [];

  /**
   * Records a supersession, refusing a second successor on the same predecessor and surface.
   *
   * A replay of an identical link is idempotent. A *different* successor in the same position is a
   * fork: two claims on what changed that surface, with no honest way to pick between them.
   */
  public supersede(input: SupersessionLinkInput): SupersessionLink {
    const link = buildSupersessionLink(input);

    const existing = this.links.find((candidate) => candidate.previousDecisionFingerprint === input.previousDecisionFingerprint && candidate.surface === input.surface);
    if (existing != null) {
      if (existing.nextDecisionFingerprint !== input.nextDecisionFingerprint) {
        throw new SupersessionError(
          "SUPERSESSION_FORK",
          "decision " + input.previousDecisionFingerprint.slice(0, 12) + " on surface " + input.surface + " already has successor " + existing.nextDecisionFingerprint.slice(0, 12) + "; a second successor is a conflict, not a newer timestamp to prefer",
        );
      }
      if (existing.linkFingerprint !== link.linkFingerprint) {
        throw new SupersessionError("IDENTITY_CONFLICT", "the same predecessor, successor and surface were re-supplied with different content");
      }
      return existing;
    }

    this.links.push(link);
    return link;
  }

  /** Rehydrates durable history, applying the same fork rule on the way in. */
  public rehydrate(links: readonly SupersessionLink[]): number {
    let restored = 0;
    for (const link of links) {
      assertSupersessionLink(link);
      const before = this.links.length;
      this.supersede({
        surface: link.surface,
        previousDecisionFingerprint: link.previousDecisionFingerprint,
        nextDecisionFingerprint: link.nextDecisionFingerprint,
        reason: link.reason,
        timestamp: link.timestamp,
      });
      if (this.links.length > before) restored += 1;
    }
    return restored;
  }

  public all(): readonly SupersessionLink[] {
    return Object.freeze([...this.links]);
  }

  /** The immediate successor on a surface, if any. */
  public successorOf(previousDecisionFingerprint: string, surface: string): SupersessionLink | undefined {
    return this.links.find((link) => link.previousDecisionFingerprint === previousDecisionFingerprint && link.surface === surface);
  }

  /** Successor count for one predecessor on one surface; anything above one is a fork. */
  public successorCount(previousDecisionFingerprint: string, surface: string): number {
    return this.links.filter((link) => link.previousDecisionFingerprint === previousDecisionFingerprint && link.surface === surface).length;
  }

  /**
   * Everything superseded by a given decision, transitively, in chain order.
   *
   * Used by status projection (M2) to report a surface's lineage without ever feeding it back into a
   * decision: this is a read of history, not an input.
   */
  public lineage(startingDecisionFingerprint: string, surface: string): readonly string[] {
    const chain: string[] = [];
    let cursor = startingDecisionFingerprint;
    const guard = new Set<string>([cursor]);
    for (;;) {
      const next = this.successorOf(cursor, surface);
      if (next == null) return Object.freeze(chain);
      if (guard.has(next.nextDecisionFingerprint)) throw new SupersessionError("SUPERSESSION_CYCLE", "supersession lineage cycles back to a decision already in it");
      guard.add(next.nextDecisionFingerprint);
      chain.push(next.nextDecisionFingerprint);
      cursor = next.nextDecisionFingerprint;
    }
  }

  public size(): number {
    return this.links.length;
  }
}
