import { DatabaseSync, StatementSync } from "node:sqlite";
import Module from "node:module";
import { runInNewContext } from "node:vm";

// Production preloads this module before application modules run. Keep the mutable Node core
// references inside this frozen, non-replaceable module so later application code cannot swap
// the VM factory, SQLite methods, or result enumeration used by the integrity boundary.
const cleanRealm = runInNewContext("({ apply: Reflect.apply, functionToString: Function.prototype.toString, values: Object.values })") as {
  readonly apply: typeof Reflect.apply;
  readonly functionToString: (value: Function) => string;
  readonly values: typeof Object.values;
};
const nativeDatabasePrepare = DatabaseSync.prototype.prepare;
const nativeStatementGet = StatementSync.prototype.get;
const nativeModuleLoadDescriptor = Object.getOwnPropertyDescriptor(Module, "_load");
const nativeModuleLoad = nativeModuleLoadDescriptor?.value;
const nativeModuleRequireDescriptor = Object.getOwnPropertyDescriptor(Module.prototype, "require");
const nativeModuleRequire = nativeModuleRequireDescriptor?.value;
if (typeof nativeModuleLoad !== "function" || typeof nativeModuleRequire !== "function") {
  throw new Error("CommonJS module loader is unavailable; refusing SQLite integrity bootstrap");
}
const nativeMethodsAreCanonical = cleanRealm.apply(cleanRealm.functionToString, nativeDatabasePrepare, []) === "function prepare() { [native code] }"
  && cleanRealm.apply(cleanRealm.functionToString, nativeStatementGet, []) === "function get() { [native code] }";

function prepareSqliteIntegrityStatement(connection: DatabaseSync, sql: string): StatementSync {
  if (!nativeMethodsAreCanonical) throw new Error("native SQLite integrity methods are unavailable; refusing integrity check");
  return cleanRealm.apply(nativeDatabasePrepare, connection, [sql]);
}

function getSqliteIntegrityResult(statement: StatementSync): Record<string, unknown> | undefined {
  if (!nativeMethodsAreCanonical) throw new Error("native SQLite integrity methods are unavailable; refusing integrity check");
  return cleanRealm.apply(nativeStatementGet, statement, []) as Record<string, unknown> | undefined;
}

function sqliteIntegrityResultIsOk(result: Record<string, unknown> | undefined): boolean {
  if (result == null) return false;
  const values = cleanRealm.apply(cleanRealm.values, Object, [result]) as unknown[];
  return values.length === 1 && values[0] === "ok";
}

export const sqliteIntegrityBoundary = Object.freeze({
  prepare: prepareSqliteIntegrityStatement,
  read: getSqliteIntegrityResult,
  resultIsOk: sqliteIntegrityResultIsOk,
});

// This is a process bootstrap capability. Prevent subsequent application code from replacing
// its exports or deleting the cache entry between the preload and storage module initialization.
Object.freeze(exports);
// The storage consumer is loaded after this preload, so it still traverses Node's CommonJS loader.
// Pin the loader at the same trust boundary: otherwise later code can forge the bootstrap export
// returned for `require("./sqliteIntegrityBootstrap")`, regardless of cache-entry protections.
Object.defineProperty(Module, "_load", {
  configurable: false,
  enumerable: nativeModuleLoadDescriptor?.enumerable ?? true,
  writable: false,
  value: nativeModuleLoad,
});
// Node's generated `require()` dispatches through the current module's `.require` method before
// reaching Module._load. Pin that entry point too; otherwise application code can bypass the
// protected loader by replacing Module.prototype.require and fabricating the bootstrap export.
Object.defineProperty(Module.prototype, "require", {
  configurable: false,
  enumerable: nativeModuleRequireDescriptor?.enumerable ?? false,
  writable: false,
  value: nativeModuleRequire,
});
const bootstrapCache = require.cache;
const bootstrapModule = bootstrapCache?.[__filename];
if (bootstrapModule != null && bootstrapCache != null) {
  // `require.cache` aliases Module._cache. Protect the cache reference itself as well as this
  // entry: otherwise application code can replace Module._cache wholesale and install a forged
  // bootstrap export that bypasses the immutable entry in the original cache object.
  Object.defineProperty(Module, "_cache", { configurable: false, enumerable: true, writable: false, value: bootstrapCache });
  Object.defineProperty(bootstrapModule, "exports", { configurable: false, enumerable: true, writable: false, value: exports });
  Object.defineProperty(bootstrapCache, __filename, { configurable: false, enumerable: true, writable: false, value: bootstrapModule });
}
