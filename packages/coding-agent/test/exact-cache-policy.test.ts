import { describe, expect, it } from "vitest";
import {
	canCacheToolResult,
	canonicalizeJson,
	classifyToolResultCacheEligibility,
	createExactResponseCacheKey,
	createToolResultCacheKey,
	type ExactResponseCacheKeyInput,
	hashCanonicalJson,
	type ToolResultCacheKeyInput,
} from "../src/core/exact-cache-policy.ts";

const responseInput: ExactResponseCacheKeyInput = {
	provider: "anthropic",
	model: "claude-sonnet-4-5",
	modelRevision: "2026-06-01",
	messages: [
		{
			role: "user",
			content: [{ type: "text", text: "Summarize this repository" }],
		},
	],
	toolSchema: {
		tools: [
			{
				name: "read",
				inputSchema: { type: "object", properties: { path: { type: "string" } } },
			},
		],
	},
	temperature: 0,
	seed: 42,
	reasoningEffort: "medium",
	promptPolicyVersion: "prompt-policy-v1",
	tenantId: "tenant-a",
	userId: "user-a",
	repoHead: "abc123",
	worktreeHash: "worktree-hash",
	environmentHash: "environment-hash",
};

const toolInput: ToolResultCacheKeyInput = {
	toolName: "read",
	args: { path: "src/index.ts", options: { maxBytes: 1000, offset: 0 } },
	repoHead: "abc123",
	worktreeHash: "worktree-hash",
	toolVersion: "read-v1",
	environmentHash: "environment-hash",
};

describe("exact cache policy", () => {
	it("canonicalizes JSON with recursively sorted object keys before hashing", () => {
		const value = { b: 2, a: { z: [3, { b: false, a: true }], y: null } };
		const reordered = { a: { y: null, z: [3, { a: true, b: false }] }, b: 2 };

		expect(canonicalizeJson(value)).toBe('{"a":{"y":null,"z":[3,{"a":true,"b":false}]},"b":2}');
		expect(hashCanonicalJson(value)).toBe(hashCanonicalJson(reordered));
		expect(hashCanonicalJson([{ a: 1 }, { b: 2 }])).not.toBe(hashCanonicalJson([{ b: 2 }, { a: 1 }]));
	});

	it("creates deterministic exact response keys from required model, prompt, scope, repo, worktree, and environment fields", () => {
		const key = createExactResponseCacheKey(responseInput);
		const equivalent = createExactResponseCacheKey({
			...responseInput,
			toolSchema: {
				tools: [
					{
						inputSchema: { properties: { path: { type: "string" } }, type: "object" },
						name: "read",
					},
				],
			},
		});

		expect(key.kind).toBe("exact-response");
		expect(key.key).toBe(equivalent.key);
		expect(key.messagesHash).toBe(hashCanonicalJson(responseInput.messages));
		expect(key.toolSchemaHash).toBe(hashCanonicalJson(responseInput.toolSchema));
		expect(key.material).toEqual({
			kind: "exact-response",
			version: "v1",
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			modelRevision: "2026-06-01",
			messagesHash: key.messagesHash,
			toolSchemaHash: key.toolSchemaHash,
			temperature: 0,
			seed: 42,
			reasoningEffort: "medium",
			promptPolicyVersion: "prompt-policy-v1",
			contextBudget: null,
			tenantId: "tenant-a",
			userId: "user-a",
			repoHead: "abc123",
			worktreeHash: "worktree-hash",
			environmentHash: "environment-hash",
		});
		expect(createExactResponseCacheKey({ ...responseInput, modelRevision: "2026-06-02" }).key).not.toBe(key.key);
		expect(createExactResponseCacheKey({ ...responseInput, seed: 43 }).key).not.toBe(key.key);
		expect(createExactResponseCacheKey({ ...responseInput, userId: "user-b" }).key).not.toBe(key.key);
		expect(createExactResponseCacheKey({ ...responseInput, repoHead: "def456" }).key).not.toBe(key.key);
	});

	it("creates deterministic tool-result keys from canonical arguments and execution context", () => {
		const key = createToolResultCacheKey(toolInput);
		const equivalent = createToolResultCacheKey({
			...toolInput,
			args: { options: { offset: 0, maxBytes: 1000 }, path: "src/index.ts" },
		});

		expect(key.kind).toBe("tool-result");
		expect(key.key).toBe(equivalent.key);
		expect(key.canonicalArgs).toBe('{"options":{"maxBytes":1000,"offset":0},"path":"src/index.ts"}');
		expect(key.material).toEqual({
			kind: "tool-result",
			version: "v1",
			toolName: "read",
			canonicalArgs: key.canonicalArgs,
			repoHead: "abc123",
			worktreeHash: "worktree-hash",
			toolVersion: "read-v1",
			environmentHash: "environment-hash",
		});
		expect(createToolResultCacheKey({ ...toolInput, toolVersion: "read-v2" }).key).not.toBe(key.key);
		expect(createToolResultCacheKey({ ...toolInput, environmentHash: "other-env" }).key).not.toBe(key.key);
	});

	it("fails closed for tool results that are mutating, errors, secret-marked, or impure bash", () => {
		expect(classifyToolResultCacheEligibility({ toolName: "read", status: "success" })).toEqual({
			eligible: true,
			reason: "eligible",
		});
		expect(canCacheToolResult({ toolName: "read", status: "success" })).toBe(true);
		expect(classifyToolResultCacheEligibility({ toolName: "write", status: "success" })).toMatchObject({
			eligible: false,
			reason: "tool.mutating",
		});
		expect(
			classifyToolResultCacheEligibility({ toolName: "custom-inspector", mutates: true, status: "success" }),
		).toMatchObject({
			eligible: false,
			reason: "tool.mutating",
		});
		expect(classifyToolResultCacheEligibility({ toolName: "read", status: "error" })).toMatchObject({
			eligible: false,
			reason: "result.error",
		});
		expect(
			classifyToolResultCacheEligibility({ toolName: "read", status: "success", secretMarked: true }),
		).toMatchObject({
			eligible: false,
			reason: "result.secret",
		});
		expect(classifyToolResultCacheEligibility({ toolName: "bash", status: "success" })).toMatchObject({
			eligible: false,
			reason: "bash.impure",
		});
		expect(classifyToolResultCacheEligibility({ toolName: "bash", status: "success", bashPure: true })).toMatchObject(
			{
				eligible: true,
				reason: "eligible",
			},
		);
	});
});
