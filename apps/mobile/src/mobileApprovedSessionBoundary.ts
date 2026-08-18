import { createMobileSecureStorage } from "./androidSecureStorage";
import { MobileApprovedSession } from "./mobileApprovedSession";

const sharedSession = new MobileApprovedSession(createMobileSecureStorage());

export function mobileApprovedSession(): MobileApprovedSession { return sharedSession; }
export function clearMobileApprovedSessionMemory(): void { sharedSession.clearMemory(); }
