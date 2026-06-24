import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import type {
	FreedomdAdapter,
	GuardrailAuditEvent,
	GuardrailDecision,
	GuardrailPolicy,
	GuardrailRule,
} from "../types/guardrails.ts";
import { appendAuditEvent } from "./audit-logger.ts";

function getCurrentDir(): string {
	try {
		return dirname(fileURLToPath(import.meta.url));
	} catch {
		return __dirname;
	}
}

const DEFAULT_POLICY_PATH = join(getCurrentDir(), "policy.yaml");

export class UnifiedFreedomdAdapter implements FreedomdAdapter {
	private policy: GuardrailPolicy;
	private goalId?: string;
	private auditPath?: string;

	constructor(options?: { policyPath?: string; goalId?: string; auditPath?: string }) {
		const path = options?.policyPath ?? DEFAULT_POLICY_PATH;
		const raw = readFileSync(path, "utf-8");
		this.policy = YAML.parse(raw) as GuardrailPolicy;
		this.goalId = options?.goalId;
		this.auditPath = options?.auditPath;
	}

	async evaluate(toolName: string, toolInput: unknown): Promise<GuardrailDecision> {
		const inputText = this.sanitizeInput(toolInput);

		for (const rule of this.policy.rules) {
			if (!rule.enabled) continue;
			if (rule.toolName && rule.toolName !== toolName) continue;
			if (rule.pattern && !new RegExp(rule.pattern, "i").test(inputText)) continue;

			const decision: GuardrailDecision = {
				allowed: false,
				rule,
				reason: `Blocked by rule "${rule.id}": ${rule.description}`,
				suggestion: this.suggestAlternative(rule),
			};
			await this.log(toolName, inputText, decision);
			return decision;
		}

		const allow: GuardrailDecision = { allowed: true };
		await this.log(toolName, inputText, allow);
		return allow;
	}

	private sanitizeInput(input: unknown): string {
		if (input === null || input === undefined) return "";
		if (typeof input === "string") return input;
		try {
			return JSON.stringify(input);
		} catch {
			return String(input);
		}
	}

	private suggestAlternative(rule: GuardrailRule): string | undefined {
		switch (rule.category) {
			case "network":
				return "Use context-mode_ctx_fetch_and_index or context-mode_ctx_execute instead of shell networking.";
			case "destructive":
				return "Use targeted rm of specific files or confirm destructive operations interactively.";
			case "privilege_escalation":
				return "Run the command without sudo or use a dedicated privileged lane grant.";
			case "secret_exposure":
				return "Avoid reading secret files; use environment-variable references with $ prefix.";
			default:
				return undefined;
		}
	}

	private async log(toolName: string, toolInput: string, decision: GuardrailDecision): Promise<void> {
		if (!this.auditPath) return;
		const event: GuardrailAuditEvent = {
			timestamp: new Date().toISOString(),
			goalId: this.goalId,
			toolName,
			toolInput,
			decision,
		};
		await appendAuditEvent(this.auditPath, event);
	}
}
