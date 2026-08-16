const fs = require("node:fs");
const path = require("node:path");

const origin = process.env.EXPO_PUBLIC_NUSA_API_BASE_URL?.trim() ?? "";
const sourceSha = process.env.NUSA_BUILD_SHA?.trim() || "unknown";
const value = origin ? new URL(origin) : null;
if (value === null || value.protocol !== "https:" || value.pathname !== "/" || value.search || value.hash || value.username || value.password) {
  throw new Error("EXPO_PUBLIC_NUSA_API_BASE_URL must be an explicit HTTPS origin for mobile release packaging");
}
if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(value.hostname.toLowerCase()) || value.hostname.toLowerCase().endsWith(".trycloudflare.com")) {
  throw new Error("mobile release origin cannot be loopback or a temporary Quick Tunnel");
}
const destination = path.resolve(__dirname, "../apps/mobile/src/generatedBuildConfig.ts");
const contents = `/** Generated for this build; do not hand-edit. */\nexport const CANONICAL_NUSA_ORIGIN = ${JSON.stringify(value.origin)};\nexport const BUILD_SOURCE_SHA = ${JSON.stringify(sourceSha)};\n`;
fs.writeFileSync(destination, contents, "utf8");
console.log(`[mobile-build-config] canonical origin configured for source ${sourceSha}`);
