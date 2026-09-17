const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const settings = read("apps/mobile/src/settingsView.tsx");
const experience = read("apps/mobile/src/ownerConnectionExperience.tsx");

test("a failed PAPER connection is projected as BLOCKED with the real reason", () => {
  assert.match(settings, /const connectionFailed = connectionAttempted && connection\.status !== "READY"/);
  assert.match(settings, /connectionFailed \? "BLOCKED"/);
  assert.match(settings, /connectionFailed \? connection\.reason/);
  assert.match(settings, /detail=\{connection\.status === "READY" \? undefined : cloudConnectionDetail\}/);
});

test("Evidence Glass renders the blocked reason at the active connection surface", () => {
  assert.match(experience, /const blocked = stage === "BLOCKED"/);
  assert.match(experience, /borderColor:blocked\?theme\.colors\.danger:theme\.colors\.border/);
  assert.match(experience, /\{detail\?\?/);
  assert.match(experience, /\{blocked\?"PAPER 변경 차단":"최초 연결만 확인합니다"\}/);
});

test("healthy and pre-connection states retain truthful connection detail", () => {
  assert.match(settings, /connection\.status === "READY" \? `\$\{connection\.snapshot\.operations\.runtimeState\} · \$\{connection\.snapshot\.operations\.transport\}`/);
  assert.match(settings, /소유자 인증 한 번으로 이 기기의 PAPER 보안 세션을 시작합니다/);
  assert.match(experience, /testID="owner-connection-experience"/);
});

test("connection failure visibility never expands LIVE or AI authority", () => {
  assert.match(experience, /PAPER ONLY/);
  assert.match(experience, /LIVE AUTH SEPARATE · AI ZERO AUTHORITY/);
  assert.doesNotMatch(experience, /productionMutationAllowed:\s*true|authority:\s*"LIVE"/);
});
