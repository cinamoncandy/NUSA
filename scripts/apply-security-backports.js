"use strict";

const { applyBackports } = require("./security-backports.js");

const result = applyBackports();
console.log(`[security-backports] ${result.status} image-size=${result.packages["image-size"]} nanoid=${result.packages.nanoid}`);
if (result.status !== "PASS") {
  for (const finding of result.findings) console.error(`[security-backports] ${finding}`);
  process.exit(1);
}
