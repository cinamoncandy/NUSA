import { app } from "electron";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, promises as fs } from "node:fs";
import { request } from "node:https";
import { basename, dirname, join } from "node:path";
import { spawn } from "node:child_process";

const RELEASE_BASE = "https://github.com/cinamoncandy/NUSA/releases/download/nusa-windows";
const PROVENANCE_URL = `${RELEASE_BASE}/NUSA-Windows.provenance.txt`;
const CHECKSUM_URL = `${RELEASE_BASE}/NUSA-Windows-Setup.exe.sha256`;
const INSTALLER_URL = `${RELEASE_BASE}/NUSA-Windows-Setup.exe`;
const BUILD_INFO_RELATIVE = "dist/apps/desktop/release-build.json";
const MAX_REDIRECTS = 5;
const MAX_TEXT_BYTES = 64 * 1024;
const MAX_INSTALLER_BYTES = 250 * 1024 * 1024;
const CHECK_INTERVAL_MS = 10 * 60 * 1000;

export interface ReleaseBuildInfo {
  source_sha: string;
}

export interface ReleaseProvenance {
  source_sha: string;
}

export function parseReleaseProvenance(text: string): ReleaseProvenance {
  const fields = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    fields.set(line.slice(0, index), line.slice(index + 1));
  }
  const sourceSha = fields.get("source_sha") ?? "";
  if (!/^[0-9a-f]{40}$/i.test(sourceSha)) throw new Error("invalid release provenance source_sha");
  return { source_sha: sourceSha.toLowerCase() };
}

export function parseInstallerSha256(text: string): string {
  const match = text.trim().match(/^([0-9a-f]{64})\s+\*?NUSA-Windows-Setup\.exe$/i);
  if (!match) throw new Error("invalid installer SHA-256 manifest");
  return match[1].toLowerCase();
}

function assertAllowedUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") throw new Error("update URL must use HTTPS");
  const host = url.hostname.toLowerCase();
  if (host !== "github.com" && !host.endsWith(".githubusercontent.com")) {
    throw new Error(`update redirect host is not allowed: ${host}`);
  }
  return url;
}

function getHttpsResponse(rawUrl: string, redirects = 0): Promise<import("node:http").IncomingMessage> {
  const url = assertAllowedUrl(rawUrl);
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: "GET",
      headers: {
        "User-Agent": "NUSA-Windows-AutoUpdater/1",
        Accept: "application/octet-stream"
      }
    }, (response) => {
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = response.headers.location;
        response.resume();
        if (!location) return reject(new Error("update redirect missing Location header"));
        if (redirects >= MAX_REDIRECTS) return reject(new Error("too many update redirects"));
        const nextUrl = new URL(location, url).toString();
        void getHttpsResponse(nextUrl, redirects + 1).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        response.resume();
        return reject(new Error(`update request failed with HTTP ${status}`));
      }
      resolve(response);
    });
    req.setTimeout(30_000, () => req.destroy(new Error("update request timeout")));
    req.on("error", reject);
    req.end();
  });
}

async function fetchText(rawUrl: string, maxBytes = MAX_TEXT_BYTES): Promise<string> {
  const response = await getHttpsResponse(rawUrl);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw new Error("update metadata exceeds size limit");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function downloadInstaller(rawUrl: string, destination: string): Promise<void> {
  const response = await getHttpsResponse(rawUrl);
  const declaredLength = Number(response.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_INSTALLER_BYTES) {
    response.resume();
    throw new Error("installer exceeds size limit");
  }

  await fs.mkdir(dirname(destination), { recursive: true });
  const stream = createWriteStream(destination, { flags: "w" });
  let total = 0;
  try {
    for await (const chunk of response) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > MAX_INSTALLER_BYTES) throw new Error("installer exceeds size limit");
      if (!stream.write(buffer)) await new Promise<void>((resolve) => stream.once("drain", resolve));
    }
    await new Promise<void>((resolve, reject) => stream.end((error?: Error | null) => error ? reject(error) : resolve()));
  } catch (error) {
    stream.destroy();
    await fs.rm(destination, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(path);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("error", reject);
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

async function readCurrentBuildInfo(): Promise<ReleaseBuildInfo | null> {
  const path = join(app.getAppPath(), BUILD_INFO_RELATIVE);
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(await fs.readFile(path, "utf8")) as Partial<ReleaseBuildInfo>;
  if (!parsed.source_sha || !/^[0-9a-f]{40}$/i.test(parsed.source_sha)) return null;
  return { source_sha: parsed.source_sha.toLowerCase() };
}

function launchSilentInstaller(installerPath: string): void {
  const child = spawn(installerPath, ["/S"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
}

let updateCheckInFlight = false;
let updateInstallScheduled = false;

export async function checkForDesktopUpdate(): Promise<void> {
  if (!app.isPackaged || process.platform !== "win32" || updateCheckInFlight || updateInstallScheduled) return;
  updateCheckInFlight = true;
  try {
    const current = await readCurrentBuildInfo();
    if (!current) {
      console.warn("[desktop-update] packaged build lacks release-build.json; automatic update disabled for this build");
      return;
    }

    const provenance = parseReleaseProvenance(await fetchText(PROVENANCE_URL));
    if (provenance.source_sha === current.source_sha) return;

    const expectedSha256 = parseInstallerSha256(await fetchText(CHECKSUM_URL));
    const installerPath = join(app.getPath("temp"), `NUSA-Windows-Setup-${provenance.source_sha.slice(0, 8)}.exe`);
    await downloadInstaller(INSTALLER_URL, installerPath);
    const actualSha256 = await sha256File(installerPath);
    if (actualSha256 !== expectedSha256) {
      await fs.rm(installerPath, { force: true }).catch(() => undefined);
      throw new Error(`installer SHA-256 mismatch: expected ${expectedSha256}, got ${actualSha256}`);
    }

    updateInstallScheduled = true;
    console.info(`[desktop-update] verified update ${current.source_sha.slice(0, 8)} -> ${provenance.source_sha.slice(0, 8)}; restarting into installer`);
    launchSilentInstaller(installerPath);
    setTimeout(() => app.quit(), 750);
  } catch (error) {
    console.error("[desktop-update] update check failed", error instanceof Error ? error.message : String(error));
  } finally {
    updateCheckInFlight = false;
  }
}

export function startDesktopAutoUpdate(): void {
  if (!app.isPackaged || process.platform !== "win32") return;
  void checkForDesktopUpdate();
  const timer = setInterval(() => void checkForDesktopUpdate(), CHECK_INTERVAL_MS);
  timer.unref();
}

export const desktopAutoUpdateContract = Object.freeze({
  releaseBase: RELEASE_BASE,
  buildInfoRelative: BUILD_INFO_RELATIVE,
  installerName: basename(INSTALLER_URL),
  checkIntervalMs: CHECK_INTERVAL_MS
});
