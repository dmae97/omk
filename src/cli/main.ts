import { Command } from "commander";
import { CliError } from "../util/cli-contract.js";
import { formatOmkVersionFooter, getOmkVersionSync } from "../util/version.js";
import { configureRootProgram, runRootOmkControlPlane } from "./root.js";
import { registerCliCommands } from "./command-registry.js";
import { buildCommandEnvelope } from "./input/command-envelope.js";
import { createCliRuntime } from "./runtime/cli-runtime.js";
import { routeOutput } from "./output/output-router.js";
import { createCliWriter } from "./runtime/cli-writer.js";
import type { OutputProfile } from "./runtime/types.js";

export function createOmkProgram(): Command {
  const omkVersion = getOmkVersionSync();
  const program = new Command();

  configureRootProgram(program, omkVersion, formatOmkVersionFooter(omkVersion));
  registerCliCommands(program);

  return program;
}

export async function runCli(argv: readonly string[] = process.argv): Promise<void> {
  const program = createOmkProgram();
  const args = argv.slice(2);
  try {
    // When no subcommand is given, bypass Commander's default help-and-exit
    // behavior and run the root HUD flow directly.
    if (args.length === 0) {
      const globalOpts = program.opts();
      if (globalOpts.runId) {
        process.env.OMK_RUN_ID = globalOpts.runId;
      }
      await runRootOmkControlPlane(program);
      return;
    }

    if (args.includes("--help") || args.includes("-h")) {
      await program.parseAsync([...argv]);
      return;
    }

    // Build CommandEnvelope early so theme/output resolve before any output.
    const { envelope, validation } = await buildCommandEnvelope({ argv });

    // Route run/task/plan through the new envelope runtime.
    if (["run", "task", "plan"].includes(envelope.kind)) {
      if (!validation.valid) {
        const writer = createCliWriter(envelope.output);
        for (const err of validation.errors) {
          writer.error(err.message);
        }
        process.exitCode = 2;
        return;
      }

      const runtime = createCliRuntime();
      const result = await runtime.execute(envelope);
      const rendered = routeOutput(result, envelope.output);

      const writer = createCliWriter(envelope.output);
      if (rendered.content) {
        writer.rawStdout(rendered.content + "\n");
      }

      process.exitCode = result.exitCode;
      return;
    }

    // Fallback to existing Commander for all other commands.
    await program.parseAsync([...argv]);
  } catch (err) {
    handleCliError(err);
  }
}

const defaultErrorProfile: OutputProfile = {
  format: "json",
  pretty: false,
  includeMessages: true,
  includeTrace: false,
  stream: false,
  destination: "stdout",
};

export function handleCliError(err: unknown, profile?: OutputProfile): void {
  const writer = createCliWriter(profile ?? defaultErrorProfile);
  if (err instanceof Error && err.name === "ExitPromptError") {
    process.exit(0);
  }
  if (err instanceof CliError) {
    if (process.exitCode === undefined) {
      process.exitCode = err.exitCode;
    }
    return;
  }
  writer.error(String(err));
  process.exit(1);
}
