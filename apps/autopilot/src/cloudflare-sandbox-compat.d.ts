declare module "@cloudflare/sandbox" {
  export class Sandbox {}

  export interface SandboxProcessOutput {
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
  }

  export interface SandboxProcess {
    output(options?: { readonly encoding?: "utf8" }): Promise<SandboxProcessOutput>;
  }

  export interface SandboxFileReadResult {
    readonly content: string | Uint8Array;
  }

  export interface SandboxHandle {
    exec(command: readonly string[], options?: { readonly cwd?: string }): Promise<SandboxProcess>;
    readFile(path: string, options?: { readonly encoding?: "utf-8" }): Promise<SandboxFileReadResult>;
    writeFile(path: string, content: string): Promise<void>;
  }

  export function getSandbox(namespace: unknown, id: string): SandboxHandle;
}
