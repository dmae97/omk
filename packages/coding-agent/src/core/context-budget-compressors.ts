import { spawn } from "node:child_process";
import {
	createFallbackTokenCounter,
	type TokenCounterAdapter,
	type TokenCountResult,
} from "./context-budget-token-counter.ts";

export type ContextBudgetCompressorMode = "off" | "auto" | "headroom" | "llmlingua";
export type ContextBudgetCompressionMethod = "compressed" | "none";

export interface ContextCompressionRequest {
	readonly text: string;
	readonly targetTokens: number;
	readonly modelId: string;
	readonly timeoutMs?: number;
	readonly maxOutputChars?: number;
}

export interface ContextCompressionResult {
	readonly text: string;
	readonly method: ContextBudgetCompressionMethod;
	readonly adapterId: string;
	readonly input: TokenCountResult;
	readonly output: TokenCountResult;
	readonly notes: readonly string[];
}

export interface ContextCompressorAdapter {
	readonly id: string;
	readonly priority: number;
	isAvailable(): Promise<boolean>;
	compress(request: ContextCompressionRequest): Promise<ContextCompressionResult>;
}

export interface CommandRunRequest {
	readonly command: string;
	readonly args: readonly string[];
	readonly input: string;
	readonly timeoutMs: number;
}

export interface CommandRunResult {
	readonly exitCode: number | null;
	readonly stdout: string;
	readonly stderr: string;
	readonly timedOut: boolean;
}

export interface CommandRunner {
	run(request: CommandRunRequest): Promise<CommandRunResult>;
}

export interface CliCompressorOptions {
	readonly command?: string;
	readonly runner?: CommandRunner;
	readonly tokenCounter?: TokenCounterAdapter;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_OUTPUT_CHARS = 400_000;

export function createNodeCommandRunner(): CommandRunner {
	return {
		run(request) {
			return new Promise((resolve) => {
				const child = spawn(request.command, [...request.args], { stdio: ["pipe", "pipe", "pipe"] });
				let stdout = "";
				let stderr = "";
				let settled = false;
				const timeout = setTimeout(() => {
					settled = true;
					child.kill("SIGTERM");
					resolve({ exitCode: null, stdout, stderr, timedOut: true });
				}, request.timeoutMs);
				child.stdout.setEncoding("utf8");
				child.stderr.setEncoding("utf8");
				child.stdout.on("data", (chunk: string) => {
					stdout += chunk;
				});
				child.stderr.on("data", (chunk: string) => {
					stderr += chunk;
				});
				child.on("error", (error) => {
					if (settled) return;
					settled = true;
					clearTimeout(timeout);
					resolve({ exitCode: null, stdout, stderr: error.message, timedOut: false });
				});
				child.on("close", (exitCode) => {
					if (settled) return;
					settled = true;
					clearTimeout(timeout);
					resolve({ exitCode, stdout, stderr, timedOut: false });
				});
				child.stdin.end(request.input, "utf8");
			});
		},
	};
}

export function createHeadroomCliCompressor(options: CliCompressorOptions = {}): ContextCompressorAdapter {
	return createCliCompressor({
		id: "headroom-cli",
		priority: 80,
		command: options.command ?? "headroom",
		args: (request) => ["compress", "--target-tokens", String(request.targetTokens), "--model", request.modelId],
		runner: options.runner,
		tokenCounter: options.tokenCounter,
	});
}

export function createLlmlinguaCliCompressor(options: CliCompressorOptions = {}): ContextCompressorAdapter {
	return createCliCompressor({
		id: "llmlingua-cli",
		priority: 60,
		command: options.command ?? "llmlingua",
		args: (request) => ["compress", "--target-tokens", String(request.targetTokens), "--model", request.modelId],
		runner: options.runner,
		tokenCounter: options.tokenCounter,
	});
}

export function createContextCompressorForMode(
	mode: ContextBudgetCompressorMode,
	options: CliCompressorOptions = {},
): ContextCompressorAdapter | undefined {
	if (mode === "off") {
		return undefined;
	}
	if (mode === "headroom") {
		return createHeadroomCliCompressor(options);
	}
	if (mode === "llmlingua") {
		return createLlmlinguaCliCompressor(options);
	}
	return createCompressorRegistry([createHeadroomCliCompressor(options), createLlmlinguaCliCompressor(options)]);
}

export function createCompressorRegistry(adapters: readonly ContextCompressorAdapter[]): ContextCompressorAdapter {
	const ordered = [...adapters].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
	return {
		id: "context-compressor-registry",
		priority: 100,
		isAvailable: async () => true,
		async compress(request) {
			const notes: string[] = [];
			for (const adapter of ordered) {
				try {
					if (!(await adapter.isAvailable())) {
						notes.push(`${adapter.id}:unavailable`);
						continue;
					}
					const result = await adapter.compress(request);
					return { ...result, notes: [...notes, ...result.notes] };
				} catch (error) {
					const message = error instanceof Error ? error.message : "unknown compressor failure";
					notes.push(`${adapter.id}:failed:${message}`);
				}
			}
			return createNoCompressionResult(request, createFallbackTokenCounter(), notes);
		},
	};
}

interface CliCompressorInternalOptions {
	readonly id: string;
	readonly priority: number;
	readonly command: string;
	readonly args: (request: ContextCompressionRequest) => readonly string[];
	readonly runner?: CommandRunner;
	readonly tokenCounter?: TokenCounterAdapter;
}

function createCliCompressor(options: CliCompressorInternalOptions): ContextCompressorAdapter {
	const runner = options.runner ?? createNodeCommandRunner();
	const tokenCounter = options.tokenCounter ?? createFallbackTokenCounter();
	return {
		id: options.id,
		priority: options.priority,
		async isAvailable() {
			const result = await runner.run({
				command: options.command,
				args: ["--version"],
				input: "",
				timeoutMs: 3_000,
			});
			return result.exitCode === 0 && !result.timedOut;
		},
		async compress(request) {
			const input = tokenCounter.countText(request.text, request.modelId);
			if (input.tokens <= request.targetTokens) {
				return createNoCompressionResult(request, tokenCounter, [`${options.id}:already-within-budget`]);
			}
			const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
			const result = await runner.run({
				command: options.command,
				args: options.args(request),
				input: request.text,
				timeoutMs,
			});
			if (result.timedOut) {
				return createNoCompressionResult(request, tokenCounter, [`${options.id}:timeout`]);
			}
			if (result.exitCode !== 0) {
				return createNoCompressionResult(request, tokenCounter, [
					`${options.id}:exit:${result.exitCode ?? "null"}`,
				]);
			}
			const maxOutputChars = request.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
			const outputText = result.stdout.slice(0, maxOutputChars);
			if (outputText.trim().length === 0) {
				return createNoCompressionResult(request, tokenCounter, [`${options.id}:empty-output`]);
			}
			const output = tokenCounter.countText(outputText, request.modelId);
			return {
				text: outputText,
				method: "compressed",
				adapterId: options.id,
				input,
				output,
				notes: outputText.length < result.stdout.length ? [`${options.id}:output-truncated`] : [`${options.id}:ok`],
			};
		},
	};
}

function createNoCompressionResult(
	request: ContextCompressionRequest,
	tokenCounter: TokenCounterAdapter,
	notes: readonly string[],
): ContextCompressionResult {
	const input = tokenCounter.countText(request.text, request.modelId);
	return {
		text: request.text,
		method: "none",
		adapterId: "none",
		input,
		output: input,
		notes,
	};
}
