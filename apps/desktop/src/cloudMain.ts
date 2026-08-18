import { app, ipcMain } from "electron";
import { activateCloudCanonicalDesktopAuthority } from "./desktopPaperAuthorityPolicy";
import { registerDesktopCloudPaperIpc } from "./desktopCloudPaperIpc";
import { createDesktopCloudSessionClient } from "./desktopCloudSessionRuntime";

// Authority is activated before the legacy Desktop runtime module is loaded. This ensures
// any legacy local PAPER IPC that remains in main.ts fails closed instead of becoming a
// second canonical writer during the migration window.
activateCloudCanonicalDesktopAuthority();

// Electron safeStorage is only valid after app readiness. Register this continuation before
// loading the mature runtime so the canonical Cloud PAPER IPC boundary is composed as soon
// as Electron becomes ready, without ever exposing credentials to preload/renderer code.
void app.whenReady().then(() => {
  registerDesktopCloudPaperIpc(ipcMain, createDesktopCloudSessionClient());
}).catch((error) => {
  console.error("[desktop-cloud-paper] secure session registration failed", error instanceof Error ? error.message : "unknown error");
});

// Preserve the rest of the mature Desktop runtime without duplicating its composition.
// The renderer/preload surface for PAPER is migrated separately to the cloud-paper:* IPCs.
void import("./main");
