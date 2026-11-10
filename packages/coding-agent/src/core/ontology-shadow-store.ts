import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { atomicRewriteFileSync } from "./atomic-session-file.ts";
import { tokenizeForRelevance } from "./context-budget-relevance.ts";
import { sha256Canonical } from "./context-budget-v2-cache-hash.ts";
import {
	checkOntologyShadowQuery,
	checkOntologyShadowStore,
	getOntologyShadowPolicyHash,
	ONTOLOGY_SHADOW_MAX_QUERY_RESULTS,
	ONTOLOGY_SHADOW_MAX_STORE_BYTES,
	ONTOLOGY_SHADOW_PRODUCER_VERSION,
	type OntologyShadowRelation,
	type OntologyShadowResource,
	type OntologyShadowStore,
} from "./ontology-shadow-schema.ts";

export type { OntologyShadowRelation, OntologyShadowResource } from "./ontology-shadow-schema.ts";
export {
	ONTOLOGY_SHADOW_MAX_QUERY_RESULTS,
	ONTOLOGY_SHADOW_MAX_RESOURCES,
	ONTOLOGY_SHADOW_PRODUCER_VERSION,
} from "./ontology-shadow-schema.ts";

export interface OntologyShadowScope {
	readonly scopeId: string;
	readonly storePath: string;
	readonly commonDir?: string;
	readonly worktreeDir?: string;
}

export interface OntologyShadowRevision {
	readonly head: string;
	readonly resources: readonly OntologyShadowResource[];
	readonly relations?: readonly OntologyShadowRelation[];
	readonly producerVersion?: string;
	readonly policyHash?: string;
}

export interface OntologyShadowQuery extends OntologyShadowRevision {
	readonly text: string;
	readonly limit?: number;
	readonly relation?: OntologyShadowRelation["type"];
}

export interface OntologyShadowQueryResult {
	readonly status: "fresh" | "stale";
	readonly selectedIds: readonly string[];
}

function gitEnvironment(): NodeJS.ProcessEnv {
	return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_")));
}

/** Resolve identity only after the caller has enabled the shadow. HEAD is revision, never scope identity. */
export function resolveOntologyShadowScope(cwd: string): OntologyShadowScope {
	const result = spawnSync(
		"git",
		["-C", cwd, "-c", "core.fsmonitor=false", "rev-parse", "--absolute-git-dir", "--git-common-dir"],
		{ cwd: tmpdir(), env: gitEnvironment(), encoding: "utf8", timeout: 2000, windowsHide: true },
	);
	if (result.status !== 0)
		throw new Error(
			`Ontology shadow requires a Git worktree (status=${String(result.status)}, error=${String(result.error ?? "none")}, stderr=${result.stderr.trim()})`,
		);
	const fields = result.stdout.trimEnd().split(/\r?\n/);
	if (fields.length !== 2 || fields.some((field) => field.length === 0)) {
		throw new Error("Ambiguous Git scope");
	}
	const worktreeDir = realpathSync.native(resolve(cwd, fields[0]));
	const commonDir = realpathSync.native(resolve(cwd, fields[1]));
	const scopeId = sha256Canonical({ schemaVersion: 1, commonDir, worktreeDir });
	return {
		scopeId,
		commonDir,
		worktreeDir,
		storePath: join(commonDir, "omk", "ontology-shadow", `${scopeId}.json`),
	};
}

export function resolveOntologyShadowHead(cwd: string): string {
	const result = spawnSync("git", ["-C", cwd, "-c", "core.fsmonitor=false", "rev-parse", "--verify", "HEAD"], {
		cwd: tmpdir(),
		env: gitEnvironment(),
		encoding: "utf8",
		timeout: 1000,
		windowsHide: true,
	});
	if (result.status !== 0) throw new Error("Ontology shadow requires a readable HEAD revision");
	const head = result.stdout.trim();
	if (!/^[0-9a-fA-F]{40,64}$/.test(head)) throw new Error("Invalid Git HEAD revision");
	return head;
}

