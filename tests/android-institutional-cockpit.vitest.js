import { describe, expect, it } from "vitest";
import fs from "node:fs";

const themeProvider = fs.readFileSync("apps/mobile/src/ThemeProvider.tsx", "utf8");
const androidTheme = fs.readFileSync("apps/mobile/src/androidInstitutionalTheme.ts", "utf8");
const homeProfile = fs.readFileSync("apps/mobile/src/homeVisualProfile.ts", "utf8");
const nativeTheme = fs.readFileSync("apps/mobile/android/app/src/main/res/values/styles.xml", "utf8");
const nativeColors = fs.readFileSync("apps/mobile/android/app/src/main/res/values/colors.xml", "utf8");

describe("Android institutional cockpit", () => {
  it("applies the premium visual overlay only on Android", () => {
    expect(themeProvider).toContain('Platform.OS === "android" ? applyAndroidInstitutionalTheme(base) : base');
    expect(themeProvider).toContain('Platform.OS === "android" ? <StatusBar');
    expect(homeProfile).toContain('Platform.OS === "android" && preset === "master"');
  });

  it("uses a restrained graphite + teal institutional palette", () => {
    expect(androidTheme).toContain('background: dark ? "#020506"');
    expect(androidTheme).toContain('primary: dark ? "#41E0C2"');
    expect(androidTheme).toContain('warning: dark ? "#E7BC68"');
    expect(androidTheme).toContain('danger: dark ? "#FF718A"');
    expect(androidTheme).toContain('monoFamily: "monospace"');
  });

  it("keeps the overlay presentation-only", () => {
    for (const forbidden of ["submitOrder", "productionMutationAllowed = true", "liveAuthority =", "credentialProvider", "fetch(", "axios", "WebSocket"]) {
      expect(androidTheme).not.toContain(forbidden);
    }
    expect(androidTheme).toContain("visual tokens only");
  });

  it("aligns Android launch and system chrome with the cockpit", () => {
    expect(nativeTheme).toContain("android:windowBackground");
    expect(nativeTheme).toContain("android:statusBarColor");
    expect(nativeTheme).toContain("android:navigationBarColor");
    expect(nativeColors).toContain('<color name="nusa_accent">#41E0C2</color>');
  });
});
