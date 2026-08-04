import type { Engine } from "../../../packages/core/src/engineRegistry";
import { RuntimeCompositionRoot } from "../../../packages/core/src/runtimeCompositionRoot";
import { RuntimeCommandService } from "./runtimeCommandService";

export const PAPER_COMMAND_RUNTIME_SERVICE = "desktop.paper-command";

export function createPaperCommandEngine(commands: RuntimeCommandService): Engine {
  return {
    id: PAPER_COMMAND_RUNTIME_SERVICE,
    start: ({ services, signal }) => {
      if (signal.aborted) {
        commands.markUnavailable();
        throw signal.reason;
      }
      services.register(PAPER_COMMAND_RUNTIME_SERVICE, commands);
    },
    stop: () => commands.markUnavailable()
  };
}

export class PaperRuntimeIntegration {
  constructor(private readonly runtime: RuntimeCompositionRoot) {}

  commandService(): RuntimeCommandService {
    return this.runtime.resolve<RuntimeCommandService>(PAPER_COMMAND_RUNTIME_SERVICE);
  }

  isStarted(): boolean {
    return this.runtime.isStarted();
  }
}
