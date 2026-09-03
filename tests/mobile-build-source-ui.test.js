import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const moreView = fs.readFileSync("apps/mobile/src/moreView.tsx", "utf8");
const generatedConfig = fs.readFileSync("apps/mobile/src/generatedBuildConfig.ts", "utf8");

test("mobile UI exposes exact packaged build source identity", () => {
  assert.match(generatedConfig, /export const BUILD_SOURCE_SHA/);
  assert.match(moreView, /BUILD_SOURCE_SHA/);
  assert.match(moreView, /testID="mobile-build-source"/);
  assert.match(moreView, /빌드 \{buildLabel\}/);
  assert.match(moreView, /BUILD_SOURCE_SHA\.slice\(0, 8\)/);
});
