/**
 * Correctness Wall — B2C patch safety gate for edit/write and explicit evaluation.
 *
 * Loads fast policy wall + optional OA adjudication from omk-adaptorch-wpl (relative import only).
 */

import { readFile } from "node:fs/promises";
import { Type } from "omk-ai";
import type { ExtensionAPI, ExtensionContext } from "open-multi-agent-kit";
import type {
	AdaptOrchClient,
	UserVerdict,
	VerdictCard,
	VerificationReceipt,
} from "../../../../adaptorch-wpl/src/index.ts";
import {
	buildRegeneratePacket,
	capRepairHints,
	evaluateCorrectnessWall,
	parseOaTransportModeFromEnv,
	parseRepairBudget,
	shouldOfferRepair,
} from "../../../../adaptorch-wpl/src/index.ts";
import type { PolicyFlag } from "../../../../adaptorch-wpl/src/policy-wall.ts";
import {
	applyEditsToNormalizedContent,
	type Edit,
	generateUnifiedPatch,
	normalizeToLF,
	stripBom,
} from "../../../../coding-agent/src/core/tools/edit-diff.ts";
import { resolveToCwd } from "../../../../coding-agent/src/core/tools/path-utils.ts";
import {
	autoWireLiveAdaptOrch,
	CORRECTNESS_WALL_EXTENSION_VERSION,
	resolveAdjudicationFixturePath,
	resolveOaClientForEvaluation,
	wallVersionFromFixture,
} from "./adjudication-fixture.ts";
import { recordBlockedRepairAttempt, repairPacketKey, scopeKeyFromApprovedWriteScope } from "./repair-state.ts";
import { appendShadowTelemetry, type WallMode, writeVerdictCache } from "./wall-cache.ts";

const DEFAULT_KIND = "omk.patch";

const CorrectnessWallParams = Type.Object({
	kind: Type.String({ description: "Verifier kind / packet kind for adjudication registry" }),
	approvedWriteScope: Type.Optional(
		Type.Array(Type.String(), {
			description: "Glob paths allowed in the diff (overrides OMK_WALL_SCOPE for this call)",
		}),
	),
	previewOnly: Type.Optional(Type.Boolean({ description: "Preview-only fast wall (default true)", default: true })),
	diffPath: Type.Optional(Type.String({ description: "Filesystem path to unified diff text" })),
	runIds: Type.Optional(
		Type.Array(Type.String(), { description: "AdaptOrch run ids for OA adjudication when previewOnly is false" }),
	),
	packetId: Type.Optional(Type.String({ description: "Optional work packet id for receipt metadata" })),
	adjudicationFixturePath: Type.Optional(
		Type.String({
			description:
				"Path to OA adjudication fixture JSON (overrides OMK_WALL_OA_FIXTURE_PATH). Used when previewOnly is false and runIds are set.",
		}),
	),
});

function parseWallMode(): WallMode {
	const raw = (process.env.OMK_PATCH_SAFETY_WALL_MODE ?? "shadow").trim().toLowerCase();
	if (raw === "soft" || raw === "hard") return raw;
	return "shadow";
}

