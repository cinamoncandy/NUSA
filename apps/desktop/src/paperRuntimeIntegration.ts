import type { Engine } from "../../../packages/core/src/engineRegistry";
import { NusaRuntime } from "../../../packages/core/src/runtime";
import { RuntimeCommandService } from "./runtimeCommandService";

export const PAPER_COMMAND_RUNTIME_SERVICE = "desktop.paper-command";

export class PaperRuntimeIntegration {
  private readonly runtime = new NusaRuntime();

  constructor(private readonly commands: RuntimeCommandService) {
    const engine: Engine = {
      id: PAPER_COMMAND_RUNTIME_SERVICE,
      start: ({ services, signal }) => {
        if (signal.aborted) {
          this.commands.markUnavailable();
          throw signal.reason;
        }
        services.register(PAPER_COMMAND_RUNTIME_SERVICE, this.commands);
      },
      stop: () => this.commands.markUnavailable()
    };
    this.runtime.engines.register(engine);
  }

  async start(): Promise<void> {
    try {
      await this.runtime.start();
    } catch (error) {
      this.commands.markUnavailable();
      throw error;
    }
  }

  async stop(): Promise<void> {
    try {
      await this.runtime.stop();
    } finally {
      this.commands.markUnavailable();
    }
  }

  commandService(): RuntimeCommandService {
    return this.runtime.services.resolve<RuntimeCommandService>(PAPER_COMMAND_RUNTIME_SERVICE);
  }

  isStarted(): boolean {
    return this.runtime.isStarted();
  }
}
