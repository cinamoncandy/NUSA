const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("shared text field forwards native input semantics and truthful disabled state", () => {
  const source = read("apps/mobile/src/components.tsx");
  assert.match(source, /type TextInputProps/);
  assert.match(source, /Pick<TextInputProps, "autoCapitalize" \| "autoCorrect" \| "editable" \| "keyboardType" \| "returnKeyType">/);
  assert.match(source, /accessibilityState=\{\{ disabled: !editable \}\}/);
  assert.match(source, /autoCapitalize=\{autoCapitalize\}/);
  assert.match(source, /autoCorrect=\{autoCorrect\}/);
  assert.match(source, /editable=\{editable\}/);
  assert.match(source, /keyboardType=\{keyboardType\}/);
  assert.match(source, /returnKeyType=\{returnKeyType\}/);
});

test("Settings connection mutation is single-flight and probes only the persisted endpoint", () => {
  const source = read("apps/mobile/src/settingsView.tsx");
  assert.match(source, /const \[connecting, setConnecting\] = useState\(false\)/);
  assert.match(source, /const savingRef = useRef\(false\)/);
  assert.match(source, /const connectionInFlightRef = useRef\(false\)/);
  assert.match(source, /if \(savingRef\.current\) return false/);
  assert.match(source, /if \(settings == null \|\| isBusyNow\(\)\) return/);
  assert.match(source, /connectionInFlightRef\.current = true/);
  assert.match(source, /const configuredEndpoint = getConfiguredPaperEndpoint\(\)/);
  assert.match(source, /baseUrl: configuredEndpoint/);
  assert.match(source, /markPaperConnectionVerified\(configuredEndpoint\)/);
  assert.doesNotMatch(source, /baseUrl: endpointDraft/);
  assert.doesNotMatch(source, /markPaperConnectionVerified\(endpointDraft\)/);
  assert.match(source, /finally \{[\s\S]*connectionInFlightRef\.current = false;[\s\S]*setConnecting\(false\)/);
});

test("Settings revokes prior credential verification before testing a replacement token", () => {
  const source = read("apps/mobile/src/settingsView.tsx");
  assert.match(source, /if \(!configuredEndpoint\) \{[\s\S]*return;[\s\S]*\}\s*credentialSession\.clear\(\);\s*clearPaperConnectionVerification\(\);\s*setConnection\(\{ status: "NOT_CONFIGURED", reason: "PAPER connection verification is in progress\." \}\);\s*credentialSession\.connect\(tokenDraft\)/);
  assert.match(source, /if \(result\.status === "READY"\) \{ markPaperConnectionVerified\(configuredEndpoint\); setTokenDraft\(""\); \}/);
});

test("Settings fields use mobile-appropriate endpoint and process-memory secret semantics", () => {
  const source = read("apps/mobile/src/settingsView.tsx");
  assert.match(source, /autoCapitalize="none" autoCorrect=\{false\} editable=\{!busy\} keyboardType="url" label="Cloud endpoint"/);
  assert.match(source, /autoCapitalize="none" autoCorrect=\{false\} editable=\{!busy\} label="세션 토큰"[\s\S]*placeholder="기기에 저장하지 않음"[\s\S]*secureTextEntry/);
  assert.match(source, /Endpoint만 로컬 설정에 저장합니다/);
  assert.match(source, /토큰은 현재 앱 프로세스 메모리에만 존재합니다/);
  assert.match(source, /프로세스 종료 시 삭제됩니다/);
  assert.match(source, /disabled=\{busy\} label=\{connecting \? "연결 확인 중\.\.\." : "저장하고 연결 확인"\}/);
  assert.match(source, /disabled=\{busy \|\| connection\.status !== "READY"\} label="연결 해제"/);
  assert.match(source, /const connectionLabel = connecting \? "확인 중"/);
});

test("PAPER order inputs are numeric-first and locked during an in-flight submit", () => {
  const source = read("apps/mobile/src/tradingView.tsx");
  assert.match(source, /keyboardType="decimal-pad" label="지정 가격"/);
  assert.match(source, /keyboardType="decimal-pad" label=\{`수량/);
  assert.equal((source.match(/editable=\{!submitting\}/g) ?? []).length, 2);
  assert.match(source, /disabled=\{!submitEnabled\}/);
  assert.match(source, /authority: "PAPER_ONLY"/);
  assert.match(source, /productionMutationAllowed: false/);
  assert.doesNotMatch(source, /authority:\s*"LIVE"|productionMutationAllowed:\s*true/);
});