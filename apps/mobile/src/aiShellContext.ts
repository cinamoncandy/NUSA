import { createContext, useContext } from "react";

/** True inside AiShell: cards draw as frosted glass there and keep the theme card elsewhere (the glass fill is tuned for the navy ground). */
export const AiShellContext = createContext(false);
export const useInAiShell = (): boolean => useContext(AiShellContext);
