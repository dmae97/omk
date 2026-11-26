import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionContext, ExtensionFactory } from "../types.ts";

const execFileAsync = promisify(execFile);

export type MetacogPhase = "planning" | "monitoring" | "evaluating" | "reflecting";

export interface ResponseMetacogSignals {
	readonly unreinforcedClaims: number;
	readonly hasMeasuredCue: boolean;
	readonly hasUnknownsCue: boolean;
	readonly flags: readonly string[];
}

export interface MetacogRuntimeState {
	readonly phase: MetacogPhase;
	readonly strict: boolean;
	readonly confidence: number;
	readonly consecutiveToolErrors: number;
	readonly totalToolErrors: number;
	readonly unreinforcedClaimsTotal: number;
	readonly turnsAssessed: number;
	readonly unknowns: readonly string[];
}

export type MetacogEventAction =
	| { readonly type: "reset" }
	| { readonly type: "toggle_strict" }
	| { readonly type: "add_unknown"; readonly text: string }
	| { readonly type: "tool_result"; readonly toolName: string; readonly isError: boolean }
	| { readonly type: "turn_assessed"; readonly signals: ResponseMetacogSignals }
	| { readonly type: "compacted" };

export const INITIAL_METACOG_STATE: MetacogRuntimeState = Object.freeze({
	phase: "planning",
	strict: false,
	confidence: 0.85,
	consecutiveToolErrors: 0,
	totalToolErrors: 0,
	unreinforcedClaimsTotal: 0,
	turnsAssessed: 0,
	unknowns: [],
});

const ABSOLUTE_CLAIM_RE = /\b(always|guaranteed|never fails|100%)\b|반드시|항상|확실히|절대/gi;
const NUMERIC_CLAIM_RE = /\d+(?:\.\d+)?\s*(?:%|percent|퍼센트|pp|배)(?!\w)/gi;
const MEASURED_CUE_RE = /n\s*=|표본|seed|측정|measured|실측|exit\s+0|passed|통과/i;
const UNKNOWNS_CUE_RE = /unknown|미검증|미확인|한계|risk|가정|assumption/i;

function clamp(v: number, lo: number, hi: number): number {
	return Number(Math.max(lo, Math.min(hi, v)).toFixed(4));
}

export function scanResponseMetacogSignals(text: string): ResponseMetacogSignals {
	const raw = String(text ?? "");
	const absMatches = raw.match(ABSOLUTE_CLAIM_RE) ?? [];
	const numMatches = raw.match(NUMERIC_CLAIM_RE) ?? [];
	const hasMeasuredCue = MEASURED_CUE_RE.test(raw);
	const hasUnknownsCue = UNKNOWNS_CUE_RE.test(raw);
	const flags: string[] = [];
	let unreinforcedClaims = 0;

	if (absMatches.length > 0 && !hasUnknownsCue) {
		unreinforcedClaims += absMatches.length;
		flags.push(`overconfidence(${absMatches.length})`);
	}
	if (numMatches.length > 0 && !hasMeasuredCue) {
		unreinforcedClaims += numMatches.length;
		flags.push(`uncited-numbers(${numMatches.length})`);
	}
	return { unreinforcedClaims, hasMeasuredCue, hasUnknownsCue, flags };
}

export function reduceMetacogEvent(state: MetacogRuntimeState, action: MetacogEventAction): MetacogRuntimeState {
	switch (action.type) {
		case "reset":
			return { ...INITIAL_METACOG_STATE, strict: state.strict };
		case "toggle_strict":
			return { ...state, strict: !state.strict };
		case "add_unknown": {
			const clean = action.text.trim().slice(0, 160);
			if (!clean || state.unknowns.includes(clean)) return state;
			return { ...state, unknowns: [...state.unknowns.slice(-11), clean] };
		}
		case "tool_result": {
			if (!action.isError) {
				return {
					...state,
					phase: "monitoring",
					consecutiveToolErrors: 0,
					confidence: clamp(state.confidence + 0.02, 0.15, 0.98),
				};
			}
			const nextErr = state.consecutiveToolErrors + 1;
			const note = `${action.toolName} failed (${nextErr}x)`;
			const unknowns = state.unknowns.includes(note) ? state.unknowns : [...state.unknowns.slice(-11), note];
			return {
				...state,
				phase: nextErr >= 2 ? "reflecting" : "monitoring",
				consecutiveToolErrors: nextErr,
				totalToolErrors: state.totalToolErrors + 1,
				confidence: clamp(state.confidence * Math.exp(-0.12), 0.15, 0.98),
				unknowns,
			};
		}
		case "turn_assessed": {
			const decay = Math.exp(-0.15 * action.signals.unreinforcedClaims);
			const boost = action.signals.hasMeasuredCue && action.signals.unreinforcedClaims === 0 ? 0.03 : 0;
			return {
				...state,
				phase: "evaluating",
				turnsAssessed: state.turnsAssessed + 1,
				unreinforcedClaimsTotal: state.unreinforcedClaimsTotal + action.signals.unreinforcedClaims,
				confidence: clamp(state.confidence * decay + boost, 0.15, 0.98),
			};
		}
		case "compacted":
			return {
				...state,
				phase: "planning",
				consecutiveToolErrors: 0,
			};
	}
}

