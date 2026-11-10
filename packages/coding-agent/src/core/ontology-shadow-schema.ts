import { Type } from "typebox";
import { Compile } from "typebox/compile";
import { sha256Canonical } from "./context-budget-v2-cache-hash.ts";
import { CONTEXT_BUDGET_SELECTION_POLICY_V2 } from "./context-budget-v2-types.ts";

export const ONTOLOGY_SHADOW_PRODUCER_VERSION = "ontology-shadow-v1";
export const ONTOLOGY_SHADOW_MAX_RESOURCES = 256;
export const ONTOLOGY_SHADOW_MAX_QUERY_RESULTS = 32;
export const ONTOLOGY_SHADOW_MAX_STORE_BYTES = 1024 * 1024;
const ALLOWED_RELATIONS = ["contains", "references"] as const;

const ResourceSchema = Type.Object(
	{
		id: Type.String({ minLength: 1, maxLength: 256 }),
		kind: Type.Union([Type.Literal("context-file"), Type.Literal("skill")]),
		name: Type.String({ minLength: 1, maxLength: 256 }),
		description: Type.String({ maxLength: 4000 }),
		contentHash: Type.String({ minLength: 1, maxLength: 128 }),
		locationHash: Type.String({ minLength: 1, maxLength: 128 }),
	},
	{ additionalProperties: false },
);
const RelationSchema = Type.Object(
	{
		from: Type.String({ minLength: 1, maxLength: 256 }),
		to: Type.String({ minLength: 1, maxLength: 256 }),
		type: Type.Union(ALLOWED_RELATIONS.map((value) => Type.Literal(value))),
	},
	{ additionalProperties: false },
);
const StoreSchema = Type.Object(
	{
		schemaVersion: Type.Literal(1),
		scopeId: Type.String({ minLength: 16, maxLength: 128 }),
		head: Type.String({ maxLength: 128 }),
		producerVersion: Type.String({ minLength: 1, maxLength: 64 }),
		policyHash: Type.String({ minLength: 64, maxLength: 64 }),
		resources: Type.Array(ResourceSchema, { maxItems: ONTOLOGY_SHADOW_MAX_RESOURCES }),
		relations: Type.Array(RelationSchema, { maxItems: 512 }),
	},
	{ additionalProperties: false },
);
const QuerySchema = Type.Object(
	{
		text: Type.String({ maxLength: 2048 }),
		limit: Type.Integer({ minimum: 1, maximum: ONTOLOGY_SHADOW_MAX_QUERY_RESULTS }),
		relation: Type.Optional(Type.Union(ALLOWED_RELATIONS.map((value) => Type.Literal(value)))),
	},
	{ additionalProperties: false },
);

export interface OntologyShadowResource {
	readonly id: string;
	readonly kind: "context-file" | "skill";
	readonly name: string;
	readonly description: string;
	readonly contentHash: string;
	readonly locationHash: string;
}

export interface OntologyShadowRelation {
	readonly from: string;
	readonly to: string;
	readonly type: (typeof ALLOWED_RELATIONS)[number];
}

export interface OntologyShadowStore {
	readonly schemaVersion: 1;
	readonly scopeId: string;
	readonly head: string;
	readonly producerVersion: string;
	readonly policyHash: string;
	readonly resources: readonly OntologyShadowResource[];
	readonly relations: readonly OntologyShadowRelation[];
}

const compileStore = () => Compile(StoreSchema);
const compileQuery = () => Compile(QuerySchema);
let storeCheck: ReturnType<typeof compileStore> | undefined;
let queryCheck: ReturnType<typeof compileQuery> | undefined;
let policyHash: string | undefined;

/** Compile only on an enabled store operation, never merely because AgentSession imported its observer. */
export function checkOntologyShadowStore(value: unknown): value is OntologyShadowStore {
	if (storeCheck === undefined) storeCheck = compileStore();
	return storeCheck.Check(value);
}

export function checkOntologyShadowQuery(value: unknown): boolean {
	if (queryCheck === undefined) queryCheck = compileQuery();
	return queryCheck.Check(value);
}

export function getOntologyShadowPolicyHash(): string {
	if (policyHash === undefined) {
		policyHash = sha256Canonical({
			allowedRelations: ALLOWED_RELATIONS,
			maxQueryResults: ONTOLOGY_SHADOW_MAX_QUERY_RESULTS,
			maxResources: ONTOLOGY_SHADOW_MAX_RESOURCES,
			maxStoreBytes: ONTOLOGY_SHADOW_MAX_STORE_BYTES,
			nativeSelectionPolicy: CONTEXT_BUDGET_SELECTION_POLICY_V2,
			producerVersion: ONTOLOGY_SHADOW_PRODUCER_VERSION,
			ranking: "approved-metadata-token-coverage-v1",
		});
	}
	return policyHash;
}
