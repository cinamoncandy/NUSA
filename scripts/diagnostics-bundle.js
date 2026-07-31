import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = resolve(process.env.NUSA_DIAGNOSTICS_OUTPUT ?? join(root, "release", "diagnostics"));
const redact = (value) => value.replace(/(secret|token|password|authorization|api.?key)\s*[:=]\s*[^\s,}]+/gi, "$1=[REDACTED]");
const checksum = (value) => createHash("sha256").update(value).digest("hex");
const safeRead = async (path) => { try { return redact(await readFile(path, "utf8")); } catch { return "UNAVAILABLE\n"; } };
async function main() { await mkdir(output, { recursive: true }); const files = { "health-summary.txt": "Health summary unavailable without a running desktop session.\n", "logs.txt": await safeRead(process.env.NUSA_LOG_FILE ?? join(root, "logs", "app.log")), "evidence.txt": await safeRead(process.env.NUSA_EVIDENCE_FILE ?? join(root, "shadow-evidence", "index.json")), "version.txt": await safeRead(join(root, "package.json")), "capability-descriptor.json": JSON.stringify({ productionMutationAllowed: false, liveTradingCapabilityPresent: false, privateApiMutationCapabilityPresent: false }, null, 2) + "\n" }; for (const [name, content] of Object.entries(files)) await writeFile(join(output, name), content, "utf8"); const index = Object.fromEntries(Object.entries(files).map(([name, content]) => [name, checksum(content)])); await writeFile(join(output, "bundle-manifest.json"), JSON.stringify({ generatedAt: new Date().toISOString(), files: index, secretsIncluded: false }, null, 2) + "\n", "utf8"); console.log(JSON.stringify({ status: "PASS", output, files: Object.keys(files), secretsIncluded: false }, null, 2)); }
main().catch((error) => { console.error(error instanceof Error ? error.message : "diagnostics bundle failed"); process.exitCode = 1; });
