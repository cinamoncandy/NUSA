import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { maskSensitive } from "./appLogger";
import { createZipArchive, type ZipEntry } from "./zipArchive";
import type { UserDataLayout } from "./userDataLayout";

/**
 * The "send this to support" bundle (WO-0034-A4O req 5).
 *
 * The design constraint that shapes everything here is that a user will send this file to
 * someone, probably without opening it. So the bundle is built from an EXPLICIT list of
 * things, never by walking a directory: a copy of the user data folder would eventually
 * include whatever a future feature put there, and "we did not expect that file to exist" is
 * not a defence once it has been emailed.
 *
 * Two independent guards, because one is a single point of failure:
 *   - a key filter that refuses to serialise anything named like a credential;
 *   - a value mask over every rendered line, including file contents copied in.
 *
 * The app has no credentials today. Both guards exist so that it stays true if that changes.
 */

const FORBIDDEN_KEY = /(authorization|api[-_]?key|access[-_]?key|secret|token|credential|password|passphrase|jwt|private[-_]?key)/i;

/** How much of each log file is carried. The tail is the part a support request is about. */
const MAX_LOG_BYTES_PER_FILE = 512 * 1024;
const MAX_LOG_FILES = 5;
const MAX_CRASH_FILES = 5;

export class DiagnosticsRedactionError extends Error {}

/**
 * Deep-copies a value, dropping any key that is named like a secret and masking every string.
 *
 * A forbidden key is DROPPED rather than replaced, and the drop is recorded, so the manifest
 * can say a field was withheld. Silently emitting `"apiKey": "[REDACTED]"` would tell a
 * reader this app has an API key, which is itself untrue.
 */
export function sanitizeDiagnosticsValue(value: unknown, withheld: string[] = [], keyPath = ""): unknown {
  if (typeof value === "string") return maskSensitive(value);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((item, index) => sanitizeDiagnosticsValue(item, withheld, `${keyPath}[${index}]`));
  if (typeof value !== "object") return undefined;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const child = keyPath === "" ? key : `${keyPath}.${key}`;
    if (FORBIDDEN_KEY.test(key)) {
      withheld.push(child);
      continue;
    }
    const sanitized = sanitizeDiagnosticsValue(item, withheld, child);
    if (sanitized !== undefined) output[child.split(".").pop()!] = sanitized;
  }
  return output;
}

export interface DiagnosticsRuntimeFacts {
  readonly appName: string;
  readonly appVersion: string;
  readonly commitSha: string | null;
  readonly electronVersion: string | null;
  readonly nodeVersion: string;
  readonly chromeVersion: string | null;
  readonly platform: string;
  readonly osRelease: string;
  readonly arch: string;
  readonly environment: string;
  readonly mode: string;
}

export interface DiagnosticsExportInput {
  readonly layout: UserDataLayout;
  readonly runtime: DiagnosticsRuntimeFacts;
  readonly runId: string;
  readonly sessionId: string | null;
  /** Absolute paths, newest first. Only these are read; no directory is walked for logs. */
  readonly logFiles: readonly string[];
  readonly safety: unknown;
  readonly recovery: unknown;
  /** Present once market-connection diagnostics exist in the build; omitted otherwise. */
  readonly marketConnection?: unknown;
  readonly evidenceMetadata: unknown;
  readonly recentErrorCodes: readonly string[];
  readonly now?: number;
}

export interface DiagnosticsManifest {
  readonly schemaVersion: 1;
  readonly generatedAt: number;
  readonly runId: string;
  readonly sessionId: string | null;
  readonly runtime: DiagnosticsRuntimeFacts;
  readonly contents: readonly string[];
  /** Field paths dropped because they were named like a credential. Normally empty. */
  readonly withheldFields: readonly string[];
  readonly excluded: readonly string[];
}

export interface DiagnosticsPackage {
  readonly fileName: string;
  readonly archive: Buffer;
  readonly manifest: DiagnosticsManifest;
}

