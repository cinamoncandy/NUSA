const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  PAPER_AUTHORITY_BINDINGS,
  validateArchitectureSurfaces,
  validatePaperAuthorityTopology
} = require("../scripts/validate-architecture-surfaces.js");

const governed = (binding, authority = binding.authority, overrides = {}) => Object.freeze({
  id: `${authority.toLowerCase()}-${binding.path.replaceAll("/", "-")}`,
  path: binding.path,
  marker: binding.marker,
  authority,
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  credentialExecutionAllowed: false,
  ...overrides
});

const validPaperSurfaces = () => [
  governed(PAPER_AUTHORITY_BINDINGS.desktopLocalSimulation),
  governed(PAPER_AUTHORITY_BINDINGS.cloudCanonicalWriter),
  governed(PAPER_AUTHORITY_BINDINGS.cloudCommandIngress)
];

test("repository architecture surfaces declare one Cloud canonical PAPER writer and one canonical ingress", () => {
  const result = validateArchitectureSurfaces(path.resolve(__dirname, ".."), { requirePaperAuthorityTopology: true });
  assert.equal(result.ok, true, result.failures.join("\n"));
});

test("canonical PAPER topology accepts Cloud writer plus Desktop local simulation", () => {
  const failures = [];
  validatePaperAuthorityTopology(validPaperSurfaces(), failures);
  assert.deepEqual(failures, []);
});

test("canonical PAPER topology rejects a second canonical writer", () => {
  const failures = [];
  validatePaperAuthorityTopology([
    ...validPaperSurfaces(),
    governed({ path: "apps/cloud/src/secondaryRuntime.ts", marker: "secondaryBoundary", authority: "CANONICAL_PAPER_WRITER" })
  ], failures);
  assert.ok(failures.includes("ARCH_SURFACE_CANONICAL_PAPER_WRITER_COUNT:2"));
});

test("Desktop PaperBroker cannot be promoted to canonical PAPER authority", () => {
  const failures = [];
  const surfaces = validPaperSurfaces().map((surface) => surface.marker === PAPER_AUTHORITY_BINDINGS.desktopLocalSimulation.marker
    ? Object.freeze({ ...surface, authority: "CANONICAL_PAPER_WRITER" })
    : surface);
  validatePaperAuthorityTopology(surfaces, failures);
  assert.ok(failures.some((failure) => failure.startsWith("ARCH_SURFACE_CLIENT_CANONICAL_PAPER_AUTHORITY:apps/desktop/src/main.ts:")));
  assert.ok(failures.includes("ARCH_SURFACE_PAPER_AUTHORITY_BINDING_DRIFT:desktopLocalSimulation:CANONICAL_PAPER_WRITER"));
});

test("canonical PAPER authority bindings retain zero LIVE and production mutation authority", () => {
  const failures = [];
  const surfaces = validPaperSurfaces().map((surface) => surface.marker === PAPER_AUTHORITY_BINDINGS.cloudCanonicalWriter.marker
    ? Object.freeze({ ...surface, productionMutationAllowed: true })
    : surface);
  validatePaperAuthorityTopology(surfaces, failures);
  assert.ok(failures.includes("ARCH_SURFACE_PAPER_AUTHORITY_SAFETY_DRIFT:cloudCanonicalWriter"));
});
