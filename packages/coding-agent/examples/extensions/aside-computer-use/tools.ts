/**
 * Tool facade exposed to the OMK LLM.
 *
 * Design: the agent (LLM) is the planner. It calls these tools; the extension
 * applies the full safety gate (risk → authorize → approve → profile lock →
 * execute → redact → evidence) on every browser action. This keeps Algorithm 2's
 * safety loop intact while matching OMK's tool-call agent model.
 *
 * Tools:
 *   aside_observe            — R0 read-only browser observation
 *   aside_plan_action        — propose an action without executing (pure helper)
 *   aside_execute_action     — gate + execute one BrowserAction
 *   aside_verify             — check success criteria against current observation
 *   aside_take_screenshot    — R0, save frame to evidence dir with sha256
 *   aside_download_artifact  — R1 download, hash file
 *   aside_start_task         — observe → scripted plan → gate+execute loop
 *   aside_close_task         — close the Aside MCP process
 */

import { StringEnum, Type } from "@earendil-works/omk-ai";
import type { ExtensionAPI, ExtensionContext } from "open-multi-agent-kit";
import { parseCriterionToAssertion, verifyAssertions } from "./assertions.ts";
import { hashFile, redactSecrets } from "./evidence.ts";
import type { AsideMcpClient } from "./mcp-client.ts";
import type { AsidePolicy } from "./policy.ts";
import { authorize } from "./risk-authorize.ts";
import { classifyRisk } from "./risk-classifier.ts";
import type { BrowserAction, BrowserClient, Evidence, McpCallResult, Observation, RiskLevel } from "./types.ts";
import { resolveOrigin } from "./url-origin.ts";

export interface AsideToolsDeps {
	/** Lazily create (and memoize) the MCP client. */
	getClient: () => AsideMcpClient;
	policy: AsidePolicy;
	evidenceDirectory: string;
}

/** Thin BrowserClient adapter over AsideMcpClient for the controller. */
class AsideBrowserClient implements BrowserClient {
	private readonly client: AsideMcpClient;

	constructor(client: AsideMcpClient) {
		this.client = client;
	}

	async observe(): Promise<Observation> {
		const result = await this.client.callTool("observe", {});
		const text = result.content.find((c) => c.type === "text")?.text ?? "";
		let parsed: { url?: string; title?: string; text?: string } = {};
		try {
			parsed = JSON.parse(text);
		} catch {
			parsed = { text };
		}
		const observation: Observation = {
			url: parsed.url ?? "(unknown)",
			title: parsed.title,
			text: parsed.text ?? text,
		};
		return observation;
	}

	async execute(action: BrowserAction): Promise<{ ok: boolean; raw: McpCallResult; sideEffectKind?: string }> {
		if (!action.asideTool) throw new Error(`action ${action.kind} has no asideTool mapping`);
		try {
			const result = await this.client.callTool(action.asideTool, action.asideArgs ?? {});
			const ok = result.isError !== true;
			return { ok, raw: result, sideEffectKind: ok && isMutatingKind(action.kind) ? action.kind : undefined };
		} catch (error) {
			return { ok: false, raw: { content: [{ type: "text", text: (error as Error).message }] } };
		}
	}

	async listTools(): Promise<readonly Awaited<ReturnType<BrowserClient["listTools"]>>[number][]> {
		return this.client.listTools();
	}

	async close(): Promise<void> {
		await this.client.close();
	}
}

function isMutatingKind(kind: string): boolean {
	const risk = classifyRisk({ kind, description: "" });
	return risk === "R2" || risk === "R3";
}

/** Map a facade action kind to an Aside MCP tool name + args. */
function mapToAsideTool(action: BrowserAction): BrowserAction {
	const table: Readonly<Record<string, string>> = {
		open_page: "navigate",
		navigate: "navigate",
		read_text: "read_text",
		screenshot: "screenshot",
		take_screenshot: "screenshot",
		click_locator: "click",
		click: "click",
		fill_form: "fill",
		type: "type",
		submit: "submit",
		download: "download",
	};
	const asideTool = action.asideTool ?? table[action.kind];
	return { ...action, asideTool, asideArgs: action.asideArgs ?? buildArgs(action) };
}

