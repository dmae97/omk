import type { Api, Model } from "@oh-my-pi/pi-ai";
import { parseFileDiffs } from "$c/commit/git/diff";
import { runMapPhase } from "$c/commit/map-reduce/map-phase";
import { runReducePhase } from "$c/commit/map-reduce/reduce-phase";
import { estimateTokens } from "$c/commit/map-reduce/utils";
import type { ConventionalAnalysis } from "$c/commit/types";
import { isExcludedFile } from "$c/commit/utils/exclusions";

const MIN_FILES_FOR_MAP_REDUCE = 4;
const MAX_FILE_TOKENS = 50_000;

export interface MapReduceInput {
	model: Model<Api>;
	apiKey: string;
	smolModel: Model<Api>;
	smolApiKey: string;
	diff: string;
	stat: string;
	scopeCandidates: string;
	typesDescription?: string;
}

export function shouldUseMapReduce(diff: string): boolean {
	if (process.env.OMP_COMMIT_MAP_REDUCE?.toLowerCase() === "false") return false;
	const files = parseFileDiffs(diff).filter((file) => !isExcludedFile(file.filename));
	const fileCount = files.length;
	if (fileCount >= MIN_FILES_FOR_MAP_REDUCE) return true;
	return files.some((file) => estimateTokens(file.content) > MAX_FILE_TOKENS);
}

/**
 * Run map-reduce analysis for large diffs using smol + primary models.
 */
export async function runMapReduceAnalysis(input: MapReduceInput): Promise<ConventionalAnalysis> {
	const fileDiffs = parseFileDiffs(input.diff).filter((file) => !isExcludedFile(file.filename));
	const observations = await runMapPhase({
		model: input.smolModel,
		apiKey: input.smolApiKey,
		files: fileDiffs,
	});
	return runReducePhase({
		model: input.model,
		apiKey: input.apiKey,
		observations,
		stat: input.stat,
		scopeCandidates: input.scopeCandidates,
		typesDescription: input.typesDescription,
	});
}
