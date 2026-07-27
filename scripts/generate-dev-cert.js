/**
 * Generates a self-signed TLS certificate + private key for running apps/server over HTTPS
 * locally or on a LAN (e.g. so a phone on the same network can reach it -- the PWA/Service
 * Worker/Wake Lock features from the "모바일 중심" pass all require a secure context, which
 * plain HTTP on a LAN IP is not; only https:/localhost count).
 *
 * Deliberately shells out to the system `openssl` binary rather than adding an npm dependency
 * or hand-rolling ASN.1/X.509 DER encoding from node:crypto's raw primitives -- generating a
 * *correct* certificate by hand (subjectAltName extension in particular; modern browsers
 * reject certs relying on the legacy CN-only form) is real, security-sensitive complexity this
 * project has no reason to take on itself when a well-tested system tool already does it
 * correctly. This script only ever runs manually by the operator, never at server startup.
 *
 * Run: node scripts/generate-dev-cert.js [output-dir]  (defaults to ./certs)
 */
const { execFileSync } = require("node:child_process");
const { mkdirSync, existsSync } = require("node:fs");
const { networkInterfaces } = require("node:os");
const { join, resolve } = require("node:path");

function checkOpenssl() {
  try {
    execFileSync("openssl", ["version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function detectLanIPv4Addresses() {
  const addresses = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) addresses.push(entry.address);
    }
  }
  return addresses;
}

function main() {
  if (!checkOpenssl()) {
    console.error("오류: 이 스크립트는 시스템의 openssl 명령을 사용합니다. openssl이 설치되어 있지 않거나 PATH에서 찾을 수 없습니다.");
    console.error("openssl을 설치한 뒤 다시 실행해 주세요 (예: apt install openssl / brew install openssl).");
    process.exitCode = 1;
    return;
  }

  const outputDir = resolve(process.argv[2] ?? "certs");
  mkdirSync(outputDir, { recursive: true });
  const keyPath = join(outputDir, "dev-key.pem");
  const certPath = join(outputDir, "dev-cert.pem");

  if (existsSync(keyPath) || existsSync(certPath)) {
    console.error(`오류: ${outputDir}에 이미 dev-key.pem 또는 dev-cert.pem이 존재합니다. 먼저 삭제하거나 다른 출력 경로를 지정해 주세요.`);
    process.exitCode = 1;
    return;
  }

  // localhost + 127.0.0.1 always; every non-internal IPv4 the machine currently has (typically
  // the LAN address a phone would actually use to reach this server) added as additional SANs.
  const sanEntries = ["DNS:localhost", "IP:127.0.0.1", ...detectLanIPv4Addresses().map((ip) => `IP:${ip}`)];
  const subjectAltName = sanEntries.join(",");

  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", keyPath,
    "-out", certPath,
    "-days", "825",
    "-subj", "/CN=dokkaebi-dev",
    "-addext", `subjectAltName=${subjectAltName}`
  ], { stdio: "inherit" });

  console.log(`\n생성 완료: ${certPath}, ${keyPath}`);
  console.log(`포함된 도메인/IP (subjectAltName): ${subjectAltName}`);
  console.log("\n자체 서명 인증서이므로 처음 접속 시 브라우저가 경고를 표시합니다 -- \"고급\" -> \"이동(안전하지 않음)\" 등으로 신뢰를 직접 수락해야 합니다.");
  console.log("\n서버를 HTTPS로 실행하려면:");
  console.log(`  DOKKAEBI_TLS_CERT_PATH=${certPath} DOKKAEBI_TLS_KEY_PATH=${keyPath} node dist/apps/server/src/main.js`);
}

main();
