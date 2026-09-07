// Tier runner for the scripts/validate-*.js sprawl.
// Groups the ~40 individual validators into 3 tiers so contributors run one
// command per concern instead of guessing which validate-* file matters.
// Existing per-file scripts and package.json gates are unchanged; this is an
// additive convenience layer. See docs/VALIDATOR_REGISTRY.md for the full map.
//
// Usage:
//   node scripts/validate-tiers.js --tier=safety|architecture|aipos|all
//   node scripts/validate-tiers.js --tier=safety --report-only
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const TIERS = {
  safety: [
    'validate-safety-architecture.js',
    'validate-safety-invariants.js',
    'validate-ai-zero-authority.js',
    'validate-hard-risk-killswitch.js',
    'validate-shadow-governance.js',
    'validate-restricted-live-governance.js',
    'validate-read-only-broker-credential-integration.js',
    'validate-tiny-bounded-live-envelope.js',
    'check-safety-input-literals.js',
  ],
  architecture: [
    'validate-architecture.js',
    'validate-research-architecture.js',
    'validate-architecture-surfaces.js',
    'validate-architecture-change-lifecycle.js',
    'validate-repository-truth.js',
    'validate-capability-registry.js',
    'validate-champion-challenger.js',
    'validate-data-strategy-identity.js',
    'validate-deployment-bundles.js',
    // NOTE: validate-runtime-diagnostics.js is intentionally excluded: it
    // requires --input <absolute.json> plus built artifacts
    // (`pnpm run runtime:diagnostics-validate`), so it is not a zero-arg gate.
    'validate-desktop-runtime.js',
  ],
  aipos: [
    'validate-aipos-drift.js',
    'validate-aipos-cross-ai-conformance.js',
    'validate-aipos-work-order-provenance.js',
    'validate-aipos-evidence.js',
  ],
};

function parseArgs(argv) {
  let tier = 'all';
  let reportOnly = false;
  for (const arg of argv) {
    if (arg.startsWith('--tier=')) tier = arg.slice('--tier='.length);
    else if (arg === '--report-only') reportOnly = true;
  }
  return { tier, reportOnly };
}

function main() {
  const { tier, reportOnly } = parseArgs(process.argv.slice(2));
  const selected =
    tier === 'all' ? ['safety', 'architecture', 'aipos'] : [tier];
  for (const name of selected) {
    if (!TIERS[name]) {
      console.error(`Unknown tier: ${tier} (expected safety|architecture|aipos|all)`);
      process.exit(2);
    }
  }

  const failures = [];
  for (const name of selected) {
    console.log(`--- tier:${name} (${TIERS[name].length} validators) ---`);
    for (const file of TIERS[name]) {
      const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
        stdio: 'inherit',
        windowsHide: true,
      });
      const code = result.error ? 1 : (result.status ?? 1);
      if (code !== 0) {
        failures.push(`${name}/${file}`);
        console.error(`FAIL ${name}/${file} (exit ${code})`);
        if (!reportOnly) process.exit(code);
      }
    }
  }

  if (failures.length > 0) {
    console.error(`TIER REPORT-ONLY: ${failures.length} failure(s): ${failures.join(', ')}`);
    return;
  }
  console.log(`TIERS PASS (${selected.join(',')})`);
}

main();
