import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const settingsSource = readFileSync(new URL("../apps/mobile/src/settings.ts", import.meta.url), "utf8");
const settingsViewSource = readFileSync(new URL("../apps/mobile/src/settingsView.tsx", import.meta.url), "utf8");

test("usage telemetry remains explicit opt-in and off by default", () => {
  assert.match(settingsSource, /usageTelemetry:\s*Object\.freeze\(\{ enabled: false \}\)/);
  assert.match(settingsSource, /input\.usageTelemetry \?\? DEFAULT_SETTINGS\.usageTelemetry/);
  assert.match(settingsViewSource, /settings-usage-telemetry/);
  assert.match(settingsViewSource, /selectedKey=\{settings\.usageTelemetry\.enabled \? "ON" : "OFF"\}/);
  assert.match(settingsViewSource, /usageTelemetry:\s*\{ enabled: next === "ON" \}/);
});

test("usage telemetry UI persists through the canonical settings path without optimistic state", () => {
  const updateStart = settingsViewSource.indexOf("const updateUsageTelemetry");
  assert.notEqual(updateStart, -1);
  const updateSlice = settingsViewSource.slice(updateStart, updateStart + 320);
  assert.match(updateSlice, /persist\(\{ \.\.\.settings, usageTelemetry:/);
  assert.doesNotMatch(updateSlice, /setSettings\(/);
  assert.match(settingsViewSource, /void persist\(DEFAULT_SETTINGS\)/);
});

test("usage telemetry copy is optional and does not overclaim collection", () => {
  assert.match(settingsViewSource, /선택 사항이며 기본값은 꺼짐입니다/);
  assert.match(settingsViewSource, /이 설정을 켠 것만으로 수집이 활성화됐다고 간주하지 않습니다/);
});
