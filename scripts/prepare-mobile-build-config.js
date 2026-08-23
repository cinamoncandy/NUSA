const fs = require("node:fs");
const path = require("node:path");
const { isIP } = require("node:net");

const origin = process.env.EXPO_PUBLIC_NUSA_API_BASE_URL?.trim() ?? "";
const sourceSha = process.env.NUSA_BUILD_SHA?.trim() ?? "";
let value;
try { value = new URL(origin); } catch { throw new Error("EXPO_PUBLIC_NUSA_API_BASE_URL must be an explicit stable HTTPS origin for mobile release packaging"); }
if (value.protocol !== "https:" || value.pathname !== "/" || value.search || value.hash || value.username || value.password) {
  throw new Error("EXPO_PUBLIC_NUSA_API_BASE_URL must be an HTTPS origin without credentials or path state");
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
  throw new Error("mobile release origin must be a stable public hostname, not loopback, internal, IP-literal, or a temporary Cloudflare Quick Tunnel");
}
if (!/^[0-9a-f]{40}$/i.test(sourceSha)) throw new Error("NUSA_BUILD_SHA must be the exact 40-character source commit for release packaging");

const destination = path.resolve(__dirname, "../apps/mobile/src/generatedBuildConfig.ts");
const contents = `/** Generated for release packaging; do not hand-edit with deployment values. */\nexport const CANONICAL_NUSA_ORIGIN = ${JSON.stringify(value.origin)};\nexport const BUILD_SOURCE_SHA = ${JSON.stringify(sourceSha)};\n`;
fs.writeFileSync(destination, contents, "utf8");
console.log(`[mobile-build-config] canonical HTTPS origin sealed for source ${sourceSha}`);
