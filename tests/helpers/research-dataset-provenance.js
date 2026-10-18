const { createHash } = require("node:crypto");
const sha256 = value => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
module.exports = Object.freeze({
  rawSourceIdentitySha256s: Object.freeze([sha256("test raw source fixture")]),
  transformationGraphSha256: sha256("test transformation graph"),
  transformationConfigSha256: sha256("test transformation config"),
  schemaContractSha256: sha256("test schema contract"),
  qualitySuiteSha256: sha256("test quality suite"),
  qualityResultsSha256: sha256("test quality results"),
  derivedFeatureLineageSha256: sha256("test derived feature lineage"),
  replayRuntimeSha256: sha256("test replay runtime"),
});
