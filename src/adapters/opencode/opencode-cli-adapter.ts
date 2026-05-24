/**
 * OpenCodeCliAdapter — wraps the `opencode` CLI as an AgentRuntime.
 */

import { createExternalCliAdapter } from "../../runtime/external-cli-adapter.js";
import type { ContextCapsule } from "../../runtime/context-capsule.js";

export interface OpencodeCliAdapterOptions {
  bin?: string;
  cwd?: string;
  env?: Record<string, string>;
}

export function createOpencodeCliAdapter(options: OpencodeCliAdapterOptions = {}) {
  const bin = options.bin ?? process.env.OPENCODE_BIN ?? "opencode";
  return createExternalCliAdapter({
    id: "opencode-cli",
    displayName: "OpenCode CLI",
    bin,
    cwd: options.cwd,
    env: options.env,
    priority: 70,
    capabilities: {
      read: true,
      write: true,
      shell: true,
      mcp: false,
      patch: true,
      review: true,
      merge: false,
      vision: false,
    },
    promptTransport: "tempfile",
    buildArgs(_capsule: ContextCapsule, prompt): string[] {
      const promptFile = prompt.promptFile;
      if (!promptFile) {
        return [
          "run",
          "--print",
          "Prompt file transport was unavailable; stop and report OMK prompt transport failure.",
        ];
      }
      return [
        "run",
        "--print",
        "--file",
        promptFile,
        "Read the attached prompt file exactly and execute the user request it contains.",
      ];
    },
  });
}
