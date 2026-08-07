"use strict";
/**
 * Flags safety-gate inputs written as literal booleans.
 *
 * Five separate defects in this repository shared one shape: a gate whose own logic was correct,
 * handed a constant instead of a measurement, so the check could never fire. The pilot promotion
 * gate was told its prohibited capabilities were absent. The pre-trade risk gateway was told no
 * live or authenticated path existed. The shadow runtime's "second, independent confirmation"
 * was told every precondition held. In each case the gate was structurally incapable of
 * disagreeing with its caller, and nothing failed, because a gate that always passes looks
 * exactly like a gate that has nothing to complain about.
 *
 * This scans for the pattern rather than the instances: a field whose name states a safety
 * condition, assigned a bare `true` or `false` at a call site. Legitimate cases exist -- a
 * dry-run CLI, a test fixture, a hard block the system enforces structurally -- so a site can be
 * waived with an inline `safety-input-literal-ok:` comment stating why. The waiver is the point:
 * it turns an invisible default into a recorded decision someone had to write a reason for.
 */
const { readFileSync, readdirSync, statSync } = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SCAN_ROOTS = ["apps/desktop/src", "apps/cloud/src", "scripts"];

/**
 * Restricted to the capability-detection fields: whether a live order path, an authenticated
 * mutation path, or credential storage exists. A literal here directly disables a block that
 * stands between this build and real money, and the answer is knowable --
 * scripts/build-deployment-descriptor.js measures all three from the source tree.
 *
 * Deliberately excluded:
 *
 * - `productionMutationAllowed` and similar hard blocks. The code enforces those by never
 *   setting them true anywhere, so a literal false is the enforcement, not an unasked question.
 * - killSwitch, warmedUp, and reconciliation. Scenario runners and smoke harnesses legitimately
 *   construct these by hand -- risk-safety-drill-runner.js builds 63 request fixtures that way.
 *   Flagging every one of these produced 37 findings on the first run, nearly all correct code.
 *   A check that needs thirty waivers on its first run teaches people to add waivers, which is
 *   the same failure it exists to prevent.
 *
 * `openP0` was added back in after an audit of the cloud paper-engine port found a real,
 * unwaived instance of the exact pattern this file exists to catch: the cloud control-state
 * adapter hands the risk gate a hardcoded absent value with no P0 alert ledger behind it -- a
 * HALT-level reason code (OPEN_P0_ALERT) that can never fire on the cloud path. That file's own
 * doc comment already explained the gap; what it didn't do was register in the one place a
 * reviewer would see every occurrence of "a safety field the gate blocks on is answered with a
 * constant." The three legitimate scenario/dry-run sites this field touches are each waived
 * individually where they occur, same as this field was excluded wholesale before.
 */
const SAFETY_INPUT_FIELDS = [
  "liveCapabilityDetected",
  "privateApiCapabilityDetected",
  "liveAbsent",
  "privateApiAbsent",
  "credentialAbsent",
  "openP0"
];

const FIELD_PATTERN = new RegExp(`\\b(${SAFETY_INPUT_FIELDS.join("|")})\\s*:\\s*(true|false)\\b`, "g");
const WAIVER = "safety-input-literal-ok:";

function sourceFiles(dir, collected = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return collected; }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) { sourceFiles(full, collected); continue; }
    if (!/\.(ts|js)$/.test(entry)) continue;
    if (/\.test\.(ts|js)$/.test(entry)) continue;
    collected.push(full);
  }
  return collected;
}

function scan() {
  const findings = [];
  for (const root of SCAN_ROOTS) {
    for (const file of sourceFiles(path.join(ROOT, root))) {
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Look upward through the contiguous comment block above the line. A one-line waiver is
        // rarely enough to explain why a constant is correct here, and requiring the marker on
        // the last line would push authors toward short reasons or none at all.
        let waived = line.includes(WAIVER);
        for (let j = i - 1; j >= 0 && !waived; j--) {
          const above = lines[j].trim();
          if (!above.startsWith("//") && !above.startsWith("*") && !above.startsWith("/*")) break;
          if (above.includes(WAIVER)) waived = true;
        }
        if (waived) continue;
        for (const match of line.matchAll(FIELD_PATTERN)) {
          findings.push({ file: path.relative(ROOT, file), line: i + 1, field: match[1], value: match[2] });
        }
      }
    }
  }
  return findings;
}

if (require.main === module) {
  const findings = scan();
  if (findings.length === 0) {
    console.log("[safety-inputs] no unwaived safety-gate literals found");
  } else {
    console.error(`[safety-inputs] ${findings.length} safety-gate input(s) written as a literal:`);
    for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.field}: ${f.value}`);
    console.error(`\nA gate handed a constant cannot fail. Pass the measured or declared state, or`);
    console.error(`waive the site with an inline "${WAIVER} <reason>" comment.`);
    process.exitCode = 1;
  }
}

module.exports = { scan, SAFETY_INPUT_FIELDS, WAIVER };
