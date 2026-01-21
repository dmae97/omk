#!/usr/bin/env bun

import { parseArgs } from "node:util";
import { getDashboardStats, getTotalMessageCount, syncAllSessions } from "./aggregator";
import { closeDb } from "./db";
import { startServer } from "./server";

export { getDashboardStats, getTotalMessageCount, syncAllSessions } from "./aggregator";
export type {
	AggregatedStats,
	DashboardStats,
	FolderStats,
	MessageStats,
	ModelStats,
	TimeSeriesPoint,
} from "./types";

/**
 * Format a number with appropriate suffix (K, M, etc.)
 */
function formatNumber(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return n.toFixed(0);
}

/**
 * Format cost in dollars.
 */
function formatCost(n: number): string {
	if (n < 0.01) return `$${n.toFixed(4)}`;
	if (n < 1) return `$${n.toFixed(3)}`;
	return `$${n.toFixed(2)}`;
}

/**
 * Format duration in ms to human-readable.
 */
function formatDuration(ms: number | null): string {
	if (ms === null) return "-";
	if (ms < 1000) return `${ms.toFixed(0)}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Format percentage.
 */
function formatPercent(n: number): string {
	return `${(n * 100).toFixed(1)}%`;
}

/**
 * Print stats summary to console.
 */
async function printStats(): Promise<void> {
	const stats = await getDashboardStats();
	const { overall, byModel, byFolder } = stats;

	console.log("\n=== AI Usage Statistics ===\n");

	console.log("Overall:");
	console.log(`  Requests: ${formatNumber(overall.totalRequests)} (${formatNumber(overall.failedRequests)} errors)`);
	console.log(`  Error Rate: ${formatPercent(overall.errorRate)}`);
	console.log(`  Total Tokens: ${formatNumber(overall.totalInputTokens + overall.totalOutputTokens)}`);
	console.log(`  Cache Rate: ${formatPercent(overall.cacheRate)}`);
	console.log(`  Total Cost: ${formatCost(overall.totalCost)}`);
	console.log(`  Avg Duration: ${formatDuration(overall.avgDuration)}`);
	console.log(`  Avg TTFT: ${formatDuration(overall.avgTtft)}`);
	if (overall.avgTokensPerSecond !== null) {
		console.log(`  Avg Tokens/s: ${overall.avgTokensPerSecond.toFixed(1)}`);
	}

	if (byModel.length > 0) {
		console.log("\nBy Model:");
		for (const m of byModel.slice(0, 10)) {
			console.log(
				`  ${m.model}: ${formatNumber(m.totalRequests)} reqs, ${formatCost(m.totalCost)}, ${formatPercent(m.cacheRate)} cache`,
			);
		}
	}

	if (byFolder.length > 0) {
		console.log("\nBy Folder:");
		for (const f of byFolder.slice(0, 10)) {
			console.log(`  ${f.folder}: ${formatNumber(f.totalRequests)} reqs, ${formatCost(f.totalCost)}`);
		}
	}

	console.log("");
}

/**
 * Main CLI entry point.
 */
async function main(): Promise<void> {
	const { values } = parseArgs({
		options: {
			port: { type: "string", short: "p", default: "3847" },
			json: { type: "boolean", short: "j", default: false },
			sync: { type: "boolean", short: "s", default: false },
			help: { type: "boolean", short: "h", default: false },
		},
		allowPositionals: true,
	});

	if (values.help) {
		console.log(`
omp-stats - AI Usage Statistics Dashboard

Usage:
  omp-stats [options]

Options:
  -p, --port <port>  Port for the dashboard server (default: 3847)
  -j, --json         Output stats as JSON and exit
  -s, --sync         Sync session files and show summary
  -h, --help         Show this help message

Examples:
  omp-stats              # Start dashboard server
  omp-stats --json       # Print stats as JSON
  omp-stats --port 8080  # Start on custom port
  omp-stats --sync       # Sync and show summary
`);
		return;
	}

	try {
		// Sync first
		console.log("Syncing session files...");
		const { processed, files } = await syncAllSessions();
		const total = await getTotalMessageCount();
		console.log(`Synced ${processed} new entries from ${files} files (${total} total)\n`);

		if (values.json) {
			const stats = await getDashboardStats();
			console.log(JSON.stringify(stats, null, 2));
			return;
		}

		if (values.sync) {
			await printStats();
			return;
		}

		// Start server
		const port = parseInt(values.port || "3847", 10);
		const { port: actualPort } = startServer(port);
		console.log(`Dashboard available at: http://localhost:${actualPort}`);
		console.log("Press Ctrl+C to stop\n");

		// Keep process running
		process.on("SIGINT", () => {
			console.log("\nShutting down...");
			closeDb();
			process.exit(0);
		});
	} catch (error) {
		console.error("Error:", error);
		closeDb();
		process.exit(1);
	}
}

// Run if executed directly
if (import.meta.main) {
	main();
}
