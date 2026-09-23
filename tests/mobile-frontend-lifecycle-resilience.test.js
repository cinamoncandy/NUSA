const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appPath = path.join(__dirname, "..", "apps", "mobile", "App.tsx");
const source = () => fs.readFileSync(appPath, "utf8");

test("mobile app shell uses safe-area-context as the root inset authority", () => {
  const app = source();
  assert.match(app, /import \{ SafeAreaProvider, SafeAreaView \} from "react-native-safe-area-context"/);
  assert.match(app, /return <SafeAreaProvider><ThemeProvider/);
  assert.doesNotMatch(app, /SafeAreaView,[\s\S]*from "react-native"/);
});

test("PAPER dashboard refresh is single-flight and discards stale endpoint or session results", () => {
  const app = source();
  assert.match(app, /const refreshInFlightRef = useRef<Promise<void> \| null>\(null\)/);
  assert.match(app, /if \(refreshInFlightRef\.current\) return refreshInFlightRef\.current/);
  assert.match(app, /const generation = refreshGenerationRef\.current/);
  assert.match(app, /generation !== refreshGenerationRef\.current/);
  assert.match(app, /const currentEndpoint = getConfiguredPaperEndpoint\(\)/);
  assert.match(app, /currentEndpoint !== endpoint \|\| !isPaperConnectionVerified\(endpoint\)/);
  assert.match(app, /if \(refreshInFlightRef\.current === request\) refreshInFlightRef\.current = null/);
});

test("automatic PAPER polling runs only while signed in and foregrounded and never overlaps by interval", () => {
  const app = source();
  assert.match(app, /AppState\.addEventListener\("change", \(nextState\) =>/);
  assert.match(app, /dispatchRuntime\(\{ type: nextState === "active" \? "APP_FOREGROUND" : "APP_BACKGROUND" \}\)/);
  assert.match(app, /authStatus !== "SIGNED_IN" \|\| appState !== "active"/);
  assert.match(app, /PAPER_REFRESH_INTERVAL_MS = 5000/);
  assert.match(app, /timer = setTimeout\(\(\) => \{/);
  assert.match(app, /void refresh\(\)\.catch\(\(\) => undefined\)\.finally\(scheduleNext\)/);
  assert.doesNotMatch(app, /setInterval\(/);
  assert.match(app, /refreshGenerationRef\.current \+= 1/);
});

test("manual refresh always releases its visual busy state", () => {
  const app = source();
  assert.match(app, /const onRefresh = useCallback\(async \(\) => \{[\s\S]*setRefreshing\(true\);[\s\S]*try \{[\s\S]*await refresh\(\);[\s\S]*\} finally \{[\s\S]*setRefreshing\(false\);/);
});

test("utility shell controls honor the 48px system touch target", () => {
  const app = source();
  // The contract is the 48px floor, not an exact height. Pinning exact values made this a mirror of
  // the stylesheet: a nav bar that grew from 66 to 68 failed it while getting *more* accessible.
  // Parse the declared minimum instead, so only a real shrink below 48 can fail.
  for (const style of ["utilityButton", "utilityMenuButton", "utilityClose", "navItem"]) {
    const declaration = new RegExp(style + ": \\{([^}]*)\\}").exec(app);
    assert.ok(declaration, style + " must declare a style");
    const minHeight = /minHeight:\s*(\d+)/.exec(declaration[1]);
    assert.ok(minHeight, style + " must declare a minHeight");
    assert.ok(Number(minHeight[1]) >= 48, style + " minHeight " + minHeight[1] + " is below the 48px system touch target");
  }
});
