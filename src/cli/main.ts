import { Command } from "commander";
import { CliError } from "../util/cli-contract.js";
import { formatOmkVersionFooter, getOmkVersionSync } from "../util/version.js";
import { configureRootProgram, runRootOmkControlPlane } from "./root.js";
import { registerCliCommands } from "./command-registry.js";

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
    await program.parseAsync([...argv]);
  } catch (err) {
    handleCliError(err);
  }
}

export function handleCliError(err: unknown): void {
  if (err instanceof Error && err.name === "ExitPromptError") {
    process.exit(0);
  }
  if (err instanceof CliError) {
    if (process.exitCode === undefined) {
      process.exitCode = err.exitCode;
    }
    return;
  }
  console.error("Unexpected error:", err);
  process.exit(1);
}
