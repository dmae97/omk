/**
 * CLI argument parsing extensions for jailbreak command.
 *
 * Adds `--mode` and `--target` flags for the `omk jailbreak` subcommand.
 * These are parsed as unknown flags and then validated by the jailbreak command handler.
 */

import type { Args } from "./args.ts";

export type JailbreakMode = "parseltongue" | "godmode" | "ultraplinian" | "auto";

export interface JailbreakArgs {
	mode: JailbreakMode;
	target: string;
	help?: boolean;
}

const VALID_JAILBREAK_MODES: JailbreakMode[] = ["parseltongue", "godmode", "ultraplinian", "auto"];

const VALID_TARGETS = [
	"claude",
	"gpt-4o",
	"gpt-4o-mini",
	"sonnet",
	"haiku",
	"gemini",
	"grok",
	"deepseek",
	"generic",
] as const;

export function isValidJailbreakMode(mode: string): mode is JailbreakMode {
	return VALID_JAILBREAK_MODES.includes(mode as JailbreakMode);
}

export function isValidTarget(target: string): boolean {
	return VALID_TARGETS.includes(target as (typeof VALID_TARGETS)[number]);
}

export function parseJailbreakArgs(args: string[]): JailbreakArgs {
	let mode: JailbreakMode = "auto";
	let target = "generic";
	let help = false;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		if (arg === "--mode" && i + 1 < args.length) {
			const value = args[++i];
			if (isValidJailbreakMode(value)) {
				mode = value;
			} else {
				throw new Error(`Invalid jailbreak mode "${value}". Valid modes: ${VALID_JAILBREAK_MODES.join(", ")}`);
			}
		} else if (arg === "--target" && i + 1 < args.length) {
			const value = args[++i];
			if (isValidTarget(value)) {
				target = value;
			} else {
				throw new Error(`Invalid target "${value}". Valid targets: ${VALID_TARGETS.join(", ")}`);
			}
		} else if (arg === "--help" || arg === "-h") {
			help = true;
		}
	}

	return { mode, target, help };
}

export function printJailbreakHelp(): void {
	console.log(`omk jailbreak — Local jailbreak payload generator (v6)

Usage:
  omk jailbreak [options]

Options:
  --mode <mode>      Jailbreak mode: parseltongue, godmode, ultraplinian, auto (default: auto)
  --target <model>   Target model: claude, gpt-4o, gpt-4o-mini, sonnet, haiku, gemini, grok, deepseek, generic (default: generic)
  --help, -h         Show this help

Description:
  Generates jailbreak payloads locally without any API calls.
  Outputs the payload to stdout for manual use or piping.

Examples:
  omk jailbreak --mode godmode --target claude
  omk jailbreak --mode auto --target gpt-4o
  omk jailbreak --target grok
`);
}

/**
 * Extract jailbreak-specific flags from the parsed Args unknownFlags map.
 * This bridges the main args parser with the jailbreak subcommand parser.
 */
export function extractJailbreakFlags(parsed: Args): { mode?: string; target?: string } {
	return {
		mode: parsed.unknownFlags.get("jailbreak-mode") as string | undefined,
		target: parsed.unknownFlags.get("jailbreak-target") as string | undefined,
	};
}