function parseApprovedScope(override?: string[]): string[] {
	if (override !== undefined && override.length > 0) {
		return override;
	}
	const env = process.env.OMK_WALL_SCOPE?.trim();
	if (!env) return [];
	return env
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

/** Comma-separated AdaptOrch run ids from `OMK_WALL_RUN_IDS` (hook OA path when fixture env is set). */
function parseRunIdsFromEnv(): string[] {
	const env = process.env.OMK_WALL_RUN_IDS?.trim();
	if (!env) return [];
	return env
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

function wallOverrideActive(): boolean {
	const v = process.env.OMK_WALL_OVERRIDE?.trim().toLowerCase();
	return v === "1" || v === "true" || v === "yes";
}

function autoRegenerateEnabled(): boolean {
	const v = process.env.OMK_WALL_AUTO_REGENERATE?.trim().toLowerCase();
	return v === "1" || v === "true" || v === "yes";
}

function receiptSigningSecret(): string | undefined {
	const v = process.env.OMK_WALL_RECEIPT_SIGNING_SECRET?.trim();
	return v && v.length > 0 ? v : undefined;
}

function isUnboundMcpCall(value: unknown): boolean {
	const message = value instanceof Error ? value.message : typeof value === "string" ? value : "";
	return /callMcpTool is not bound/i.test(message);
}

function shortBlockReason(card: VerdictCard): string {
	if (card.blocked_reasons.length > 0) return card.blocked_reasons[0];
	if (card.next_actions.length > 0) return card.next_actions[0];
	return `Correctness wall: ${card.verdict} (${card.risk} risk)`;
}

function shouldBlock(verdict: UserVerdict, mode: WallMode): boolean {
	if (mode === "shadow") return false;
	if (verdict === "PASS" || verdict === "ADVISORY") return false;
	if (mode === "hard") return verdict === "BLOCKED" || verdict === "INCONCLUSIVE";
	// soft
	if (verdict !== "BLOCKED") return false;
	return !wallOverrideActive();
}

function inconclusiveCard(kind: string, packetId?: string): VerdictCard {
	return {
		schemaVersion: 1,
		verdict: "INCONCLUSIVE",
		risk: "high",
		limits: { requiresHumanReview: true, previewOnly: true },
		passed_checks: [],
		blocked_reasons: ["No diff text or diffPath was provided for evaluation."],
		next_actions: ["Deep Check"],
		packetId,
		kind,
	};
}

async function readDiffFromPath(diffPath: string): Promise<string> {
	return readFile(diffPath, "utf-8");
}

type EditInput = {
	path?: string;
	edits?: Edit[];
	oldText?: string;
	newText?: string;
	content?: string;
};

function normalizeEdits(input: EditInput): { path: string; edits: Edit[] } | { error: string } {
	const path = typeof input.path === "string" ? input.path : "";
	if (!path) return { error: "edit/write input missing path" };

	let edits: Edit[] = [];
	if (Array.isArray(input.edits)) {
		edits = input.edits.filter((e): e is Edit => typeof e?.oldText === "string" && typeof e?.newText === "string");
	} else if (typeof input.oldText === "string" && typeof input.newText === "string") {
		edits = [{ oldText: input.oldText, newText: input.newText }];
	}
	return { path, edits };
}

async function previewDiffForEdit(input: EditInput, cwd: string): Promise<string | { error: string }> {
	const normalized = normalizeEdits(input);
	if ("error" in normalized) return normalized;
	const { path, edits } = normalized;
	if (edits.length === 0) return { error: "edit input has no edits" };

	try {
		const absolutePath = resolveToCwd(path, cwd);
		const raw = await readFile(absolutePath, "utf-8");
		const { text } = stripBom(raw);
		const base = normalizeToLF(text);
		const { newContent } = applyEditsToNormalizedContent(base, edits, path);
		return generateUnifiedPatch(path, base, newContent);
	} catch (err) {
		return { error: err instanceof Error ? err.message : String(err) };
	}
}

function previewDiffForWrite(input: EditInput): string | { error: string } {
	const path = typeof input.path === "string" ? input.path : "";
	const content = typeof input.content === "string" ? input.content : "";
	if (!path) return { error: "write input missing path" };
	const newContent = normalizeToLF(content);
	return generateUnifiedPatch(path, "", newContent);
}

async function evaluateDiff(options: {
	kind: string;
	diffText?: string;
	approvedWriteScope: string[];
	previewOnly: boolean;
	runIds?: string[];
	packetId?: string;
	adjudicationFixturePath?: string;
	dispatchRecordId?: string;
}): Promise<{ verdictCard: VerdictCard; receipt: VerificationReceipt & { wall_version: string } }> {
	const { client, fixture } = await resolveOaClientForEvaluation({
		previewOnly: options.previewOnly,
		runIds: options.runIds,
		adjudicationFixturePath: options.adjudicationFixturePath,
	});
	const wall_version = wallVersionFromFixture(fixture);
	const dispatchRecordId = options.dispatchRecordId ?? fixture?.dispatchRecordId ?? "correctness-wall-extension";
	const { verdictCard, receipt } = await evaluateCorrectnessWall({
		kind: options.kind,
		diffText: options.diffText,
		approvedWriteScope: options.approvedWriteScope,
		previewOnly: options.previewOnly,
		runIds: options.runIds,
		packetId: options.packetId,
		dispatchRecordId,
		client: client as AdaptOrchClient | undefined,
		receiptSigningSecret: receiptSigningSecret(),
	});
	return { verdictCard, receipt: { ...receipt, wall_version } };
}

function repairHintsForBlocked(card: VerdictCard, budget: number): string[] | undefined {
	if (card.verdict !== "BLOCKED") return undefined;
	const fromCard = card.repairHints;
	if (fromCard !== undefined && fromCard.length > 0) return capRepairHints(fromCard, budget);
	return undefined;
}

function formatEvaluateJson(
	verdictCard: VerdictCard,
	receipt: VerificationReceipt & { wall_version?: string },
	options?: { attemptCount?: number; policyFlags?: PolicyFlag[]; previewOnly?: boolean; diffPaths?: string[] },
): string {
	const budget = parseRepairBudget();
	const repairHints = repairHintsForBlocked(verdictCard, budget);
	const body: {
		verdictCard: VerdictCard;
		receipt: unknown;
		repairHints?: string[];
		regeneratePacket?: ReturnType<typeof buildRegeneratePacket>;
	} = {
		verdictCard,
		receipt,
	};
	if (repairHints !== undefined && repairHints.length > 0) {
		body.repairHints = repairHints;
	}
	if (options?.policyFlags !== undefined) {
		body.regeneratePacket = buildRegeneratePacket({
			userVerdict: verdictCard.verdict,
			policyFlags: options.policyFlags,
			previewOnly: options.previewOnly ?? true,
			diffPaths: options.diffPaths ?? [],
			attemptCount: options.attemptCount ?? 0,
			autoRegenerateEnabled: autoRegenerateEnabled(),
		});
	}
	return JSON.stringify(body, null, 2);
}

async function persistToolCallVerdict(
	ctx: ExtensionContext,
	mode: WallMode,
	verdictCard: VerdictCard,
	meta: { tool: "edit" | "write"; previewOnly: boolean; usedOaFixture: boolean; wall_version: string },
): Promise<void> {
	const wouldBlock = shouldBlock(verdictCard.verdict, mode);
	try {
		await writeVerdictCache(ctx.cwd, { mode, verdict: verdictCard.verdict, wouldBlock, verdictCard });
	} catch {
		// Cache write must not block tool execution.
	}
	if (mode !== "shadow") return;
	try {
		await appendShadowTelemetry(ctx.cwd, {
			event: "correctness_wall_shadow",
			wall_version: meta.wall_version,
			mode,
			verdict: verdictCard.verdict,
			wouldBlock,
			kind: verdictCard.kind,
			tool: meta.tool,
			previewOnly: meta.previewOnly,
			usedOaFixture: meta.usedOaFixture,
			timestamp: new Date().toISOString(),
		});
	} catch {
		// Telemetry must not block tool execution.
	}
}

function shadowBlockedNotifySuffix(card: VerdictCard, mode: WallMode, budget: number): string {
	if (mode !== "shadow" || card.verdict !== "BLOCKED") return "";
	const hints = repairHintsForBlocked(card, budget);
	if (hints === undefined || hints.length === 0) return "";
	return ` — repair hints: ${hints.join("; ")}`;
}

function repairBudgetLimitSuffix(attempts: number, budget: number): string {
	if (attempts < budget) return "";
	return ` — repair budget exhausted (${attempts}/${budget} blocked attempts; capped regenerate)`;
}

export default function (omk: ExtensionAPI) {
	// Auto-wire live adaptorch MCP transport when the host exposes `callMcpTool`.
	// Using the live client is still gated by OMK_WALL_OA_TRANSPORT=mcp (explicit opt-in);
	// when the capability is absent this is a no-op and fixture transport remains default.
	autoWireLiveAdaptOrch(omk);

	omk.registerTool({
		name: "correctness_wall_evaluate",
		label: "Correctness Wall",
		description:
			"Evaluate a patch against the B2C correctness wall (scope, policy flags, optional OA adjudication). Supply diffPath or use from edit/write gate context via preview.",
		parameters: CorrectnessWallParams,

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const kind = params.kind as string;
			const previewOnly = params.previewOnly !== false;
			const packetId = params.packetId as string | undefined;
			const runIds = params.runIds as string[] | undefined;
			const adjudicationFixturePath = params.adjudicationFixturePath as string | undefined;
			const approvedWriteScope = parseApprovedScope(params.approvedWriteScope as string[] | undefined);

			let diffText: string | undefined;
			if (typeof params.diffPath === "string" && params.diffPath.length > 0) {
				diffText = await readDiffFromPath(params.diffPath);
			} else {
				const card = inconclusiveCard(kind, packetId);
				const text = formatEvaluateJson(card, {
					schemaVersion: 1,
					evaluatedAt: new Date().toISOString(),
					kind,
					packetId,
					runIds: runIds ?? [],
					previewOnly,
					canApply: false,
					shouldSubmit: false,
					policyFlags: [],
					diffPaths: [],
					wall_version: CORRECTNESS_WALL_EXTENSION_VERSION,
				});
				return {
					content: [{ type: "text", text }],
					details: { verdict: card.verdict },
				};
			}

			const { verdictCard, receipt } = await evaluateDiff({
				kind,
				diffText,
				approvedWriteScope,
				previewOnly,
				runIds,
				packetId,
				adjudicationFixturePath,
			});

			return {
				content: [
					{
						type: "text",
						text: formatEvaluateJson(verdictCard, receipt, {
							policyFlags: receipt.policyFlags as PolicyFlag[],
							previewOnly,
							diffPaths: receipt.diffPaths,
						}),
					},
				],
				details: { verdict: verdictCard.verdict, wall_version: receipt.wall_version },
			};
		},
	});

	omk.on("tool_call", async (event, ctx: ExtensionContext) => {
		if (event.toolName !== "edit" && event.toolName !== "write") {
			return undefined;
		}

		const mode = parseWallMode();
		const kind = `${DEFAULT_KIND}.${event.toolName}`;
		const approvedWriteScope = parseApprovedScope();
		const runIds = parseRunIdsFromEnv();
		const adjudicationFixturePath = resolveAdjudicationFixturePath(undefined);
		const hookOaEnabled =
			runIds.length > 0 &&
			(adjudicationFixturePath !== undefined || (parseOaTransportModeFromEnv() === "mcp" && omk.isMcpToolBound()));
		let previewOnly = !hookOaEnabled;

		const input = event.input as EditInput;
		const preview =
			event.toolName === "write" ? previewDiffForWrite(input) : await previewDiffForEdit(input, ctx.cwd);

		if (typeof preview === "object" && "error" in preview) {
			const card: VerdictCard = {
				schemaVersion: 1,
				verdict: "INCONCLUSIVE",
				risk: "high",
				limits: { requiresHumanReview: true, previewOnly: true },
				passed_checks: [],
				blocked_reasons: [`Could not build diff preview: ${preview.error}`],
				next_actions: ["Deep Check"],
				kind,
			};
			const verdict = card.verdict;
			await persistToolCallVerdict(ctx, mode, card, {
				tool: event.toolName,
				previewOnly: true,
				usedOaFixture: false,
				wall_version: CORRECTNESS_WALL_EXTENSION_VERSION,
			});
			if (ctx.hasUI) {
				ctx.ui.notify(`Correctness wall (${mode}): ${verdict} — ${shortBlockReason(card)}`, "warning");
			}
			if (shouldBlock(verdict, mode)) {
				return { block: true, reason: shortBlockReason(card) };
			}
			return undefined;
		}

		const fixturelessLiveCall =
			hookOaEnabled && adjudicationFixturePath === undefined && parseOaTransportModeFromEnv() === "mcp";
		let evaluation: Awaited<ReturnType<typeof evaluateDiff>>;
		try {
			evaluation = await evaluateDiff({
				kind,
				diffText: preview,
				approvedWriteScope,
				previewOnly,
				runIds: hookOaEnabled ? runIds : undefined,
				adjudicationFixturePath: hookOaEnabled ? adjudicationFixturePath : undefined,
			});
		} catch (error) {
			if (!fixturelessLiveCall || !isUnboundMcpCall(error)) throw error;
			previewOnly = true;
			evaluation = await evaluateDiff({ kind, diffText: preview, approvedWriteScope, previewOnly: true });
		}
		if (
			fixturelessLiveCall &&
			evaluation.receipt.adjudicationReasonCode === "RUN_FETCH_FAILED" &&
			evaluation.verdictCard.blocked_reasons.some(isUnboundMcpCall)
		) {
			previewOnly = true;
			evaluation = await evaluateDiff({ kind, diffText: preview, approvedWriteScope, previewOnly: true });
		}
		const { verdictCard, receipt } = evaluation;

		await persistToolCallVerdict(ctx, mode, verdictCard, {
			tool: event.toolName,
			previewOnly,
			usedOaFixture: adjudicationFixturePath !== undefined,
			wall_version: receipt.wall_version,
		});

		const repairBudget = parseRepairBudget();
		let repairLimitSuffix = "";
		if (verdictCard.verdict === "BLOCKED") {
			const packetKey = repairPacketKey({
				kind,
				scopeKey: scopeKeyFromApprovedWriteScope(approvedWriteScope),
			});
			try {
				const state = await recordBlockedRepairAttempt(ctx.cwd, packetKey, verdictCard.verdict);
				if (!shouldOfferRepair(verdictCard.verdict, state.attempts, repairBudget)) {
					repairLimitSuffix = repairBudgetLimitSuffix(state.attempts, repairBudget);
				}
			} catch {
				// Repair state must not block tool execution.
			}
		}

		const summary = `Correctness wall (${mode}): ${verdictCard.verdict}`;
		const detail =
			verdictCard.blocked_reasons[0] ??
			verdictCard.passed_checks[0] ??
			(previewOnly ? "preview-only evaluation" : "");

		if (ctx.hasUI) {
			const level =
				verdictCard.verdict === "BLOCKED" ? "error" : verdictCard.verdict === "INCONCLUSIVE" ? "warning" : "info";
			ctx.ui.notify(
				`${summary}${detail ? ` — ${detail}` : ""}${shadowBlockedNotifySuffix(verdictCard, mode, repairBudget)}${repairLimitSuffix}`,
				level,
			);
		}

		if (shouldBlock(verdictCard.verdict, mode)) {
			return { block: true, reason: shortBlockReason(verdictCard) };
		}

		return undefined;
	});
}
