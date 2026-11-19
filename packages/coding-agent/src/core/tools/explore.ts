import { type Static, Type } from "typebox";
import { exploreCodebase } from "../explorer/explorer.ts";

const exploreSchema = Type.Object({
	question: Type.String({ description: "What to find in the workspace, in words or identifiers" }),
	maxFilesReturned: Type.Optional(Type.Number({ description: "Maximum files to return (default: 6)" })),
	maxRangesTotal: Type.Optional(Type.Number({ description: "Maximum line ranges to return (default: 12)" })),
});

export type ExploreToolInput = Static<typeof exploreSchema>;

const DESCRIPTION =
	"Read-only multi-file exploration. Returns ranked file paths with line ranges, coverage, negative terms and budget truncation; never whole files and never writes. Prefer this over repeated grep/read when you expect 2+ searches or 4+ files, or when context pressure is high (>=70%). For one known file or symbol, read it directly instead.";

function render(result: Awaited<ReturnType<typeof exploreCodebase>>): string {
	const lines = [`question: ${result.question}`];
	for (const file of result.files) {
		for (const range of file.ranges) lines.push(`${file.path}:${range.start}-${range.end} (${range.reason})`);
	}
	if (result.files.length === 0) lines.push("no matching files");
	if (result.negative.length > 0) lines.push(`negative: ${result.negative.join(", ")}`);
	if (result.coverage.notVisited.length > 0) lines.push(`notVisited: ${result.coverage.notVisited.join("; ")}`);
	lines.push(`budget: ${result.budget.filesScanned} files read, truncated=${result.budget.truncated}`);
	return lines.join("\n");
}

export function createExploreToolDefinition(cwd: string) {
	return {
		name: "explore",
		label: "explore",
		description: DESCRIPTION,
		promptSnippet: "Read-only exploration returning paths and line ranges (2+ searches or 4+ files)",
		parameters: exploreSchema,
		async execute(
			_toolCallId: string,
			{ question, maxFilesReturned, maxRangesTotal }: ExploreToolInput,
			signal?: AbortSignal,
		) {
			if (signal?.aborted) throw new Error("Operation aborted");
			const result = await exploreCodebase({
				cwd,
				question,
				budget: {
					...(maxFilesReturned !== undefined ? { maxFilesReturned } : {}),
					...(maxRangesTotal !== undefined ? { maxRangesTotal } : {}),
				},
			});
			return { content: [{ type: "text" as const, text: render(result) }], details: result };
		},
	};
}
