import { createHash } from "node:crypto";

/** Every input a tool-schema fit depends on, so equal keys can reuse one fit. */
export interface AdmissionKeyInput {
	/** Kept apart from `modelId`: a joined `provider/id` is ambiguous when either contains `/`. */
	readonly provider: string;
	readonly modelId: string;
	readonly contextWindow: number;
	readonly ceiling: number;
	readonly settings: unknown;
	readonly systemPrompt: string;
	readonly counterId: string;
	/** Advances whenever a counter is admitted, because two counters may report the same id. */
	readonly counterEpoch: number;
	/** Serialized provider tool schemas, in request order. */
	readonly schemas: string;
	/** `[tool name, group]` pairs snapshotted for this fit; `null` marks an ungrouped tool. */
	readonly toolGroups: readonly (readonly [string, string | null])[];
}

/**
 * SHA-256 over the full prompt and schema content rather than their lengths or tool names.
 * Only the 64-character digest is retained. It identifies content; it authorizes nothing and
 * must not be logged next to the raw prompt or schemas.
 */
export function admissionKey(input: AdmissionKeyInput): string {
	return createHash("sha256")
		.update(
			JSON.stringify([
				"omk-admission-fit-3",
				input.provider,
				input.modelId,
				input.contextWindow,
				input.ceiling,
				input.settings,
				input.systemPrompt,
				input.counterId,
				input.counterEpoch,
				input.schemas,
				input.toolGroups,
			]),
		)
		.digest("hex");
}
