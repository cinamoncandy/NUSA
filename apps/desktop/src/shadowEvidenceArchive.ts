import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ShadowPilotEvent, ShadowPilotSession } from "./shadowPilotRuntime";

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
  readonly completionReason: string;
  readonly generatedAt: number;
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
    if (/^[A-Za-z]:\\Users\\/i.test(value) || value.startsWith("/Users/") || value.startsWith("/home/")) throw new Error("absolute user path is forbidden in evidence");
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
  private previousHash = GENESIS;
  private eventLines: string[] = [];
  private status: ShadowArchiveStatus = "OPEN";

  private constructor(private readonly root: string, readonly metadata: ShadowEvidenceSessionMetadata) {
    this.directory = path.join(root, metadata.sessionId);
    this.eventsPath = path.join(this.directory, "events.ndjson");
  }

  static async create(root: string, metadata: Omit<ShadowEvidenceSessionMetadata, "schemaVersion">): Promise<ShadowEvidenceArchive> {
    const archive = new ShadowEvidenceArchive(root, Object.freeze({ schemaVersion: 1, ...metadata }));
    await mkdir(archive.directory, { recursive: false });
    await atomicWrite(path.join(archive.directory, "session.json"), archive.metadata);
    await writeFile(archive.eventsPath, "", { encoding: "utf8", flag: "wx" });
    return archive;
  }

  async append(event: ShadowPilotEvent, receivedAt = Date.now()): Promise<ShadowEvidenceEnvelope> {
    if (this.status !== "OPEN") throw new Error(`archive is not open: ${this.status}`);
    const runtimeSequence = this.sequence + 1;
    if (event.sequence !== runtimeSequence) throw new Error(`non-contiguous event sequence: expected ${runtimeSequence}, received ${event.sequence}`);
    if (event.previousEventSha256 !== this.previousHash && runtimeSequence > 1) throw new Error("pilot event hash chain mismatch");
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
    this.eventLines.push(line);
    return envelope;
  }

  async finalize(completionReason: string, generatedAt = Date.now(), status: "COMPLETED" | "ABORTED" = "COMPLETED"): Promise<ShadowEvidenceManifest> {
    if (this.status !== "OPEN") throw new Error(`archive cannot finalize from ${this.status}`);
    this.status = "RECOVERY_REQUIRED";
    const eventsText = this.eventLines.join("") || await readFile(this.eventsPath, "utf8");
    const envelopes = parseEventLines(eventsText);
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
      completionReason,
      generatedAt
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
  try {
    metadata = JSON.parse(await readFile(path.join(directory, "session.json"), "utf8")) as ShadowEvidenceSessionMetadata;
    if (metadata.schemaVersion !== SHADOW_EVIDENCE_SCHEMA_VERSION) return Object.freeze({ status: "UNSUPPORTED_SCHEMA", sessionId: metadata.sessionId ?? null, eventCount: 0, sequenceContinuous: false, hashChainValid: false, sessionConsistent: false, actualBrokerCalls: 0, actualOrders: 0, actualFills: 0, cashMutations: 0, positionMutations: 0, blockers: ["UNSUPPORTED_SCHEMA"], recomputedAt });
    envelopes = parseEventLines(await readFile(path.join(directory, "events.ndjson"), "utf8"));
  } catch (error) {
    return Object.freeze({ status: "CORRUPTED", sessionId: metadata?.sessionId ?? null, eventCount: 0, sequenceContinuous: false, hashChainValid: false, sessionConsistent: false, actualBrokerCalls: 0, actualOrders: 0, actualFills: 0, cashMutations: 0, positionMutations: 0, blockers: [error instanceof Error ? error.message : "EVIDENCE_READ_FAILED"], recomputedAt });
  }

  let previous = GENESIS;
  let sequenceContinuous = true;
  let hashChainValid = true;
  let sessionConsistent = true;
  let actualBrokerCalls = 0;
  let actualOrders = 0;
  let actualFills = 0;
  let cashMutations = 0;
  let positionMutations = 0;
  for (let index = 0; index < envelopes.length; index += 1) {
    const envelope = envelopes[index]!;
    if (envelope.runtimeSequence !== index + 1 || envelope.event.sequence !== index + 1) sequenceContinuous = false;
    if (envelope.previousEventHash !== previous) hashChainValid = false;
    const { eventHash, ...raw } = envelope;
    if (sha256(stableJson(raw)) !== eventHash) hashChainValid = false;
    if (envelope.event.sessionId !== metadata.sessionId) sessionConsistent = false;
    actualBrokerCalls += envelope.event.actualBrokerCallCount;
    actualOrders += envelope.event.actualOrderDelta;
    actualFills += envelope.event.actualFillDelta;
    cashMutations += envelope.event.actualCashDelta;
    positionMutations += envelope.event.actualPositionDelta;
    previous = eventHash;
  }
  if (!sequenceContinuous) blockers.push("MISSING_OR_DUPLICATE_SEQUENCE");
  if (!hashChainValid) blockers.push("EVENT_HASH_MISMATCH");
  if (!sessionConsistent) blockers.push("SESSION_ID_MISMATCH");
  if (actualBrokerCalls !== 0 || actualOrders !== 0 || actualFills !== 0 || cashMutations !== 0 || positionMutations !== 0) blockers.push("SHADOW_MUTATION");
  if (envelopes.at(0)?.event.eventType !== "SESSION_STARTED") blockers.push("SESSION_START_MISSING");
  if (envelopes.at(-1)?.event.eventType !== "SESSION_STOPPED") blockers.push("SESSION_STOP_MISSING");
  return Object.freeze({ status: blockers.length === 0 ? "PASS" : "FAIL", sessionId: metadata.sessionId, eventCount: envelopes.length, sequenceContinuous, hashChainValid, sessionConsistent, actualBrokerCalls, actualOrders, actualFills, cashMutations, positionMutations, blockers: Object.freeze([...new Set(blockers)].sort()), recomputedAt });
}

export async function findIncompleteShadowArchives(root: string): Promise<readonly string[]> {
  try {
    const names = await readdir(root);
    const incomplete: string[] = [];
    for (const name of names) {
      const directory = path.join(root, name);
      if (!(await stat(directory)).isDirectory()) continue;
      const files = new Set(await readdir(directory));
      if (!files.has("completed.marker") && !files.has("aborted.marker")) incomplete.push(directory);
    }
    return Object.freeze(incomplete.sort());
  } catch {
    return Object.freeze([]);
  }
}

export async function removeShadowArchiveForTests(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true });
}
