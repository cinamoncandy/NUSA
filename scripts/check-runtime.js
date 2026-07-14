"use strict";

const MINIMUM_NODE_MAJOR = 24;
const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);

if (!Number.isInteger(major) || major < MINIMUM_NODE_MAJOR) {
  console.error(`Dokkaebi requires Node.js >= ${MINIMUM_NODE_MAJOR}. Current: ${process.versions.node}`);
  process.exit(1);
}

try {
  const sqlite = require("node:sqlite");
  if (typeof sqlite.DatabaseSync !== "function") throw new Error("DatabaseSync export is unavailable");
} catch (error) {
  console.error("The current Node.js runtime does not provide the required node:sqlite API without flags.");
  console.error("Install the supported Node.js version declared in package.json; do not rely on --experimental-sqlite in production.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

console.log(`Runtime preflight passed: Node ${process.versions.node}, node:sqlite available.`);