/** Reads a text file's tail, masked. Missing or unreadable files contribute nothing. */
function readTail(filePath: string, maxBytes: number): string | null {
  try {
    const text = readFileSync(filePath, "utf8");
    const tail = text.length > maxBytes ? text.slice(text.length - maxBytes) : text;
    return maskSensitive(tail);
  } catch {
    return null;
  }
}

function listNewestFiles(directory: string, limit: number): readonly string[] {
  try {
    return readdirSync(directory)
      .map((name) => path.join(directory, name))
      .filter((full) => {
        try { return statSync(full).isFile(); } catch { return false; }
      })
      .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
      .slice(0, limit);
  } catch {
    return [];
  }
}

const json = (value: unknown): Buffer => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");

export function buildDiagnosticsPackage(input: DiagnosticsExportInput): DiagnosticsPackage {
  const generatedAt = input.now ?? Date.now();
  const withheld: string[] = [];
  const entries: ZipEntry[] = [];

  const section = (name: string, value: unknown): void => {
    // The section name seeds the key path, so a withheld field is reported as
    // "safety.apiKey" rather than a bare "apiKey" that could have come from anywhere.
    const root = name.replace(/\.json$/, "").replace(/-/g, "");
    entries.push({ name, data: json(sanitizeDiagnosticsValue(value, withheld, root)), modifiedAt: generatedAt });
  };

  section("safety.json", input.safety);
  section("recovery.json", input.recovery);
  section("evidence-metadata.json", input.evidenceMetadata);
  section("error-codes.json", { recentErrorCodes: input.recentErrorCodes });
  // Only present when the running build has connection diagnostics to report. An empty
  // section would read as "no outages", which is a different claim from "not measured here".
  if (input.marketConnection !== undefined) section("market-connection.json", input.marketConnection);

  for (const filePath of input.logFiles.slice(0, MAX_LOG_FILES)) {
    const contents = readTail(filePath, MAX_LOG_BYTES_PER_FILE);
    if (contents === null) continue;
    entries.push({ name: `logs/${path.basename(filePath)}`, data: Buffer.from(contents, "utf8"), modifiedAt: generatedAt });
  }
  for (const filePath of listNewestFiles(input.layout.crashDirectory, MAX_CRASH_FILES)) {
    const contents = readTail(filePath, MAX_LOG_BYTES_PER_FILE);
    if (contents === null) continue;
    entries.push({ name: `crash/${path.basename(filePath)}`, data: Buffer.from(contents, "utf8"), modifiedAt: generatedAt });
  }

  const manifest: DiagnosticsManifest = Object.freeze({
    schemaVersion: 1,
    generatedAt,
    runId: input.runId,
    sessionId: input.sessionId,
    runtime: input.runtime,
    contents: Object.freeze(entries.map((entry) => entry.name).sort()),
    withheldFields: Object.freeze([...new Set(withheld)].sort()),
    // Stated positively so a reader knows these were considered and left out on purpose,
    // rather than wondering whether the bundle simply missed them.
    excluded: Object.freeze([
      "API keys and credentials (this application stores none)",
      "Evidence event logs (metadata only; the archives stay on this machine)",
      "the user data directory as a whole (only the files listed above are copied)"
    ])
  });
  entries.unshift({ name: "manifest.json", data: json(manifest), modifiedAt: generatedAt });

  const stamp = new Date(generatedAt).toISOString().replace(/[:.]/g, "-").replace("Z", "");
  return Object.freeze({
    fileName: `nusa-diagnostics-${stamp}.zip`,
    archive: createZipArchive(entries),
    manifest
  });
}

export interface DiagnosticsExportResult {
  readonly filePath: string;
  readonly byteLength: number;
  readonly manifest: DiagnosticsManifest;
}

export function writeDiagnosticsPackage(input: DiagnosticsExportInput): DiagnosticsExportResult {
  const bundle = buildDiagnosticsPackage(input);
  mkdirSync(input.layout.diagnosticsDirectory, { recursive: true });
  const filePath = path.join(input.layout.diagnosticsDirectory, bundle.fileName);
  writeFileSync(filePath, bundle.archive);
  return Object.freeze({ filePath, byteLength: bundle.archive.length, manifest: bundle.manifest });
}
