import { createHash, randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ShadowPilotEvent, ShadowPilotSession } from "./shadowPilotRuntime";
import type { ShadowCompletionEvidence } from "./shadowCompletionEvidence";
import type { MarketConnectionEvidence } from "../exchange/marketConnectionEvidence";

export const SHADOW_EVIDENCE_SCHEMA_VERSION = 1 as const;
const GENESIS = "GENESIS";
const SECRET_KEY = /(authorization|api[-_]?key|secret|token|credential|password)/i;

export type ShadowArchiveStatus = "OPEN" | "COMPLETED" | "ABORTED" | "INVALID" | "RECOVERY_REQUIRED";

export interface ShadowEvidenceSessionMetadata {
  readonly schemaVersion: 1;
  readonly sessionId: string;
  readonly createdAt: number;
  readonly sourceCommitSha: string;
  readonly symbol: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly controlOrigin: "LOCAL_INTERACTIVE_UI";
  readonly authenticatedOwner: false;
  readonly fingerprints: ShadowPilotSession["fingerprints"];
}

export interface ShadowEvidenceEnvelope {
  readonly schemaVersion: 1;
  readonly runtimeSequence: number;
  readonly receivedAt: number;
  readonly event: ShadowPilotEvent;
  readonly previousEventHash: string;
  readonly eventHash: string;
}

export interface ShadowEvidenceManifest {
  readonly schemaVersion: 1;
  readonly sessionId: string;
  readonly status: "COMPLETED" | "ABORTED";
  readonly eventCount: number;
  readonly firstSequence: number | null;
  readonly lastSequence: number | null;
  readonly firstHash: string | null;
  readonly lastHash: string | null;
  readonly eventsSha256: string;
  readonly metadataSha256: string;
  readonly completionReason: string;
  readonly generatedAt: number;
  readonly completionSha256?: string;
  /**
   * Binds market-connection.json to this manifest (WO-0034-A4L). Optional, exactly like
   * completionSha256: an archive sealed before A4L has neither the file nor the hash, and
   * must keep verifying rather than being retroactively declared incomplete.
   */
  readonly marketConnectionSha256?: string;
}

export interface ShadowEvidenceVerification {
  readonly status: "PASS" | "FAIL" | "INCOMPLETE" | "CORRUPTED" | "UNSUPPORTED_SCHEMA";
  readonly sessionId: string | null;
  readonly eventCount: number;
  readonly sequenceContinuous: boolean;
  readonly hashChainValid: boolean;
  readonly sessionConsistent: boolean;
  readonly actualBrokerCalls: number;
  readonly actualOrders: number;
  readonly actualFills: number;
  readonly cashMutations: number;
  readonly positionMutations: number;
  readonly blockers: readonly string[];
  readonly recomputedAt: number;
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]));
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sanitize(value: unknown, key = ""): unknown {
  if (SECRET_KEY.test(key)) throw new Error(`credential-like field is forbidden: ${key}`);
  if (typeof value === "string") {
    if (/^[A-Za-z]:[\\/]Users[\\/]/i.test(value) || value.startsWith("/Users/") || value.startsWith("/home/") || value.startsWith("\\\\")) throw new Error("absolute user path is forbidden in evidence");
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [childKey, sanitize(child, childKey)]));
  return value;
}