export function buildMetacogPromptAdvisory(state: MetacogRuntimeState): string | undefined {
	if (state.consecutiveToolErrors < 2 && !state.strict) return undefined;
	const lines = [
		"## Metacog Monitor (Schoenfeld Control · Built-in)",
		`- State: phase=${state.phase}, calibratedConfidence=${state.confidence.toFixed(2)}, consecutive tool failures=${state.consecutiveToolErrors}.`,
	];
	if (state.consecutiveToolErrors >= 2) {
		lines.push(
			"- Strategy switch required: stop repeating the failing premise, state the assumption being tested, and verify one minimal toggle.",
		);
	}
	if (state.unknowns.length > 0) {
		lines.push(`- Tracked unknowns: ${state.unknowns.slice(-3).join("; ")}.`);
	}
	return lines.join("\n");
}

function readAssistantText(message: unknown): string {
	const msg = message as { role?: string; content?: unknown } | undefined;
	if (msg?.role !== "assistant" || !Array.isArray(msg.content)) return "";
	return msg.content
		.filter((b): b is { type: "text"; text: string } => b?.type === "text" && typeof b.text === "string")
		.map((b) => b.text)
		.join("\n");
}

function resolveAuditScript(): string | undefined {
	const agentDir = process.env.OMK_CODING_AGENT_DIR || join(homedir(), ".omk", "agent");
	const candidate = join(agentDir, "skills", "omk-metacog", "scripts", "audit.py");
	return existsSync(candidate) ? candidate : undefined;
}

export function createMetacogExtension(): ExtensionFactory {
	return (omk: ExtensionAPI) => {
		let state: MetacogRuntimeState = INITIAL_METACOG_STATE;

		const syncStatus = (ctx?: ExtensionContext) => {
			if (!ctx?.hasUI) return;
			const label = state.strict
				? `metacog:strict(${Math.round(state.confidence * 100)}%)`
				: state.consecutiveToolErrors >= 2
					? `metacog:switch(${state.consecutiveToolErrors}err)`
					: undefined;
			ctx.ui.setStatus(
				"metacog",
				label ? ctx.ui.theme.fg(state.consecutiveToolErrors >= 2 ? "warning" : "muted", label) : undefined,
			);
		};

		omk.registerCommand("metacog", {
			description: "Built-in OMK Metacognition (status | audit <path> | strict | unknown <note> | reset)",
			handler: async (args, ctx) => {
				const raw = String(args ?? "").trim();
				const [sub = "status", ...rest] = raw.split(/\s+/);
				const arg = rest.join(" ").trim();
				if (sub === "strict") {
					state = reduceMetacogEvent(state, { type: "toggle_strict" });
					syncStatus(ctx);
					ctx.ui.notify(
						`Metacog strict mode ${state.strict ? "ON" : "OFF"} (conf=${state.confidence.toFixed(2)})`,
						"info",
					);
					return;
				}
				if (sub === "reset") {
					state = reduceMetacogEvent(state, { type: "reset" });
					syncStatus(ctx);
					ctx.ui.notify("Metacog runtime state reset.", "info");
					return;
				}
				if (sub === "unknown" && arg) {
					state = reduceMetacogEvent(state, { type: "add_unknown", text: arg });
					ctx.ui.notify(`Metacog unknown recorded (${state.unknowns.length} total): ${arg}`, "info");
					return;
				}
				if (sub === "audit" && arg) {
					const script = resolveAuditScript();
					if (!script) {
						ctx.ui.notify("omk-metacog audit.py not found.", "warning");
						return;
					}
					const target = resolve(ctx.cwd, arg);
					if (!existsSync(target)) {
						ctx.ui.notify(`Target not found: ${target}`, "warning");
						return;
					}
					try {
						const { stdout } = await execFileAsync("python3", [script, target, "--format", "json"], {
							timeout: 15_000,
						});
						const rep = JSON.parse(stdout);
						const cal = rep.calibration?.calibratedConfidence ?? "n/a";
						ctx.ui.notify(
							`Metacog audit [${rep.verdict}] overall=${rep.overall} calConf=${cal} findings=${rep.findings?.length ?? 0} unknowns=${rep.unknowns?.length ?? 0}`,
							rep.verdict === "hold" ? "warning" : "info",
						);
					} catch (err) {
						ctx.ui.notify(`Metacog audit failed: ${err instanceof Error ? err.message : String(err)}`, "warning");
					}
					return;
				}
				ctx.ui.notify(
					`Metacog phase=${state.phase} strict=${state.strict ? "ON" : "OFF"} conf=${state.confidence.toFixed(2)} errs=${state.consecutiveToolErrors}/${state.totalToolErrors} unreinforced=${state.unreinforcedClaimsTotal} unknowns=${state.unknowns.length}`,
					"info",
				);
			},
		});

		omk.on("session_start", (_event, ctx) => {
			state = INITIAL_METACOG_STATE;
			syncStatus(ctx);
		});

		omk.on("before_agent_start", (event) => {
			if (typeof event?.systemPrompt !== "string") return undefined;
			const advisory = buildMetacogPromptAdvisory(state);
			if (!advisory) return undefined;
			return { systemPrompt: `${event.systemPrompt}\n\n${advisory}` };
		});

		omk.on("tool_execution_end", (event, ctx) => {
			state = reduceMetacogEvent(state, {
				type: "tool_result",
				toolName: String(event?.toolName ?? "tool"),
				isError: Boolean(event?.isError),
			});
			syncStatus(ctx);
		});

		omk.on("turn_end", (event, ctx) => {
			const text = readAssistantText(event?.message);
			if (!text) return;
			const signals = scanResponseMetacogSignals(text);
			state = reduceMetacogEvent(state, { type: "turn_assessed", signals });
			syncStatus(ctx);
		});

		omk.on("session_compact", (_event, ctx) => {
			state = reduceMetacogEvent(state, { type: "compacted" });
			syncStatus(ctx);
		});
	};
}