function buildArgs(action: BrowserAction): Record<string, unknown> {
	const args: Record<string, unknown> = {};
	if (action.url) args.url = action.url;
	if (action.description) args.description = action.description;
	return args;
}

/** Ask the user to confirm an R2/approved action. In non-UI modes, deny. */
async function humanApprove(
	ctx: ExtensionContext,
	action: BrowserAction,
	risk: RiskLevel,
	origin?: string,
): Promise<boolean> {
	if (!ctx.hasUI) return false;
	const detail = `${risk} action on ${origin ?? "(unknown origin)"}\nkind: ${action.kind}\n${action.description}`;
	return ctx.ui.confirm("Aside action approval", detail);
}

/** Register the Aside tool facade against the given OMK API + deps. */
export function registerAsideTools(omk: ExtensionAPI, deps: AsideToolsDeps): void {
	const { policy, evidenceDirectory } = deps;
	const browserClient = () => new AsideBrowserClient(deps.getClient());

	const promptGuidelines = [
		"Use aside_observe before aside_execute_action so actions target a known page state.",
		"Never run aside_execute_action for payment, account deletion, credential export, or security setting changes — they are denied by policy.",
		"aside_execute_action may prompt the user for approval on submit/send/publish actions; that is intended.",
		"Only call aside_execute_action against origins listed in the Aside policy allowedOrigins.",
	];

	// aside_observe
	omk.registerTool({
		name: "aside_observe",
		label: "Aside Observe",
		description: "Read-only observation of the current Aside browser page (URL, title, text).",
		promptSnippet: "Read the current Aside browser page state",
		promptGuidelines,
		parameters: Type.Object({}),
		async execute(_id, _params, _signal) {
			const client = browserClient();
			const obs = await client.observe();
			const safe = redactSecrets(obs);
			return { content: [{ type: "text", text: JSON.stringify(safe) }], details: { observation: safe } };
		},
	});

	// aside_execute_action
	omk.registerTool({
		name: "aside_execute_action",
		label: "Aside Execute Action",
		description:
			"Gate and execute one browser action through Aside (risk classification, origin check, human approval for mutations, secret redaction).",
		promptSnippet: "Run one gated browser action via Aside",
		parameters: Type.Object({
			kind: StringEnum([
				"open_page",
				"navigate",
				"read_text",
				"click_locator",
				"click",
				"fill_form",
				"type",
				"submit",
				"send_message",
				"download",
				"screenshot",
			] as const),
			url: Type.Optional(Type.String({ description: "Target URL for navigation actions" })),
			description: Type.String({ description: "Human-readable description of what the action does" }),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const action: BrowserAction = mapToAsideTool({
				kind: params.kind,
				url: params.url,
				description: params.description,
			});
			const client = browserClient();
			const obs = await client.observe();
			const targetOrigin = resolveOrigin(action.url ?? obs.url);
			const risk = classifyRisk(action);
			const decision = authorize({ ...action, url: action.url ?? obs.url }, risk, {
				deniedActions: policy.deniedActions,
				privilegedR3Actions: policy.privilegedR3Actions,
				allowedOrigins: policy.allowedOrigins,
				allowReadAnyOrigin: policy.allowReadAnyOrigin,
			});
			if (decision.decision === "deny") {
				return blockedText(`denied: ${decision.reason}`);
			}
			if (decision.decision === "approve") {
				const ok = await humanApprove(ctx, action, risk, targetOrigin);
				if (!ok) return blockedText("denied: human approval denied");
			}
			const result = await client.execute(action);
			const evidence = extractEvidence(result.raw, action.kind);
			const safeEvidence = redactSecrets(evidence);
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({ ok: result.ok, risk, origin: targetOrigin, evidence: safeEvidence }),
					},
				],
				details: { ok: result.ok, risk, evidence: safeEvidence, sideEffect: result.sideEffectKind },
			};
		},
	});

	// aside_verify
	omk.registerTool({
		name: "aside_verify",
		label: "Aside Verify",
		description:
			"Check typed success criteria against the current observation. Low-confidence token overlap is inconclusive by default.",
		promptSnippet: "Verify typed success criteria against current page",
		parameters: Type.Object({
			criteria: Type.Array(Type.Object({ id: Type.String(), description: Type.String() })),
		}),
		async execute(_id, params) {
			const client = browserClient();
			const obs = await client.observe();
			const assertions = params.criteria.map((criterion) => parseCriterionToAssertion(criterion));
			const verification = verifyAssertions(assertions, obs);
			const satisfied = verification.assertions
				.filter((result) => result.status === "pass")
				.map((result) => result.assertion.id);
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							status: verification.status,
							confidence: verification.confidence,
							satisfied,
							url: obs.url,
						}),
					},
				],
				details: { verification, satisfied },
			};
		},
	});

	// aside_take_screenshot
	omk.registerTool({
		name: "aside_take_screenshot",
		label: "Aside Screenshot",
		description: "Capture a screenshot of the current page, save it to the evidence directory with a sha256 hash.",
		promptSnippet: "Capture a screenshot of the current page",
		parameters: Type.Object({}),
		async execute() {
			const client = browserClient();
			const action = mapToAsideTool({ kind: "screenshot", description: "screenshot" });
			const result = await client.execute(action);
			const path = findFilePath(result.raw);
			let sha: string | undefined;
			if (path) {
				try {
					sha = await hashFile(path);
				} catch {
					// hash best-effort
				}
			}
			const evidence: Evidence = { type: "screenshot", path: path ?? evidenceDirectory, sha256: sha };
			return { content: [{ type: "text", text: JSON.stringify(evidence) }], details: { evidence } };
		},
	});

	// aside_download_artifact
	omk.registerTool({
		name: "aside_download_artifact",
		label: "Aside Download",
		description: "Download a file via Aside (gated by origin policy) and hash it for evidence integrity.",
		promptSnippet: "Download a file via Aside and hash it",
		parameters: Type.Object({
			url: Type.String(),
			description: Type.String(),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const action = mapToAsideTool({ kind: "download", url: params.url, description: params.description });
			const client = browserClient();
			const obs = await client.observe();
			const risk = classifyRisk(action);
			const decision = authorize({ ...action, url: action.url ?? obs.url }, risk, {
				deniedActions: policy.deniedActions,
				privilegedR3Actions: policy.privilegedR3Actions,
				allowedOrigins: policy.allowedOrigins,
				allowReadAnyOrigin: policy.allowReadAnyOrigin,
			});
			if (decision.decision === "deny") return blockedText(`denied: ${decision.reason}`);
			if (decision.decision === "approve") {
				const ok = await humanApprove(ctx, action, risk, resolveOrigin(params.url));
				if (!ok) return blockedText("denied: human approval denied");
			}
			const result = await client.execute(action);
			const path = findFilePath(result.raw);
			const sha = path ? await hashFile(path).catch(() => undefined) : undefined;
			return {
				content: [{ type: "text", text: JSON.stringify({ ok: result.ok, path, sha256: sha }) }],
				details: { ok: result.ok, path, sha256: sha },
			};
		},
	});

	// aside_plan_action (pure helper — no execution)
	omk.registerTool({
		name: "aside_plan_action",
		label: "Aside Plan Action",
		description:
			"Propose a gated BrowserAction (with its risk band and authorization decision) WITHOUT executing. Use to preview before aside_execute_action.",
		promptSnippet: "Preview a gated action and its risk/authorization",
		parameters: Type.Object({
			kind: StringEnum([
				"open_page",
				"click_locator",
				"fill_form",
				"submit",
				"send_message",
				"download",
				"screenshot",
			] as const),
			url: Type.Optional(Type.String()),
			description: Type.String(),
		}),
		async execute(_id, params) {
			const action = mapToAsideTool({ kind: params.kind, url: params.url, description: params.description });
			const risk = classifyRisk(action);
			const decision = authorize(action, risk, {
				deniedActions: policy.deniedActions,
				privilegedR3Actions: policy.privilegedR3Actions,
				allowedOrigins: policy.allowedOrigins,
				allowReadAnyOrigin: policy.allowReadAnyOrigin,
			});
			return {
				content: [{ type: "text", text: JSON.stringify({ risk, decision, mappedTool: action.asideTool }) }],
				details: { risk, decision },
			};
		},
	});

	// aside_start_task — observe → scripted plan → gated execute loop
	omk.registerTool({
		name: "aside_start_task",
		label: "Aside Start Task",
		description:
			"Run observe → [scripted plan] → gate+execute for each step against the Aside policy. Pass an explicit ordered plan; each step is risk-classified, origin-checked, and approval-gated.",
		promptSnippet: "Run a gated multi-step Aside task from an explicit plan",
		parameters: Type.Object({
			goal: Type.String(),
			steps: Type.Array(
				Type.Object({
					kind: StringEnum([
						"open_page",
						"click_locator",
						"fill_form",
						"submit",
						"send_message",
						"download",
						"screenshot",
						"read_text",
					] as const),
					url: Type.Optional(Type.String()),
					description: Type.String(),
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const client = browserClient();
			const results: Array<Record<string, unknown>> = [];
			for (const step of params.steps) {
				const action = mapToAsideTool({ kind: step.kind, url: step.url, description: step.description });
				const obs = await client.observe();
				const risk = classifyRisk(action);
				const decision = authorize({ ...action, url: action.url ?? obs.url }, risk, {
					deniedActions: policy.deniedActions,
					privilegedR3Actions: policy.privilegedR3Actions,
					allowedOrigins: policy.allowedOrigins,
					allowReadAnyOrigin: policy.allowReadAnyOrigin,
				});
				if (decision.decision === "deny") {
					results.push({ kind: action.kind, denied: decision.reason });
					break;
				}
				if (decision.decision === "approve") {
					const ok = await humanApprove(ctx, action, risk, resolveOrigin(action.url ?? obs.url));
					if (!ok) {
						results.push({ kind: action.kind, denied: "human approval denied" });
						break;
					}
				}
				const result = await client.execute(action);
				results.push({ kind: action.kind, ok: result.ok, sideEffect: result.sideEffectKind });
			}
			return {
				content: [{ type: "text", text: JSON.stringify({ goal: params.goal, results }) }],
				details: { results },
			};
		},
	});

	// aside_close_task
	omk.registerTool({
		name: "aside_close_task",
		label: "Aside Close",
		description: "Close the Aside MCP process (graceful). Call when the browser task is finished.",
		promptSnippet: "Close the Aside MCP process",
		parameters: Type.Object({}),
		async execute() {
			await deps.getClient().close();
			return { content: [{ type: "text", text: "aside mcp closed" }], details: { closed: true } };
		},
	});
}

// ---- helpers --------------------------------------------------------------

function blockedText(reason: string): {
	content: Array<{ type: "text"; text: string }>;
	details: { blocked: boolean; reason: string };
} {
	return { content: [{ type: "text", text: reason }], details: { blocked: true, reason } };
}

function extractEvidence(raw: McpCallResult, kind: string): Evidence[] {
	const text = raw.content.find((c) => c.type === "text")?.text;
	const evidence: Evidence[] = [];
	if (text) evidence.push({ type: "dom_text", value: text.slice(0, 4000), source: kind });
	const path = findFilePath(raw);
	if (path) evidence.push({ type: "file", path });
	return evidence;
}

function findFilePath(raw: McpCallResult): string | undefined {
	const text = raw.content.find((c) => c.type === "text")?.text;
	if (!text) return undefined;
	try {
		const parsed = JSON.parse(text) as { path?: string; file?: string; downloadedTo?: string };
		return parsed.path ?? parsed.file ?? parsed.downloadedTo;
	} catch {
		return undefined;
	}
}
