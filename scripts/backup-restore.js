import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = resolve(process.env.NUSA_BACKUP_OUTPUT ?? join(root, "release", "backup"));
const hash = (v) => createHash("sha256").update(v).digest("hex");
async function copyOrMarker(name, source) { try { const value = await readFile(source); await writeFile(join(output, name), value); return { name, sha256: hash(value), available: true }; } catch { const value = Buffer.from("UNAVAILABLE\n"); await writeFile(join(output, name), value); return { name, sha256: hash(value), available: false }; } }
async function main() { await mkdir(output, { recursive: true }); const entries = await Promise.all([copyOrMarker("config.snapshot", process.env.NUSA_CONFIG_FILE ?? join(root, "config", "settings.json")), copyOrMarker("evidence.snapshot", process.env.NUSA_EVIDENCE_FILE ?? join(root, "shadow-evidence", "index.json")), copyOrMarker("logs.snapshot", process.env.NUSA_LOG_FILE ?? join(root, "logs", "app.log")), copyOrMarker("database.snapshot", process.env.NUSA_DATABASE_FILE ?? join(root, "data", "dokkaebi.sqlite"))]); const manifest = { schemaVersion: "A5G-1", createdAt: new Date().toISOString(), productionMutationAllowed: false, entries }; await writeFile(join(output, "backup-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8"); console.log(JSON.stringify({ status: "PASS", output, manifest }, null, 2)); }
main().catch((error) => { console.error(error instanceof Error ? error.message : "backup failed"); process.exitCode = 1; });