function compareText(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function normalizedResources(resources: readonly OntologyShadowResource[]): OntologyShadowResource[] {
	return [...resources].sort((a, b) => compareText(a.id, b.id));
}

function currentRevision(revision: OntologyShadowRevision) {
	return {
		head: revision.head,
		producerVersion: revision.producerVersion ?? ONTOLOGY_SHADOW_PRODUCER_VERSION,
		policyHash: revision.policyHash ?? getOntologyShadowPolicyHash(),
		resources: normalizedResources(revision.resources),
		relations: [...(revision.relations ?? [])].sort((a, b) =>
			compareText(`${a.from}\0${a.to}\0${a.type}`, `${b.from}\0${b.to}\0${b.type}`),
		),
	};
}

export function writeOntologyShadowStore(scope: OntologyShadowScope, revision: OntologyShadowRevision): void {
	const current = currentRevision(revision);
	const store: OntologyShadowStore = {
		schemaVersion: 1,
		scopeId: scope.scopeId,
		...current,
	};
	if (!checkOntologyShadowStore(store)) throw new Error("Ontology shadow store schema rejected the input");
	const serialized = `${JSON.stringify(store)}\n`;
	if (Buffer.byteLength(serialized, "utf8") > ONTOLOGY_SHADOW_MAX_STORE_BYTES) {
		throw new Error("Ontology shadow store exceeds its byte bound");
	}
	mkdirSync(dirname(scope.storePath), { recursive: true, mode: 0o700 });
	atomicRewriteFileSync(scope.storePath, serialized);
}

function readStore(scope: OntologyShadowScope): OntologyShadowStore | null {
	try {
		if (!existsSync(scope.storePath) || statSync(scope.storePath).size > ONTOLOGY_SHADOW_MAX_STORE_BYTES) {
			return null;
		}
		const parsed: unknown = JSON.parse(readFileSync(scope.storePath, "utf8"));
		if (!checkOntologyShadowStore(parsed) || parsed.scopeId !== scope.scopeId) return null;
		return parsed;
	} catch {
		return null;
	}
}

function scoreResource(queryTokens: readonly string[], resource: OntologyShadowResource): number {
	if (queryTokens.length === 0) return 0;
	const nameTokens = new Set(tokenizeForRelevance(resource.name));
	const metadataTokens = new Set(tokenizeForRelevance(`${resource.name} ${resource.description} ${resource.kind}`));
	let score = 0;
	for (const token of queryTokens) {
		if (nameTokens.has(token)) score += 2;
		else if (metadataTokens.has(token)) score += 1;
	}
	return score / (queryTokens.length * 2);
}

/** Read-only bounded query. Any schema, scope, revision or content mismatch is a stale cache miss. */
export function queryOntologyShadowStore(
	scope: OntologyShadowScope,
	query: OntologyShadowQuery,
): OntologyShadowQueryResult {
	const store = readStore(scope);
	if (!store) return { status: "stale", selectedIds: [] };
	const current = currentRevision(query);
	if (
		sha256Canonical({ ...current, scopeId: scope.scopeId }) !==
		sha256Canonical({
			head: store.head,
			producerVersion: store.producerVersion,
			policyHash: store.policyHash,
			resources: store.resources,
			relations: store.relations,
			scopeId: store.scopeId,
		})
	) {
		return { status: "stale", selectedIds: [] };
	}
	const normalizedQuery = {
		text: query.text.slice(0, 2048),
		limit: Math.max(1, Math.min(ONTOLOGY_SHADOW_MAX_QUERY_RESULTS, Math.floor(query.limit ?? 16))),
		...(query.relation === undefined ? {} : { relation: query.relation }),
	};
	if (!checkOntologyShadowQuery(normalizedQuery)) return { status: "stale", selectedIds: [] };
	const queryTokens = tokenizeForRelevance(normalizedQuery.text).slice(0, 64);
	const relatedIds =
		normalizedQuery.relation === undefined
			? null
			: new Set(
					store.relations
						.filter((relation) => relation.type === normalizedQuery.relation)
						.flatMap((relation) => [relation.from, relation.to]),
				);
	const selectedIds = store.resources
		.map((resource) => ({ id: resource.id, score: scoreResource(queryTokens, resource) }))
		.filter((entry) => entry.score > 0 && (relatedIds === null || relatedIds.has(entry.id)))
		.sort((a, b) => b.score - a.score || compareText(a.id, b.id))
		.slice(0, normalizedQuery.limit)
		.map((entry) => entry.id);
	return { status: "fresh", selectedIds };
}
