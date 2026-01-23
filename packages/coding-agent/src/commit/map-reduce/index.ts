import type { Api, Model } from "@oh-my-pi/pi-ai";
import { parseFileDiffs } from "@oh-my-pi/pi-coding-agent/commit/git/diff";
import { runMapPhase } from "@oh-my-pi/pi-coding-agent/commit/map-reduce/map-phase";
import { runReducePhase } from "@oh-my-pi/pi-coding-agent/commit/map-reduce/reduce-phase";
import { estimateTokens } from "@oh-my-pi/pi-coding-agent/commit/map-reduce/utils";
import type { ConventionalAnalysis } from "@oh-my-pi/pi-coding-agent/commit/types";
import { isExcludedFile } from "@oh-my-pi/pi-coding-agent/commit/utils/exclusions";

const MIN_FILES_FOR_MAP_REDUCE = 4;
const MAX_FILE_TOKENS = 50_000;

export interface MapReduceSettings {
	enabled?: boolean;
	minFiles?: number;
	maxFileTokens?: number;
	maxConcurrency?: number;
	timeoutMs?: number;
}

export interface MapReduceInput {
	model: Model<Api>;
	apiKey: string;
	smolModel: Model<Api>;
	smolApiKey: string;
	diff: string;
	stat: string;
	scopeCandidates: string;
	typesDescription?: string;
	settings?: MapReduceSettings;
}

export function shouldUseMapReduce(diff: string, settings?: MapReduceSettings): boolean {
	if (process.env.OMP_COMMIT_MAP_REDUCE?.toLowerCase() === "false") return false;
	if (settings?.enabled === false) return false;
	const minFiles = settings?.minFiles ?? MIN_FILES_FOR_MAP_REDUCE;
	const maxFileTokens = settings?.maxFileTokens ?? MAX_FILE_TOKENS;
	const files = parseFileDiffs(diff).filter((file) => !isExcludedFile(file.filename));
	const fileCount = files.length;
	if (fileCount >= minFiles) return true;
	return files.some((file) => estimateTokens(file.content) > maxFileTokens);
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
		config: input.settings,
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
