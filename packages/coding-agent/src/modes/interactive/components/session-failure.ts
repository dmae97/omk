import { stripVTControlCharacters } from "node:util";
import { Container, Text } from "omk-tui";
import { redactSensitiveTextForced } from "../../../core/redaction.ts";
import type { SessionTermination, SessionTerminationKind } from "../../../core/session-termination-types.ts";
import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyHint } from "./keybinding-hints.ts";

const TITLES = {
	completed: "Run completed",
	user_abort: "Request stopped",
	provider_abort: "Provider stopped the request",
	provider_auth: "Provider authentication failed",
	provider_rate_limit: "Provider rate limit",
	provider_network: "Provider connection failed",
	provider_protocol: "Invalid provider response",
	provider_refusal: "Provider declined the request",
	context_overflow: "Context limit reached",
	transcript_invalid: "Session transcript needs repair",
	tool_timeout: "Tool timed out",
	tool_fatal: "Tool execution failed",
	compaction: "Compaction did not finish",
	persistence: "Session storage failed",
	process_signal: "Process interrupted",
	process_crash: "Previous process did not finish",
	configuration: "Configuration needs attention",
	internal_error: "Request failed",
	resource_pressure: "Resource limit reached",
	budget_exhausted: "Run budget exhausted",
} satisfies Record<SessionTerminationKind, string>;

/** Local display is credential-masked and terminal-inert; it is never the shareable report. */
export function diagnosticDisplayText(text: string): string {
	return redactSensitiveTextForced(stripVTControlCharacters(text))
		.replace(/\p{Cc}|[\u202a-\u202e\u2066-\u2069]/gu, " ")
		.slice(0, 2048);
}

export class SessionFailureComponent extends Container {
	private readonly termination: SessionTermination;
	private expanded: boolean;

	constructor(termination: SessionTermination, expanded = false) {
		super();
		this.termination = termination;
		this.expanded = expanded;
		this.rebuild();
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.rebuild();
	}

	override invalidate(): void {
		super.invalidate();
		this.rebuild();
	}

	private rebuild(): void {
		this.clear();
		const t = this.termination;
		const color = t.kind === "user_abort" || t.kind === "process_signal" ? "warning" : "error";
		this.addChild(new DynamicBorder((s) => theme.fg(color, s)));
		this.addChild(new Text(theme.fg(color, theme.bold(TITLES[t.kind])), 1, 0));
		this.addChild(new Text(`Cause: ${diagnosticDisplayText(t.message)}`, 1, 0));
		const impact =
			t.sideEffects === "none"
				? "No side effects reported."
				: t.sideEffects === "possible"
					? "Effects are possible; inspect the workspace before repeating work."
					: "Effects were recorded; verify them before repeating work.";
		this.addChild(new Text(`Impact: ${impact}`, 1, 0));
		this.addChild(new Text(`Next: ${diagnosticDisplayText(t.nextAction)}`, 1, 0));
		if (this.expanded) {
			this.addChild(
				new Text(
					theme.fg(
						"muted",
						[
							`Kind: ${t.kind} · Phase: ${t.phase} · Cause code: ${t.causeCode}`,
							`Source: ${t.source} · Effects: ${t.sideEffects}`,
							`Retryable: ${t.retryable ? "yes" : "no"} · Automatic retry: ${t.safeToAutoRetry ? "yes" : "no"}`,
							`Run: ${t.runId} · At: ${t.timestamp}`,
							`Provider/model: ${t.provider ?? "unknown"}/${t.model ?? "unknown"}`,
						]
							.map(diagnosticDisplayText)
							.join("\n"),
					),
					1,
					0,
				),
			);
		}
		this.addChild(
			new Text(theme.fg("dim", `${keyHint("app.tools.expand", "details")} · /debug for diagnostics`), 1, 0),
		);
		this.addChild(new DynamicBorder((s) => theme.fg(color, s)));
	}
}
