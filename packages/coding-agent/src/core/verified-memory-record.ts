import { randomUUID } from "node:crypto";
import canonicalize from "canonicalize";
import { type Observation, PROTOCOL_VERSION } from "omk-protocol";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import { MAX_MEMORY_TTL_MS, MEMORY_POLICY, readMemorySource, sha256Memory } from "./verified-memory-source.ts";

const digest = Type.String({ pattern: "^[a-f0-9]{64}$" });
const id = Type.String({ pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$" });
const index = Type.Integer({ minimum: 1, maximum: 262144 });
const schema = Type.Object(
	{
		version: Type.Literal(1),
		policy: Type.Literal(MEMORY_POLICY),
		id,
		workspaceId: digest,
		cognitiveType: Type.Literal("semantic"),
		path: Type.String({ minLength: 1, maxLength: 512 }),
		startLine: index,
		endLine: index,
		quote: Type.String({ minLength: 1, maxLength: 2048 }),
		contentHash: digest,
		createdAt: Type.Integer({ minimum: 0, maximum: 8e15 }),
		expiresAt: Type.Integer({ minimum: 0, maximum: 8e15 }),
		redactionPolicy: Type.Literal("forced-redaction-and-pattern-v1"),
		observation: Type.Object(
			{
				schemaVersion: Type.Literal(PROTOCOL_VERSION),
				observationId: id,
				taskId: digest,
				attemptId: id,
				observedAt: Type.String({ maxLength: 32 }),
				kind: Type.Literal("memory.source_quote"),
				source: Type.Object(
					{ kind: Type.Literal("local-file"), id: Type.String({ maxLength: 512 }) },
					{ additionalProperties: false },
				),
				facts: Type.Object(
					{ contentHash: digest, quoteHash: digest, startLine: index, endLine: index },
					{ additionalProperties: false },
				),
				evidenceRefs: Type.Array(Type.String({ maxLength: 128 }), { minItems: 1, maxItems: 1 }),
			},
			{ additionalProperties: false },
		),
		digest,
	},
	{ additionalProperties: false },
);

export type VerifiedMemoryRecord = Static<typeof schema>;
export type MemoryAdmission =
	| { readonly verdict: "accept"; readonly recordId: string }
	| { readonly verdict: "abstain" | "escalate"; readonly reason: string };

export function memoryObservation(record: Omit<VerifiedMemoryRecord, "observation" | "digest">): Observation {
	return {
		schemaVersion: PROTOCOL_VERSION,
		observationId: record.id,
		taskId: record.workspaceId,
		attemptId: record.id,
		observedAt: new Date(record.createdAt).toISOString(),
		kind: "memory.source_quote",
		source: { kind: "local-file", id: record.path },
		facts: {
			contentHash: record.contentHash,
			quoteHash: sha256Memory(record.quote),
			startLine: record.startLine,
			endLine: record.endLine,
		},
		evidenceRefs: [`sha256:${record.contentHash}#L${record.startLine}-L${record.endLine}`],
	};
}

export function parseMemoryRecord(raw: unknown): VerifiedMemoryRecord {
	if (!Check(schema, raw)) throw new Error("invalid memory record");
	const { digest: expected, ...body } = raw;
	if (
		raw.expiresAt <= raw.createdAt ||
		raw.expiresAt - raw.createdAt > MAX_MEMORY_TTL_MS ||
		raw.endLine - raw.startLine >= 16 ||
		canonicalize(raw.observation) !== canonicalize(memoryObservation(raw)) ||
		expected !== sha256Memory(canonicalize(body) ?? "")
	)
		throw new Error("invalid memory binding");
	return raw;
}

export function prepareMemoryRecord(root: string, workspaceId: string, input: unknown): VerifiedMemoryRecord {
	if (
		typeof input !== "object" ||
		input === null ||
		Array.isArray(input) ||
		Object.getPrototypeOf(input) !== Object.prototype ||
		Reflect.ownKeys(input).some(
			(key) =>
				typeof key !== "string" ||
				!["path", "startLine", "endLine", "ttlMs"].includes(key) ||
				!Object.hasOwn(Object.getOwnPropertyDescriptor(input, key) ?? {}, "value"),
		)
	)
		throw new Error("invalid memory input");
	const candidate = input as Record<string, unknown>;
	const { path, startLine, endLine } = candidate;
	const ttlMs = candidate.ttlMs ?? 7 * 24 * 60 * 60 * 1000;
	if (
		typeof path !== "string" ||
		typeof startLine !== "number" ||
		typeof endLine !== "number" ||
		typeof ttlMs !== "number" ||
		!Number.isSafeInteger(ttlMs) ||
		ttlMs <= 0 ||
		ttlMs > MAX_MEMORY_TTL_MS
	)
		throw new Error("invalid memory input");
	const source = readMemorySource(root, path, startLine, endLine);
	const createdAt = Date.now();
	const record = {
		version: 1 as const,
		policy: MEMORY_POLICY as typeof MEMORY_POLICY,
		id: randomUUID(),
		workspaceId,
		cognitiveType: "semantic" as const,
		path,
		startLine,
		endLine,
		...source,
		createdAt,
		expiresAt: createdAt + ttlMs,
		redactionPolicy: "forced-redaction-and-pattern-v1" as const,
	};
	const body = { ...record, observation: memoryObservation(record) };
	return parseMemoryRecord({ ...body, digest: sha256Memory(canonicalize(body) ?? "") });
}
