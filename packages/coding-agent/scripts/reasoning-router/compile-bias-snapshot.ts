#!/usr/bin/env node
/**
 * Offline, deterministic compile step for the reasoning-router learning
 * ledger (Goal 009 Wave 1 Lane L). Manual only — this script is never invoked
 * automatically by any product code path, and its output is not read by
 * anything today (no resolver wiring exists yet). It reads a local JSONL
 * ledger, drops malformed/out-of-schema/wrong-router-version lines (counting
 * them), compiles a bounded bias snapshot via `compileBiasSnapshot`, and
 * writes it atomically with owner-only permissions.
 *
 * Usage:
 *   node packages/coding-agent/scripts/reasoning-router/compile-bias-snapshot.ts \
 *     [--ledger <path>] [--out <path>] [--router-version v1|v2|v3|v4]
 *
 * Defaults: ledger = <agentDir>/router-feedback/ledger.jsonl (owner-only;
 * see getDefaultRouterFeedbackLedgerPath), out = a sibling
 * router-feedback/weights/router-bias-snapshot.<router-version>.json,
 * router-version = v4 (the only version wired for learning today).
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getAgentDir } from "../../src/config.ts";
import { compileBiasSnapshot } from "../../src/core/reasoning-router-bias.ts";
import { getDefaultRouterFeedbackLedgerPath, type RouterFeedbackVersion } from "../../src/core/router-feedback-collector.ts";

const ROUTER_VERSIONS: readonly RouterFeedbackVersion[] = ["v1", "v2", "v3", "v4"];

interface CliArgs {
	readonly ledgerPath: string;
	readonly outPath: string;
	readonly routerVersion: RouterFeedbackVersion;
}

function parseArgs(argv: readonly string[]): CliArgs {
	let ledgerPath: string | undefined;
	let outPath: string | undefined;
	let routerVersion: RouterFeedbackVersion = "v4";

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--ledger") {
			ledgerPath = argv[++i];
		} else if (arg === "--out") {
			outPath = argv[++i];
		} else if (arg === "--router-version") {
			const value = argv[++i];
			if (value !== undefined && (ROUTER_VERSIONS as readonly string[]).includes(value)) {
				routerVersion = value as RouterFeedbackVersion;
			} else {
				throw new Error(`Unknown --router-version: ${String(value)}`);
			}
		}
	}

	const resolvedLedgerPath = ledgerPath ?? getDefaultRouterFeedbackLedgerPath();
	const resolvedOutPath =
		outPath ?? join(getAgentDir(), "router-feedback", "weights", `router-bias-snapshot.${routerVersion}.json`);
	return { ledgerPath: resolvedLedgerPath, outPath: resolvedOutPath, routerVersion };
}

interface LedgerReadResult {
	readonly entries: unknown[];
	readonly parseErrorCount: number;
}

function readLedgerEntries(ledgerPath: string): LedgerReadResult {
	if (!existsSync(ledgerPath)) {
		return { entries: [], parseErrorCount: 0 };
	}
	const raw = readFileSync(ledgerPath, "utf-8");
	const entries: unknown[] = [];
	let parseErrorCount = 0;
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		try {
			entries.push(JSON.parse(trimmed));
		} catch {
			parseErrorCount += 1;
		}
	}
	return { entries, parseErrorCount };
}

/** Atomic temp-file-then-rename write; never partially overwrites an existing snapshot. */
function writeSnapshotAtomically(outPath: string, snapshotJson: string): void {
	const dir = dirname(outPath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
	}
	const tempPath = `${outPath}.tmp-${process.pid}-${Date.now()}`;
	writeFileSync(tempPath, snapshotJson, { encoding: "utf-8", mode: 0o600 });
	chmodSync(tempPath, 0o600);
	renameSync(tempPath, outPath);
	chmodSync(outPath, 0o600);
}

function main(): void {
	const args = parseArgs(process.argv.slice(2));
	const { entries, parseErrorCount } = readLedgerEntries(args.ledgerPath);
	const result = compileBiasSnapshot(entries, { routerVersion: args.routerVersion });
	const snapshotJson = `${JSON.stringify(result, null, 2)}\n`;

	writeSnapshotAtomically(args.outPath, snapshotJson);

	process.stderr.write(
		`router-feedback compile: routerVersion=${args.routerVersion} ledger=${args.ledgerPath} ` +
			`considered=${result.consideredCount} dropped=${result.droppedCount} parseErrors=${parseErrorCount} ` +
			`cells=${result.biasCells.length} out=${args.outPath}\n`,
	);
}

main();
