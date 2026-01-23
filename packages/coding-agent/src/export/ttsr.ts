/**
 * Time Traveling Stream Rules (TTSR) Manager
 *
 * Manages rules that get injected mid-stream when their trigger pattern matches
 * the agent's output. When a match occurs, the stream is aborted, the rule is
 * injected as a system reminder, and the request is retried.
 */

import { logger } from "@oh-my-pi/pi-utils";
import type { Rule } from "$c/capability/rule";
import type { TtsrSettings } from "$c/config/settings-manager";

interface TtsrEntry {
	rule: Rule;
	regex: RegExp;
}

/** Tracks when a rule was last injected (for repeat-after-gap mode) */
interface InjectionRecord {
	/** Message count when the rule was last injected */
	lastInjectedAt: number;
}

const DEFAULT_SETTINGS: Required<TtsrSettings> = {
	enabled: true,
	contextMode: "discard",
	repeatMode: "once",
	repeatGap: 10,
};

export class TtsrManager {
	private readonly settings: Required<TtsrSettings>;
	private readonly rules = new Map<string, TtsrEntry>();
	private readonly injectionRecords = new Map<string, InjectionRecord>();
	private buffer = "";
	private messageCount = 0;

	constructor(settings?: TtsrSettings) {
		this.settings = { ...DEFAULT_SETTINGS, ...settings };
	}

	/** Check if a rule can be triggered based on repeat settings */
	private canTrigger(ruleName: string): boolean {
		const record = this.injectionRecords.get(ruleName);
		if (!record) {
			return true;
		}

		if (this.settings.repeatMode === "once") {
			return false;
		}

		const gap = this.messageCount - record.lastInjectedAt;
		return gap >= this.settings.repeatGap;
	}

	/** Add a TTSR rule to be monitored */
	addRule(rule: Rule): void {
		if (!rule.ttsrTrigger) {
			return;
		}

		if (this.rules.has(rule.name)) {
			return;
		}

		try {
			const regex = new RegExp(rule.ttsrTrigger);
			this.rules.set(rule.name, { rule, regex });
			logger.debug("TTSR rule registered", {
				ruleName: rule.name,
				pattern: rule.ttsrTrigger,
			});
		} catch (err) {
			logger.warn("TTSR rule has invalid regex pattern, skipping", {
				ruleName: rule.name,
				pattern: rule.ttsrTrigger,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	/** Check if any uninjected TTSR matches the stream buffer. Returns matching rules. */
	check(streamBuffer: string): Rule[] {
		const matches: Rule[] = [];

		for (const [name, entry] of this.rules) {
			if (!this.canTrigger(name)) {
				continue;
			}

			if (entry.regex.test(streamBuffer)) {
				matches.push(entry.rule);
				logger.debug("TTSR pattern matched", {
					ruleName: name,
					pattern: entry.rule.ttsrTrigger,
				});
			}
		}

		return matches;
	}

	/** Mark rules as injected (won't trigger again until conditions allow) */
	markInjected(rulesToMark: Rule[]): void {
		for (const rule of rulesToMark) {
			this.injectionRecords.set(rule.name, { lastInjectedAt: this.messageCount });
			logger.debug("TTSR rule marked as injected", {
				ruleName: rule.name,
				messageCount: this.messageCount,
				repeatMode: this.settings.repeatMode,
			});
		}
	}

	/** Get names of all injected rules (for persistence) */
	getInjectedRuleNames(): string[] {
		return Array.from(this.injectionRecords.keys());
	}

	/** Restore injected state from a list of rule names */
	restoreInjected(ruleNames: string[]): void {
		for (const name of ruleNames) {
			this.injectionRecords.set(name, { lastInjectedAt: 0 });
		}
		if (ruleNames.length > 0) {
			logger.debug("TTSR injected state restored", { ruleNames });
		}
	}

	/** Reset stream buffer (called on new turn) */
	resetBuffer(): void {
		this.buffer = "";
	}

	/** Get current stream buffer */
	getBuffer(): string {
		return this.buffer;
	}

	/** Append to stream buffer */
	appendToBuffer(text: string): void {
		this.buffer += text;
	}

	/** Check if any TTSRs are registered */
	hasRules(): boolean {
		return this.rules.size > 0;
	}

	/** Increment message counter (call after each turn) */
	incrementMessageCount(): void {
		this.messageCount++;
	}

	/** Get current message count */
	getMessageCount(): number {
		return this.messageCount;
	}

	/** Get settings */
	getSettings(): Required<TtsrSettings> {
		return this.settings;
	}
}
