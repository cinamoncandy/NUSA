import { describe, expect, it } from "vitest";
import fs from "node:fs";

const themeProvider = fs.readFileSync("apps/mobile/src/ThemeProvider.tsx", "utf8");
const androidTheme = fs.readFileSync("apps/mobile/src/androidInstitutionalTheme.ts", "utf8");
const homeRouter = fs.readFileSync("apps/mobile/src/homeView.tsx", "utf8");
const androidA = fs.readFileSync("apps/mobile/src/androidAHomeView.tsx", "utf8");
const androidB = fs.readFileSync("apps/mobile/src/androidBHomeView.tsx", "utf8");
const aiRouter = fs.readFileSync("apps/mobile/src/aiView.tsx", "utf8");
const androidAi = fs.readFileSync("apps/mobile/src/androidNusaDecisionView.tsx", "utf8");
const markets = fs.readFileSync("apps/mobile/src/marketsView.tsx", "utf8");
const nativeTheme = fs.readFileSync("apps/mobile/android/app/src/main/res/values/styles.xml", "utf8");
const nativeColors = fs.readFileSync("apps/mobile/android/app/src/main/res/values/colors.xml", "utf8");

describe("Android design concepts A and B", () => {
  it("routes concept B only on Android while preserving A for comparison and legacy iOS surfaces", () => {
    expect(themeProvider).toContain('Platform.OS === "android" ? applyAndroidInstitutionalTheme(base) : base');
    expect(homeRouter).toContain('Platform.OS === "android"');
    expect(homeRouter).toContain("AndroidBHomeView");
    expect(homeRouter).not.toContain("AndroidAHomeView");
    expect(homeRouter).not.toContain("AndroidEHomeView");
    expect(homeRouter).not.toContain("AndroidNowView");
    expect(androidA).toContain("ANDROID · A");
    expect(aiRouter).toContain('Platform.OS === "android"');
    expect(aiRouter).toContain("AndroidNusaDecisionView");
    expect(homeRouter).toContain("LegacyHomeView");
    expect(aiRouter).toContain("LegacyAiView");
  });

  it("implements B as a premium supervisory desk with decision-first capital hierarchy", () => {
    expect(androidB).toContain("SUPERVISORY DESK");
    expect(androidB).toContain("PAPER · B");
    expect(androidB).toContain("NOW / 01");
    expect(androidB).toContain("CAPITAL / 02");
    expect(androidB).toContain("NUSA / 03");
    expect(androidB).toContain("EVIDENCE / 04");
    expect(androidB).toContain("VERIFIABLE JUDGMENT");
    expect(androidB).toContain("OWNER COMMAND");
    expect(androidTheme).toContain('background: dark ? "#07101D"');
    expect(androidTheme).toContain('primary: dark ? "#65E0C2"');
    expect(androidTheme).toContain('neonPurple: dark ? "#8F9CFF"');
  });

  it("does not fabricate unavailable financial or authority truth", () => {
    expect(androidB).toContain("전용 invalidation 필드가 없어 조건을 임의 생성하지 않습니다");
    expect(androidB).toContain("PAPER ONLY");
    expect(androidB).toContain("AI ZERO AUTHORITY");
    expect(androidAi).toContain("KEY EVIDENCE");
    expect(androidAi).toContain("COUNTER EVIDENCE");
    for (const source of [androidTheme, androidA, androidB, androidAi]) {
      for (const forbidden of ["submitOrder", "productionMutationAllowed = true", "liveAuthority =", "credentialProvider", "axios", "WebSocket("]) {
        expect(source).not.toContain(forbidden);
      }
    }
  });

  it("preserves the Android interaction floor and native chrome", () => {
    expect(markets).toContain("minHeight: androidInstitutional ? 48 : 48");
    expect(androidB).toContain("minHeight: 48");
    expect(nativeTheme).toContain("android:windowBackground");
    expect(nativeTheme).toContain("android:statusBarColor");
    expect(nativeTheme).toContain("android:navigationBarColor");
    expect(nativeColors).toContain('<color name="nusa_accent">#65E0C2</color>');
  });
});
