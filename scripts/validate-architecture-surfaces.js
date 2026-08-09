const { existsSync, readFileSync, readdirSync, statSync } = require("node:fs");
const { join, relative } = require("node:path");

const MANIFEST_PATH = "config/architecture/surfaces.json";
const DISCOVERY_RULES = Object.freeze([
  { marker: "ipcMain.handle(", roots: ["apps/desktop/src"] },
  { marker: "contextBridge.exposeInMainWorld(", roots: ["apps/desktop/src"] },
  { marker: "registrar.handle(", roots: ["apps/desktop/src"] },
  { marker: "http.createServer(", roots: ["apps/desktop/src", "apps/cloud/src"] },
  { marker: "process.argv.slice(2)", paths: ["scripts/nusa.js"] }
]);

function normalize(path) {
  return path.replaceAll("\\", "/");
}

function sourceFiles(root, relativeRoot) {
  const absoluteRoot = join(root, relativeRoot);
  if (!existsSync(absoluteRoot)) return [];
  const files = [];
  const visit = (directory) => {
    for (const name of readdirSync(directory)) {
      const absolute = join(directory, name);
      const rel = normalize(relative(root, absolute));
      if (name === "node_modules" || name === "dist" || name === "coverage") continue;
      const stat = statSync(absolute);
      if (stat.isDirectory()) {
        if (name === "tests" || name === "__tests__") continue;
        visit(absolute);
      } else if (/\.(?:js|ts|mjs|cjs)$/.test(name) && !/\.(?:test|spec)\.[^.]+$/.test(name)) {
        files.push(rel);
      }
    }
  };
  visit(absoluteRoot);
  return files;
}

function rulePaths(root, rule) {
  const explicit = Array.isArray(rule.paths) ? rule.paths : [];
  const scanned = (Array.isArray(rule.roots) ? rule.roots : []).flatMap((scanRoot) => sourceFiles(root, scanRoot));
  return [...new Set([...explicit, ...scanned].map(normalize))];
}

function discoverSurfaceOwners(root = process.cwd()) {
  const discovered = new Map();
  for (const rule of DISCOVERY_RULES) {
    for (const path of rulePaths(root, rule)) {
      const absolute = join(root, path);
      if (!existsSync(absolute)) continue;
      const source = readFileSync(absolute, "utf8");
      if (!source.includes(rule.marker)) continue;
      const markers = discovered.get(path) || new Set();
      markers.add(rule.marker);
      discovered.set(path, markers);
    }
  }
  return new Map([...discovered.entries()].map(([path, markers]) => [path, [...markers].sort()]));
}

function loadManifest(root, failures) {
  const path = join(root, MANIFEST_PATH);
  if (!existsSync(path)) {
    failures.push(`ARCH_SURFACE_MANIFEST_MISSING:${MANIFEST_PATH}`);
    return { version: 0, invariants: {}, surfaces: [] };
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    failures.push("ARCH_SURFACE_MANIFEST_INVALID_JSON");
    return { version: 0, invariants: {}, surfaces: [] };
  }
}

function validateArchitectureSurfaces(root = process.cwd()) {
  const failures = [];
  const manifest = loadManifest(root, failures);
  if (manifest.version !== 1) failures.push("ARCH_SURFACE_MANIFEST_VERSION_INVALID");
  if (manifest.invariants?.liveAuthority !== "NONE") failures.push("ARCH_SURFACE_GLOBAL_LIVE_AUTHORITY_DRIFT");
  if (manifest.invariants?.productionMutationAllowed !== false) failures.push("ARCH_SURFACE_GLOBAL_PRODUCTION_MUTATION_DRIFT");
  if (manifest.invariants?.credentialExecutionAllowed !== false) failures.push("ARCH_SURFACE_GLOBAL_CREDENTIAL_EXECUTION_DRIFT");

  const surfaces = Array.isArray(manifest.surfaces) ? manifest.surfaces : [];
  if (!Array.isArray(manifest.surfaces)) failures.push("ARCH_SURFACE_LIST_INVALID");
  const ids = new Set();
  const bindings = new Set();
  const registered = new Map();

  for (const surface of surfaces) {
    if (!surface || typeof surface !== "object") { failures.push("ARCH_SURFACE_ENTRY_INVALID"); continue; }
    if (typeof surface.id !== "string" || !surface.id) failures.push("ARCH_SURFACE_ID_MISSING");
    else if (ids.has(surface.id)) failures.push(`ARCH_SURFACE_DUPLICATE_ID:${surface.id}`);
    else ids.add(surface.id);

    if (typeof surface.path !== "string" || !surface.path) { failures.push(`ARCH_SURFACE_PATH_MISSING:${surface.id || "unknown"}`); continue; }
    const path = normalize(surface.path);
    const marker = typeof surface.marker === "string" ? surface.marker : "";
    if (!marker) failures.push(`ARCH_SURFACE_MARKER_MISSING:${path}`);

    if (marker) {
      const binding = `${path}\u0000${marker}`;
      if (bindings.has(binding)) failures.push(`ARCH_SURFACE_DUPLICATE_BINDING:${path}:${marker}`);
      else bindings.add(binding);
      const markers = registered.get(path) || new Set();
      markers.add(marker);
      registered.set(path, markers);
    } else if (!registered.has(path)) {
      registered.set(path, new Set());
    }

    if (!existsSync(join(root, path))) failures.push(`ARCH_SURFACE_OWNER_MISSING:${path}`);
    else if (!marker || !readFileSync(join(root, path), "utf8").includes(marker)) failures.push(`ARCH_SURFACE_MARKER_DRIFT:${path}`);
    if (surface.liveAuthority !== "NONE") failures.push(`ARCH_SURFACE_LIVE_AUTHORITY_DRIFT:${path}`);
    if (surface.productionMutationAllowed !== false) failures.push(`ARCH_SURFACE_PRODUCTION_MUTATION_DRIFT:${path}`);
    if (surface.credentialExecutionAllowed !== false) failures.push(`ARCH_SURFACE_CREDENTIAL_EXECUTION_DRIFT:${path}`);
  }

  const discovered = discoverSurfaceOwners(root);
  for (const [path, markers] of discovered) {
    const registeredMarkers = registered.get(path);
    if (!registeredMarkers) {
      failures.push(`ARCH_SURFACE_UNREGISTERED_OWNER:${path}`);
      continue;
    }
    for (const marker of markers) {
      if (!registeredMarkers.has(marker)) failures.push(`ARCH_SURFACE_UNREGISTERED_MARKER:${path}:${marker}`);
    }
  }
  for (const [path, markers] of registered) {
    const discoveredMarkers = discovered.get(path);
    if (!discoveredMarkers) {
      failures.push(`ARCH_SURFACE_STALE_OWNER:${path}`);
      continue;
    }
    const discoveredSet = new Set(discoveredMarkers);
    for (const marker of markers) {
      if (!discoveredSet.has(marker)) failures.push(`ARCH_SURFACE_STALE_MARKER:${path}:${marker}`);
    }
  }

  return { ok: failures.length === 0, failures, discovered: [...discovered.keys()].sort() };
}

if (require.main === module) {
  const result = validateArchitectureSurfaces();
  if (!result.ok) {
    console.error("Architecture surface governance validation FAILED");
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(`Architecture surface governance validation PASS (${result.discovered.length} governed owners)`);
}

module.exports = { DISCOVERY_RULES, MANIFEST_PATH, discoverSurfaceOwners, validateArchitectureSurfaces };
