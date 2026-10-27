/**
 * Compiler-backed diagnostics tool (LSP-class value via project-native checkers).
 *
 * Routes per language to the checker the project already uses and normalizes
 * output to `SEVERITY path:line:col message`. Fail-soft by construction: a
 * missing checker, missing project marker, or checker crash reports `skipped`
 * for that language instead of throwing. Results are TTL-cached (5 s) since
 * project-wide checks are expensive.
 *
 * | language   | checker (first found)                    | scope             |
 * |------------|------------------------------------------|-------------------|
 * | typescript | `tsc --noEmit -p <nearest tsconfig>`     | project           |
 * | python     | `pyright --outputjson` / `ruff check`    | file or project   |
 * | go         | `go vet ./...`                           | module            |
 * | rust       | `cargo check --message-format short`     | workspace         |
 */
import type { AgentTool } from "omk-agent-core";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import {
	CHECKERS,
	type DiagnosticLine,
	type Language,
	type LanguageResult,
	nearestMarker,
} from "./diagnostics-checkers.ts";
import { cacheStamp } from "./diagnostics-paths.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const diagnosticsSchema = Type.Object({
	path: Type.Optional(Type.String({ description: "Restrict diagnostics to this file (relative to cwd)" })),
	language: Type.Optional(
		Type.Union(
			[
				Type.Literal("auto"),
				Type.Literal("typescript"),
				Type.Literal("python"),
				Type.Literal("go"),
				Type.Literal("rust"),
			],
			{
				description: "Language to check; auto detects from path extension and project markers",
			},
		),
	),
	timeout: Type.Optional(Type.Number({ description: "Per-language timeout in seconds (default 90)" })),
});

export type { DiagnosticLine } from "./diagnostics-checkers.ts";

export type DiagnosticsToolInput = Static<typeof diagnosticsSchema>;

export interface DiagnosticsToolDetails {
	readonly diagnostics: readonly DiagnosticLine[];
	readonly skipped: readonly { language: string; reason: string }[];
	readonly counts: Record<string, number>;
}

const CACHE_TTL_MS = 5_000;
const MAX_DIAGNOSTICS = 50;
const DEFAULT_TIMEOUT_MS = 90_000;

const cache = new Map<string, { at: number; result: LanguageResult }>();

function detectLanguages(cwd: string, path: string | undefined): Language[] {
	if (path) {
		if (/\.tsx?$/.test(path)) return ["typescript"];
		if (/\.py$/.test(path)) return ["python"];
		if (/\.go$/.test(path)) return ["go"];
		if (/\.rs$/.test(path)) return ["rust"];
	}
	const detected: Language[] = [];
	if (nearestMarker(cwd, ["tsconfig.json", "tsconfig.build.json"])) detected.push("typescript");
	if (nearestMarker(cwd, ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt"])) detected.push("python");
	if (nearestMarker(cwd, ["go.mod"])) detected.push("go");
	if (nearestMarker(cwd, ["Cargo.toml"])) detected.push("rust");
	return detected.length > 0 ? detected : ["typescript", "python", "go", "rust"];
}

async function checkLanguage(
	language: Language,
	cwd: string,
	path: string | undefined,
	timeoutMs: number,
): Promise<LanguageResult> {
	const key = `${language}\0${cwd}\0${path ?? ""}\0${cacheStamp(cwd, path)}`;
	const cached = cache.get(key);
	if (cached && performance.now() - cached.at < CACHE_TTL_MS) return cached.result;
	const result = await CHECKERS[language](cwd, path, timeoutMs);
	// size >= 16 guarantees a first key exists.
	if (cache.size >= 16) cache.delete(cache.keys().next().value as string);
	cache.set(key, { at: performance.now(), result });
	return result;
}

export function createDiagnosticsToolDefinition(
	cwd: string,
): ToolDefinition<typeof diagnosticsSchema, DiagnosticsToolDetails> {
	return {
		name: "diagnostics",
		label: "diagnostics",
		description:
			"Run the project's own type/lint checkers (tsc, pyright/ruff, go vet, cargo check) and return normalized diagnostics. Missing checkers or missing project markers are reported as skipped, never as tool errors.",
		promptSnippet: "Get compiler/lint diagnostics for the workspace or a file",
		parameters: diagnosticsSchema,
		async execute(_toolCallId, { path, language, timeout }: DiagnosticsToolInput) {
			const timeoutMs = timeout !== undefined && timeout > 0 ? timeout * 1000 : DEFAULT_TIMEOUT_MS;
			const languages = language && language !== "auto" ? [language] : detectLanguages(cwd, path);
			const settled = await Promise.all(languages.map((lang) => checkLanguage(lang, cwd, path, timeoutMs)));
			const diagnostics: DiagnosticLine[] = [];
			const skipped: { language: string; reason: string }[] = [];
			for (let index = 0; index < languages.length; index++) {
				const result = settled[index];
				if (result.skippedReason) skipped.push({ language: languages[index], reason: result.skippedReason });
				diagnostics.push(...result.lines);
			}
			const capped = diagnostics.slice(0, MAX_DIAGNOSTICS);
			const counts: Record<string, number> = {};
			for (const d of diagnostics) counts[d.language] = (counts[d.language] ?? 0) + 1;
			const text =
				capped.length === 0 && skipped.length === 0
					? "No diagnostics."
					: [
							...capped.map(
								(d) =>
									`${d.severity.toUpperCase()} ${d.path}:${d.line}:${d.column} ${d.message} (${d.language})`,
							),
							...(diagnostics.length > capped.length ? [`... ${diagnostics.length - capped.length} more`] : []),
							...skipped.map((s) => `${s.language}: skipped (${s.reason})`),
						].join("\n");
			return { content: [{ type: "text", text }], details: { diagnostics: capped, skipped, counts } };
		},
	};
}

export function createDiagnosticsTool(cwd: string): AgentTool<typeof diagnosticsSchema> {
	return wrapToolDefinition(createDiagnosticsToolDefinition(cwd));
}