async function atomicWrite(filePath: string, value: unknown): Promise<void> {
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx");
  try {
    await handle.writeFile(`${stableJson(sanitize(value))}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, filePath);
}

export class ShadowEvidenceArchive {
  private readonly directory: string;
  private readonly eventsPath: string;
  private sequence = 0;
  /**
   * Two independent chains, deliberately kept apart.
   *
   * `previousHash` links the archive's own envelopes; `previousPilotHash` tracks the chain
   * the pilot stamped on its events. Comparing an incoming event's `previousEventSha256`
   * against the envelope chain conflates the two and rejects every event from sequence 2
   * onward, because an envelope hash covers the receive timestamp and runtime sequence that
   * the pilot never saw.
   */
  private previousHash = GENESIS;
  private previousPilotHash = GENESIS;
  private eventLines: string[] = [];
  private status: ShadowArchiveStatus = "OPEN";

  private constructor(root: string, readonly metadata: ShadowEvidenceSessionMetadata) {
    this.directory = path.join(root, metadata.sessionId);
    this.eventsPath = path.join(this.directory, "events.ndjson");
  }

  static async create(root: string, metadata: Omit<ShadowEvidenceSessionMetadata, "schemaVersion">): Promise<ShadowEvidenceArchive> {
    const archive = new ShadowEvidenceArchive(root, Object.freeze({ schemaVersion: 1, ...metadata }));
    await mkdir(root, { recursive: true });
    await mkdir(archive.directory, { recursive: false });
    await atomicWrite(path.join(archive.directory, "session.json"), archive.metadata);
    await writeFile(archive.eventsPath, "", { encoding: "utf8", flag: "wx" });
    return archive;
  }

  async append(event: ShadowPilotEvent, receivedAt = Date.now()): Promise<ShadowEvidenceEnvelope> {
    if (this.status !== "OPEN") throw new Error(`archive is not open: ${this.status}`);
    const runtimeSequence = this.sequence + 1;
    if (event.sequence !== runtimeSequence) throw new Error(`non-contiguous event sequence: expected ${runtimeSequence}, received ${event.sequence}`);
    if (event.previousEventSha256 !== this.previousPilotHash) throw new Error("pilot event hash chain mismatch");
    const raw = sanitize({ schemaVersion: 1, runtimeSequence, receivedAt, event, previousEventHash: this.previousHash });
    const eventHash = sha256(stableJson(raw));
    const envelope = Object.freeze({ ...(raw as Omit<ShadowEvidenceEnvelope, "eventHash">), eventHash }) as ShadowEvidenceEnvelope;
    const line = `${stableJson(envelope)}\n`;
    const handle = await open(this.eventsPath, "a");
    try {
      await handle.write(line, undefined, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    this.sequence = runtimeSequence;
    this.previousHash = eventHash;
    this.previousPilotHash = event.eventSha256;
    this.eventLines.push(line);
    return envelope;
  }

  async finalize(completionReason: string, generatedAt = Date.now(), status: "COMPLETED" | "ABORTED" = "COMPLETED", completion?: ShadowCompletionEvidence, marketConnection?: MarketConnectionEvidence): Promise<ShadowEvidenceManifest> {
    if (this.status !== "OPEN") throw new Error(`archive cannot finalize from ${this.status}`);
    this.status = "RECOVERY_REQUIRED";
    const eventsText = this.eventLines.join("") || await readFile(this.eventsPath, "utf8");
    const envelopes = parseEventLines(eventsText);
    if (completion) await atomicWrite(path.join(this.directory, "completion.json"), completion);
    // Written beside the event log, never into it. The chain of pilot observations stays a
    // record of what the strategy saw; the transport's own story lives in its own file.
    if (marketConnection) await atomicWrite(path.join(this.directory, "market-connection.json"), marketConnection);
    const manifest: ShadowEvidenceManifest = Object.freeze({
      schemaVersion: 1,
      sessionId: this.metadata.sessionId,
      status,
      eventCount: envelopes.length,
      firstSequence: envelopes.at(0)?.runtimeSequence ?? null,
      lastSequence: envelopes.at(-1)?.runtimeSequence ?? null,
      firstHash: envelopes.at(0)?.eventHash ?? null,
      lastHash: envelopes.at(-1)?.eventHash ?? null,
      eventsSha256: sha256(eventsText),
      metadataSha256: sha256(stableJson(this.metadata)),
      completionReason,
      generatedAt,
      ...(completion ? { completionSha256: sha256(stableJson(completion)) } : {}),
      ...(marketConnection ? { marketConnectionSha256: sha256(stableJson(marketConnection)) } : {})
    });
    await atomicWrite(path.join(this.directory, "manifest.json"), manifest);
    const verification = await verifyShadowEvidenceDirectory(this.directory, generatedAt);
    await atomicWrite(path.join(this.directory, "verification.json"), verification);
    if (verification.status !== "PASS") {
      this.status = "INVALID";
      throw new Error(`evidence verification failed: ${verification.blockers.join(",")}`);
    }
    await atomicWrite(path.join(this.directory, status === "COMPLETED" ? "completed.marker" : "aborted.marker"), { schemaVersion: 1, sessionId: this.metadata.sessionId, generatedAt });
    this.status = status;
    return manifest;
  }

  directoryPath(): string { return this.directory; }
}

function parseEventLines(text: string): ShadowEvidenceEnvelope[] {
  if (text.length > 0 && !text.endsWith("\n")) throw new Error("partial final NDJSON line");
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as ShadowEvidenceEnvelope);
}

export async function verifyShadowEvidenceDirectory(directory: string, recomputedAt = Date.now()): Promise<ShadowEvidenceVerification> {
  const blockers: string[] = [];
  let metadata: ShadowEvidenceSessionMetadata | undefined;
  let envelopes: ShadowEvidenceEnvelope[] = [];
  let eventsText = "";
  let manifest: ShadowEvidenceManifest | undefined;
  let completion: ShadowCompletionEvidence | undefined;
  let manifestInvalid = false;
  try {
    metadata = JSON.parse(await readFile(path.join(directory, "session.json"), "utf8")) as ShadowEvidenceSessionMetadata;
    if (metadata.schemaVersion !== SHADOW_EVIDENCE_SCHEMA_VERSION) return Object.freeze({ status: "UNSUPPORTED_SCHEMA", sessionId: metadata.sessionId ?? null, eventCount: 0, sequenceContinuous: false, hashChainValid: false, sessionConsistent: false, actualBrokerCalls: 0, actualOrders: 0, actualFills: 0, cashMutations: 0, positionMutations: 0, blockers: ["UNSUPPORTED_SCHEMA"], recomputedAt });
    eventsText = await readFile(path.join(directory, "events.ndjson"), "utf8");
    envelopes = parseEventLines(eventsText);
  } catch (error) {
    return Object.freeze({ status: "CORRUPTED", sessionId: metadata?.sessionId ?? null, eventCount: 0, sequenceContinuous: false, hashChainValid: false, sessionConsistent: false, actualBrokerCalls: 0, actualOrders: 0, actualFills: 0, cashMutations: 0, positionMutations: 0, blockers: [error instanceof Error ? error.message : "EVIDENCE_READ_FAILED"], recomputedAt });
  }
  try {
    manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")) as ShadowEvidenceManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") manifestInvalid = true;
  }
  try {
    completion = JSON.parse(await readFile(path.join(directory, "completion.json"), "utf8")) as ShadowCompletionEvidence;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") manifestInvalid = true;
  }
  let marketConnection: MarketConnectionEvidence | undefined;
  try {
    marketConnection = JSON.parse(await readFile(path.join(directory, "market-connection.json"), "utf8")) as MarketConnectionEvidence;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") manifestInvalid = true;
  }

  let previous = GENESIS;
  let previousPilotHash = GENESIS;
  let sequenceContinuous = true;
  let hashChainValid = true;
  let sessionConsistent = true;
  let forbiddenField = false;
  let shadowMutation = false;
  let actualBrokerCalls = 0;
  let actualOrders = 0;
  let actualFills = 0;
  let cashMutations = 0;
  let positionMutations = 0;
  for (let index = 0; index < envelopes.length; index += 1) {
    const envelope = envelopes[index]!;
    if (envelope.runtimeSequence !== index + 1 || envelope.event.sequence !== index + 1) sequenceContinuous = false;
    if (envelope.previousEventHash !== previous) hashChainValid = false;
    if (envelope.event.previousEventSha256 !== previousPilotHash) hashChainValid = false;
    const { eventHash, ...raw } = envelope;
    if (sha256(stableJson(raw)) !== eventHash) hashChainValid = false;
    if (envelope.event.sessionId !== metadata.sessionId) sessionConsistent = false;
    try { sanitize(envelope); } catch { forbiddenField = true; }
    const mutationValues = [envelope.event.actualBrokerCallCount, envelope.event.actualOrderDelta, envelope.event.actualFillDelta, envelope.event.actualCashDelta, envelope.event.actualPositionDelta];
    if (mutationValues.some((value) => value !== 0)) shadowMutation = true;
    actualBrokerCalls += typeof envelope.event.actualBrokerCallCount === "number" ? envelope.event.actualBrokerCallCount : 0;
    actualOrders += typeof envelope.event.actualOrderDelta === "number" ? envelope.event.actualOrderDelta : 0;
    actualFills += typeof envelope.event.actualFillDelta === "number" ? envelope.event.actualFillDelta : 0;
    cashMutations += typeof envelope.event.actualCashDelta === "number" ? envelope.event.actualCashDelta : 0;
    positionMutations += typeof envelope.event.actualPositionDelta === "number" ? envelope.event.actualPositionDelta : 0;
    previous = eventHash;
    previousPilotHash = envelope.event.eventSha256;
  }
  try { sanitize(metadata); } catch { forbiddenField = true; }
  if (!sequenceContinuous) blockers.push("MISSING_OR_DUPLICATE_SEQUENCE");
  if (!hashChainValid) blockers.push("EVENT_HASH_MISMATCH");
  if (!sessionConsistent) blockers.push("SESSION_ID_MISMATCH");
  if (forbiddenField) blockers.push("FORBIDDEN_EVIDENCE_FIELD");
  if (shadowMutation || actualBrokerCalls !== 0 || actualOrders !== 0 || actualFills !== 0 || cashMutations !== 0 || positionMutations !== 0) blockers.push("SHADOW_MUTATION");
  if (envelopes.at(0)?.event.eventType !== "SESSION_STARTED") blockers.push("SESSION_START_MISSING");
  if (manifest?.status !== "ABORTED" && envelopes.at(-1)?.event.eventType !== "SESSION_STOPPED") blockers.push("SESSION_STOP_MISSING");

  if (manifestInvalid) blockers.push("MANIFEST_INVALID");
  if (manifest) {
    const expected = {
      schemaVersion: SHADOW_EVIDENCE_SCHEMA_VERSION,
      sessionId: metadata.sessionId,
      eventCount: envelopes.length,
      firstSequence: envelopes.at(0)?.runtimeSequence ?? null,
      lastSequence: envelopes.at(-1)?.runtimeSequence ?? null,
      firstHash: envelopes.at(0)?.eventHash ?? null,
      lastHash: envelopes.at(-1)?.eventHash ?? null,
      eventsSha256: sha256(eventsText),
      metadataSha256: sha256(stableJson(metadata))
    };
    if (manifest.schemaVersion !== expected.schemaVersion || manifest.sessionId !== expected.sessionId || (manifest.status !== "COMPLETED" && manifest.status !== "ABORTED") || manifest.eventCount !== expected.eventCount || manifest.firstSequence !== expected.firstSequence || manifest.lastSequence !== expected.lastSequence || manifest.firstHash !== expected.firstHash || manifest.lastHash !== expected.lastHash || manifest.eventsSha256 !== expected.eventsSha256 || manifest.metadataSha256 !== expected.metadataSha256) blockers.push("MANIFEST_MISMATCH");
    if (manifest.completionSha256 !== undefined) {
      if (completion === undefined || sha256(stableJson(completion)) !== manifest.completionSha256 || completion.sessionId !== metadata.sessionId || completion.finalState !== "COMPLETED" || completion.safety !== "SAFE_COMPLETION") blockers.push("COMPLETION_EVIDENCE_MISMATCH");
    } else if (completion !== undefined) blockers.push("COMPLETION_EVIDENCE_UNBOUND");
    // Same rule as the completion record: a present file must be bound to the manifest, and
    // a bound hash must match a file that is really there and really belongs to this session.
    if (manifest.marketConnectionSha256 !== undefined) {
      if (marketConnection === undefined || sha256(stableJson(marketConnection)) !== manifest.marketConnectionSha256 || marketConnection.sessionId !== metadata.sessionId) blockers.push("MARKET_CONNECTION_EVIDENCE_MISMATCH");
    } else if (marketConnection !== undefined) blockers.push("MARKET_CONNECTION_EVIDENCE_UNBOUND");
  } else {
    // No manifest at all: any side record present is unbound by definition. Both are
    // reported, because fixing one and silently leaving the other unbound is not a fix.
    if (completion !== undefined) blockers.push("COMPLETION_EVIDENCE_UNBOUND");
    if (marketConnection !== undefined) blockers.push("MARKET_CONNECTION_EVIDENCE_UNBOUND");
  }
  const files = new Set(await readdir(directory));
  const hasCompletedMarker = files.has("completed.marker");
  const hasAbortedMarker = files.has("aborted.marker");
  if (hasCompletedMarker && hasAbortedMarker) blockers.push("COMPLETION_MARKER_MISMATCH");
  if (manifest && ((manifest.status === "COMPLETED" && !hasCompletedMarker) || (manifest.status === "ABORTED" && !hasAbortedMarker))) {
    // During finalize the manifest is intentionally written before the marker. Once a marker
    // exists, however, it must agree with the sealed status.
    if (hasCompletedMarker || hasAbortedMarker) blockers.push("COMPLETION_MARKER_MISMATCH");
  }
  for (const markerName of ["completed.marker", "aborted.marker"] as const) {
    if (!files.has(markerName)) continue;
    try {
      const marker = JSON.parse(await readFile(path.join(directory, markerName), "utf8")) as { schemaVersion?: number; sessionId?: string };
      if (marker.schemaVersion !== SHADOW_EVIDENCE_SCHEMA_VERSION || marker.sessionId !== metadata.sessionId) blockers.push("COMPLETION_MARKER_INVALID");
    } catch {
      blockers.push("COMPLETION_MARKER_INVALID");
    }
  }
  return Object.freeze({ status: blockers.length === 0 ? "PASS" : "FAIL", sessionId: metadata.sessionId, eventCount: envelopes.length, sequenceContinuous, hashChainValid, sessionConsistent, actualBrokerCalls, actualOrders, actualFills, cashMutations, positionMutations, blockers: Object.freeze([...new Set(blockers)].sort()), recomputedAt });
}

/**
 * Replays a sealed Shadow archive for read-only projections. Verification happens before any
 * event is returned, so a corrupt or incomplete archive can never be mistaken for live truth.
 * The archive remains an evidence record; replay does not hydrate or mutate a runtime.
 */
export async function replayShadowEvidenceArchive(directory: string, maximumEvents = 500): Promise<Readonly<{
  readonly metadata: ShadowEvidenceSessionMetadata;
  readonly events: readonly ShadowPilotEvent[];
}>> {
  if (!Number.isSafeInteger(maximumEvents) || maximumEvents < 1 || maximumEvents > 500) throw new Error("invalid Shadow archive replay limit");
  const verification = await verifyShadowEvidenceDirectory(directory);
  if (verification.status !== "PASS") throw new Error(`Shadow archive replay rejected: ${verification.status}:${verification.blockers.join(",")}`);
  const metadata = JSON.parse(await readFile(path.join(directory, "session.json"), "utf8")) as ShadowEvidenceSessionMetadata;
  if (metadata.schemaVersion !== SHADOW_EVIDENCE_SCHEMA_VERSION) throw new Error("unsupported Shadow archive schema");
  const envelopes = parseEventLines(await readFile(path.join(directory, "events.ndjson"), "utf8"));
  if (envelopes.length > maximumEvents) throw new Error("Shadow archive replay bound exceeded");
  const events = envelopes.map((envelope) => envelope.event);
  return Object.freeze({ metadata: Object.freeze(metadata), events: Object.freeze(events) });
}

/** Replays every sealed archive in deterministic directory/session order. */
export async function replayShadowEvidenceArchives(root: string, maximumEvents = 500): Promise<Readonly<{
  readonly archives: readonly (Readonly<{ readonly metadata: ShadowEvidenceSessionMetadata; readonly events: readonly ShadowPilotEvent[] }>)[];
  readonly rejected: readonly string[];
}>> {
  const entries = await readdir(root, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  const archives: Array<Readonly<{ readonly metadata: ShadowEvidenceSessionMetadata; readonly events: readonly ShadowPilotEvent[] }>> = [];
  const rejected: string[] = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
    const directory = path.join(root, entry.name);
    try { archives.push(await replayShadowEvidenceArchive(directory, maximumEvents)); }
    catch { rejected.push(directory); }
  }
  return Object.freeze({ archives: Object.freeze(archives), rejected: Object.freeze(rejected) });
}

/** Flattens verified archives into one bounded, deterministic, duplicate-free observation timeline. */
export async function replayShadowEvidenceTimeline(root: string, maximumEvents = 500): Promise<Readonly<{
  readonly events: readonly ShadowPilotEvent[];
  readonly rejectedArchives: readonly string[];
}>> {
  const replay = await replayShadowEvidenceArchives(root, maximumEvents);
  const unique = new Map<string, ShadowPilotEvent>();
  for (const archive of replay.archives) {
    for (const event of archive.events) unique.set(`${event.sessionId}:${event.eventSha256}`, event);
  }
  const events = [...unique.values()].sort((left, right) => left.timestamp - right.timestamp || left.sessionId.localeCompare(right.sessionId) || left.sequence - right.sequence).slice(-maximumEvents);
  return Object.freeze({ events: Object.freeze(events), rejectedArchives: replay.rejected });
}

export async function findIncompleteShadowArchives(root: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const incomplete: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(root, entry.name);
      const files = new Set(await readdir(directory));
      if (!files.has("completed.marker") && !files.has("aborted.marker")) incomplete.push(directory);
    }
    return Object.freeze(incomplete.sort());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return Object.freeze([]);
    throw error;
  }
}

/** Synchronous counterpart used by the Electron main process before Shadow start is exposed. */
export function findIncompleteShadowArchivesSync(root: string): readonly string[] {
  try {
    const entries = readdirSync(root, { withFileTypes: true });
    const incomplete: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(root, entry.name);
      const files = new Set(readdirSync(directory));
      if (!files.has("completed.marker") && !files.has("aborted.marker")) incomplete.push(directory);
    }
    return Object.freeze(incomplete.sort());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return Object.freeze([]);
    throw error;
  }
}

export async function removeShadowArchiveForTests(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true });
}
