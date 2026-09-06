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

test("Settings revokes prior verification and uses bootstrap-first credential routing", () => {
  const source = read("apps/mobile/src/settingsView.tsx");
  const guard = source.indexOf("if (!configuredEndpoint)");
  const clearSession = source.indexOf("credentialSession.clear();", guard);
  const clearVerification = source.indexOf("clearPaperConnectionVerification();", clearSession);
  const inProgress = source.indexOf('reason: "Cloud PAPER connection verification is in progress."', clearVerification);
  const connectBootstrap = source.indexOf("credentialSession.connect(tokenDraft);", inProgress);
  const firstProbe = source.indexOf("let result = await loadPersonalPaperOperations", connectBootstrap);
  const fallbackGate = source.indexOf('shouldFallbackToMobileEnrollment(tokenDraft, result.status === "READY")', firstProbe);
  const fallbackClear = source.indexOf("credentialSession.clear();", fallbackGate);
  const enroll = source.indexOf("await credentialSession.enroll(tokenDraft, installationId);", fallbackClear);
  const secondProbe = source.indexOf("result = await loadPersonalPaperOperations", enroll);
  assert.ok(guard >= 0 && clearSession > guard && clearVerification > clearSession && inProgress > clearVerification);
  assert.ok(connectBootstrap > inProgress && firstProbe > connectBootstrap, "raw credential must try one-time bootstrap before enrollment");
  assert.ok(fallbackGate > firstProbe && fallbackClear > fallbackGate && enroll > fallbackClear && secondProbe > enroll, "user-credential fallback must be fail-closed and re-probed");
  assert.match(source, /if \(result\.status === "READY"\) \{ markPaperConnectionVerified\(configuredEndpoint\); setTokenDraft\(""\); \}/);
});

test("Settings optional Cloud PAPER fields keep one-time secret bootstrap semantics", () => {
  const source = read("apps/mobile/src/settingsView.tsx");
  assert.match(source, /keyboardType="url" label="Cloud endpoint \(선택\)"/);
  assert.match(source, /label="1회용 연결 토큰 \(선택\)"[\s\S]*placeholder="Cloud를 사용할 때만 입력"[\s\S]*secureTextEntry/);
  assert.match(source, /bootstrap token은 저장하지 않고 한 번만 세션으로 교환합니다/);
  assert.match(source, /LOCAL PAPER 거래에는 사용하지 않습니다/);
  assert.match(source, /disabled=\{busy\} label=\{connecting \? "연결 확인 중\.\.\." : "Cloud 연결"\}/);
  assert.match(source, /disabled=\{busy \|\| connection\.status !== "READY"\} label="Cloud 연결 해제"/);
  assert.match(source, /const cloudConnectionLabel = connecting \? "확인 중"/);
});

test("PAPER order inputs are numeric-first and locked during an in-flight submit", () => {
  const source = read("apps/mobile/src/tradingViewLegacy.tsx");
  assert.match(source, /keyboardType="decimal-pad" label="지정 가격"/);
  assert.match(source, /keyboardType="decimal-pad" label=\{`수량/);
  assert.equal((source.match(/editable=\{!submitting\}/g) ?? []).length, 2);
  assert.match(source, /disabled=\{!submitEnabled\}/);
  assert.match(source, /authority: "PAPER_ONLY"/);
  assert.match(source, /productionMutationAllowed: false/);
  assert.doesNotMatch(source, /authority:\s*"LIVE"|productionMutationAllowed:\s*true/);
});