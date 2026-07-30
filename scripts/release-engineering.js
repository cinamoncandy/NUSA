import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = resolve(process.env.NUSA_RELEASE_OUTPUT ?? join(root, "release"));
const cleanName = (value) => String(value).replace(/[\\/]/g, "_").replace(/secret|token|password|authorization|api.?key/i, "redacted");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
async function gitCommit() { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); } catch { return "UNKNOWN"; } }
async function packageJson() { return JSON.parse(await readFile(join(root, "package.json"), "utf8")); }
async function buildManifest() { const pkg = await packageJson(); const commit = await gitCommit(); const manifest = { version: pkg.version, commit, buildDate: new Date().toISOString(), electronVersion: pkg.devDependencies?.electron ?? "UNKNOWN", nodeVersion: process.version, migrationVersion: "A5G-1", capabilityDescriptor: { productionMutationAllowed: false, liveTradingCapabilityPresent: false, privateApiMutationCapabilityPresent: false, operationsCenterPresent: false } }; return Object.freeze(manifest); }
async function collectFiles(path, base = path) { const entries = []; for (const item of await readdir(path, { withFileTypes: true })) { const full = join(path, item.name); if (item.isDirectory()) entries.push(...await collectFiles(full, base)); else if (!/\.map$|node_modules|\.ts$/.test(full)) { const data = await readFile(full); entries.push({ path: cleanName(relative(base, full)), bytes: data.byteLength, sha256: sha256(data) }); } } return entries; }
async function main() { await mkdir(output, { recursive: true }); const manifest = await buildManifest(); const manifestText = `${JSON.stringify(manifest, null, 2)}\n`; await writeFile(join(output, "build-manifest.json"), manifestText, "utf8"); await writeFile(join(output, "build-manifest.sha256"), `${sha256(manifestText)}  build-manifest.json\n`, "utf8"); const packageDir = resolve(process.env.NUSA_PACKAGE_DIR ?? join(root, "dist")); const files = await collectFiles(packageDir); await writeFile(join(output, "artifact-manifest.json"), `${JSON.stringify({ ...manifest, files }, null, 2)}\n`, "utf8"); console.log(JSON.stringify({ status: "PASS", output, manifest, artifactCount: files.length, productionMutationAllowed: false }, null, 2)); }
main().catch((error) => { console.error(error instanceof Error ? error.message : "release engineering failed"); process.exitCode = 1; });
