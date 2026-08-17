import { ipcMain } from "electron";
import { activateCloudCanonicalDesktopAuthority } from "./desktopPaperAuthorityPolicy";
import { registerDesktopCloudPaperIpc } from "./desktopCloudPaperIpc";

// Authority is activated before the legacy Desktop runtime module is loaded. This ensures
// any legacy local PAPER IPC that remains in main.ts fails closed instead of becoming a
// second canonical writer during the migration window.
activateCloudCanonicalDesktopAuthority();
registerDesktopCloudPaperIpc(ipcMain);

// Preserve the rest of the mature Desktop runtime without duplicating its composition.
// The renderer/preload surface for PAPER is migrated separately to the cloud-paper:* IPCs.
void import("./main");
