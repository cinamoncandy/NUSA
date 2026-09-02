import { app, ipcMain } from "electron";
import { activateCloudCanonicalDesktopAuthority } from "./paper/desktopPaperAuthorityPolicy";
import { registerDesktopCloudPaperIpc } from "./cloud/desktopCloudPaperIpc";
import { createDesktopCloudSessionClient } from "./cloud/desktopCloudSessionRuntime";
import { startDesktopAutoUpdate } from "./update/desktopAutoUpdate";

// These handlers belong to the legacy local simulator. The explicit LOCAL_SIMULATION
// development entrypoint may still load main.ts directly, but the packaged Cloud-canonical
// entrypoint removes them before any renderer window can use them. This makes the migration
// structural rather than relying only on renderer/preload reachability or an in-handler guard.
const CLOUD_CANONICAL_DISABLED_LEGACY_IPC = Object.freeze([
  "paper:order",
  "paper:snapshot",
  "control:start",
  "control:quantity"
] as const);

// Authority is activated before the legacy Desktop runtime module is loaded. This ensures
// any legacy local PAPER IPC that remains in main.ts fails closed instead of becoming a
// second canonical writer during the migration window.
activateCloudCanonicalDesktopAuthority();

// Electron safeStorage is only valid after app readiness. Register this continuation before
// loading the mature runtime so the canonical Cloud PAPER IPC boundary is composed as soon
// as Electron becomes ready, without ever exposing credentials to preload/renderer code.
void app.whenReady().then(() => {
  registerDesktopCloudPaperIpc(ipcMain, createDesktopCloudSessionClient());
  startDesktopAutoUpdate();
}).catch((error) => {
  console.error("[desktop-cloud-paper] secure session registration failed", error instanceof Error ? error.message : "unknown error");
});

// Preserve the rest of the mature Desktop runtime without duplicating its composition. The
// legacy module registers its IPC handlers synchronously while being evaluated, so removal
// runs immediately after that evaluation and before its app.whenReady() window continuation.
// Cloud PAPER has dedicated cloud-paper:* handlers; automatic strategy start/quantity remain
// deliberately deferred until their serialized canonical-Cloud successor.
void import("./main").then(() => {
  for (const channel of CLOUD_CANONICAL_DISABLED_LEGACY_IPC) ipcMain.removeHandler(channel);
}).catch((error) => {
  console.error("[desktop-cloud-paper] legacy runtime bootstrap failed", error instanceof Error ? error.message : "unknown error");
  app.quit();
});
