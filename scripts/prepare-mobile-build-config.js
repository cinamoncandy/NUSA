const fs = require("node:fs");
const path = require("node:path");
const { isIP } = require("node:net");

const origin = process.env.NUSA_MOBILE_API_BASE_URL?.trim() ?? "";
const sourceSha = process.env.NUSA_BUILD_SHA?.trim() || "unknown";
let value;
try { value = new URL(origin); } catch { throw new Error("NUSA_MOBILE_API_BASE_URL must be an explicit HTTPS origin for mobile release packaging"); }
if (value.protocol !== "https:" || value.pathname !== "/" || value.search || value.hash || value.username || value.password) {
  throw new Error("NUSA_MOBILE_API_BASE_URL must be an explicit HTTPS origin for mobile release packaging");
}
const host = value.hostname.toLowerCase();
const unbracketedHost = host.replace(/^\[/, "").replace(/\]$/, "");
if (
  ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)
  || host.endsWith(".localhost")
  || host.endsWith(".local")
  || host.endsWith(".internal")
  || host.endsWith(".trycloudflare.com")
  || isIP(unbracketedHost) !== 0
) {
  throw new Error("mobile release origin must be a stable public hostname, not loopback, internal, IP-literal, or a temporary Quick Tunnel");
}
const destination = path.resolve(__dirname, "../apps/mobile/src/generatedBuildConfig.ts");
const contents = `/** Generated for release packaging; do not hand-edit with production values. */\nexport const CANONICAL_NUSA_ORIGIN = ${JSON.stringify(value.origin)};\nexport const BUILD_SOURCE_SHA = ${JSON.stringify(sourceSha)};\n`;
fs.writeFileSync(destination, contents, "utf8");
console.log(`[mobile-build-config] canonical origin configured for source ${sourceSha}`);
