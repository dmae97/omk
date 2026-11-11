import { basename } from "node:path";
import type { Model } from "omk-ai";
import type { ContextBudgetItemV2 } from "./context-budget-headroom.ts";
import type { SystemPromptContextBudgetOptions } from "./context-budget-system-prompt.ts";
import { sha256Canonical, sha256Hex } from "./context-budget-v2-cache-hash.ts";
import type { ContextFile } from "./context-file.ts";
import { selectContextFilesForModel } from "./model-prompt-policy.ts";
import {
	type OntologyShadowResource,
	type OntologyShadowScope,
	queryOntologyShadowStore,
	resolveOntologyShadowHead,
	resolveOntologyShadowScope,
	writeOntologyShadowStore,
} from "./ontology-shadow-store.ts";
import type { ResourceLoader } from "./resource-loader.ts";
import type { Skill } from "./skills.ts";

export interface OntologyShadowSourceResources {
	readonly contextFiles: readonly ContextFile[];
	readonly skills: readonly Skill[];
}

export interface OntologyShadowObservationInput {
	readonly cwd: string;
	readonly enabled: boolean;
	readonly query: string;
	readonly resources: OntologyShadowSourceResources;
	readonly nativeItems: readonly ContextBudgetItemV2[];
	readonly selectedItemIds: readonly string[];
	readonly scopeResolver?: (cwd: string) => OntologyShadowScope;
}

export interface OntologyShadowObservation {
	readonly status: "disabled" | "unavailable" | "compared";
	readonly scopeId?: string;
	readonly storeStatus?: "fresh" | "stale";
	readonly queryHash?: string;
	readonly candidateCount?: number;
	readonly nativeCandidateHashes?: readonly string[];
	readonly nativeSelectedIds?: readonly string[];
	readonly shadowSelectedIds?: readonly string[];
	readonly nativeOnlyIds?: readonly string[];
	readonly shadowOnlyIds?: readonly string[];
}

function contextResourceId(path: string): string {
	return `context-file:${sha256Hex(path)}`;
}

function nativeResourceId(itemId: string): string | null {
	if (itemId.startsWith("skill:")) return itemId;
	for (const prefix of ["context-pointer:", "context-full:"]) {
		if (itemId.startsWith(prefix)) return contextResourceId(itemId.slice(prefix.length));
	}
	return null;
}

function sourceResources(input: OntologyShadowSourceResources): OntologyShadowResource[] {
	const contextFiles = input.contextFiles.map((file) => ({
		id: contextResourceId(file.path),
		kind: "context-file" as const,
		name: basename(file.path),
		description: file.isGlobal ? "Global context instructions" : "Project context instructions",
		contentHash: sha256Hex(file.content),
		locationHash: sha256Hex(file.path),
	}));
	const skills = input.skills.map((skill) => ({
		id: `skill:${skill.name}`,
		kind: "skill" as const,
		name: skill.name,
		description: skill.description,
		contentHash: skill.contentHash ?? sha256Canonical({ name: skill.name, description: skill.description }),
		locationHash: sha256Hex(skill.filePath),
	}));
	return [...contextFiles, ...skills];
}

function difference(left: ReadonlySet<string>, right: ReadonlySet<string>): string[] {
	return [...left].filter((value) => !right.has(value)).sort();
}

/** Shadow-only comparison. The native item and selected-ID inputs are never mutated or returned for prompt use. */
export function observeOntologyShadow(input: OntologyShadowObservationInput): OntologyShadowObservation {
	if (!input.enabled) return { status: "disabled" };
	try {
		const scope = (input.scopeResolver ?? resolveOntologyShadowScope)(input.cwd);
		const admittedIds = new Set(
			input.nativeItems.flatMap((item) => {
				const resourceId = nativeResourceId(item.id);
				return resourceId === null ? [] : [resourceId];
			}),
		);
		const resources = sourceResources(input.resources).filter((resource) => admittedIds.has(resource.id));
		const revision = { head: resolveOntologyShadowHead(input.cwd), resources };
		let queryResult = queryOntologyShadowStore(scope, { ...revision, text: input.query });
		if (queryResult.status === "stale") {
			writeOntologyShadowStore(scope, revision);
			queryResult = queryOntologyShadowStore(scope, { ...revision, text: input.query });
		}
		if (queryResult.status !== "fresh") return { status: "unavailable", scopeId: scope.scopeId };

		const nativeCandidates = input.nativeItems.flatMap((item) => {
			const resourceId = nativeResourceId(item.id);
			return resourceId === null
				? []
				: [{ resourceId, hash: sha256Canonical({ resourceId, sourceRef: item.sourceRef ?? null }) }];
		});
		const nativeSelected = new Set(
			input.selectedItemIds.flatMap((itemId) => {
				const resourceId = nativeResourceId(itemId);
				return resourceId === null ? [] : [resourceId];
			}),
		);
		const shadowSelected = new Set(queryResult.selectedIds);
		return {
			status: "compared",
			scopeId: scope.scopeId,
			storeStatus: queryResult.status,
			queryHash: sha256Hex(input.query),
			candidateCount: nativeCandidates.length,
			nativeCandidateHashes: nativeCandidates.map((candidate) => candidate.hash).sort(),
			nativeSelectedIds: [...nativeSelected].sort(),
			shadowSelectedIds: [...shadowSelected].sort(),
			nativeOnlyIds: difference(nativeSelected, shadowSelected),
			shadowOnlyIds: difference(shadowSelected, nativeSelected),
		};
	} catch {
		return { status: "unavailable" };
	}
}

export interface OntologyShadowSessionObserverInput {
	readonly cwd: string;
	readonly queryContext?: string;
	readonly model?: Model<any>;
	readonly resourceLoader: ResourceLoader;
	readonly setObservation: (observation: OntologyShadowObservation | null) => void;
}

export function withOntologyShadowObservation(
	options: SystemPromptContextBudgetOptions | undefined,
	input: OntologyShadowSessionObserverInput,
): SystemPromptContextBudgetOptions | undefined {
	if (!options || process.env.OMK_ONTOLOGY_SHADOW !== "1") {
		input.setObservation(null);
		return options;
	}
	return {
		...options,
		observePlan: (plan, items) => {
			input.setObservation(
				observeOntologyShadow({
					cwd: input.cwd,
					enabled: true,
					query: input.queryContext ?? "initial system prompt build",
					resources: {
						contextFiles: selectContextFilesForModel(
							input.resourceLoader.getAgentsFiles().agentsFiles,
							input.model,
						),
						skills: input.resourceLoader.getSkills().skills,
					},
					nativeItems: items,
					selectedItemIds: plan.includedItemIds,
				}),
			);
		},
	};
}
