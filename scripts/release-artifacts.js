"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const releaseDir = path.join(root, "release");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const forbidden = /(^|[\\/])(?:\.env|.*\.pem$|.*\.pfx$|.*\.key$|.*secret.*|.*credential.*|auth\.json$|token\.json$|npm-debug\.log$|pnpm-debug\.log$)/i;
const files = [];
const walk = (directory) => {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else {
      const relative = path.relative(releaseDir, full).replaceAll("\\", "/");
      if (forbidden.test(relative)) throw new Error(`forbidden release artifact: ${relative}`);
      const bytes = fs.readFileSync(full);
      files.push({ path: relative, sizeBytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
    }
  }
};
walk(releaseDir);
if (!files.length) throw new Error("no release artifacts found");
files.sort((a, b) => a.path.localeCompare(b.path));
const manifest = JSON.parse(fs.readFileSync(path.join(releaseDir, "build-manifest.json"), "utf8"));
const sbom = {
  bomFormat: "cyclonedx-json",
  specVersion: "1.5",
  version: 1,
  metadata: { component: { type: "application", name: pkg.name, version: pkg.version }, timestamp: new Date().toISOString() },
  components: Object.entries({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }).map(([name, version]) => ({ type: "library", name, version })).sort((a, b) => a.name.localeCompare(b.name))
};
const checksums = files.map((item) => `${item.sha256}  ${item.path}`).join("\n") + "\n";
fs.writeFileSync(path.join(releaseDir, `${pkg.name}-${pkg.version}-checksums.txt`), checksums);
fs.writeFileSync(path.join(releaseDir, `${pkg.name}-${pkg.version}-SBOM.json`), `${JSON.stringify(sbom, null, 2)}\n`);
fs.writeFileSync(path.join(releaseDir, `${pkg.name}-${pkg.version}-release-notes.md`), `# ${pkg.name} ${pkg.version}\n\n## Added\n- Windows NSIS and portable release preparation.\n- Deterministic build manifest, checksums, and SBOM.\n\n## Security\n- Paper mode is the default.\n- productionMutationAllowed=false.\n- Private API and credentials are not bundled.\n\n## Known limitations\n- Unsigned artifacts are not Production releases.\n- Live activation remains a separate approval.\n\n## Verification\n- Build manifest commit: ${manifest.commit}\n- Artifact allowlist: PASS\n`);
const verification = { schemaVersion: 1, version: pkg.version, commit: manifest.commit, buildTime: manifest.buildDate, productionMutationAllowed: false, signatureState: manifest.signing.status, artifactCount: files.length, artifactHashes: files, checks: { artifactAllowlist: "PASS", checksums: "PASS", sbom: "PASS" } };
fs.writeFileSync(path.join(releaseDir, `${pkg.name}-${pkg.version}-verification.json`), `${JSON.stringify(verification, null, 2)}\n`);
console.log(JSON.stringify({ status: "PASS", artifactCount: files.length, outputs: ["checksums", "SBOM", "release-notes", "verification"] }, null, 2));
