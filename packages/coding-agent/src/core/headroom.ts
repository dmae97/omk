// OMK v6.2 — Headroom Manager (TypeScript)
// ==================================================================
// packages/coding-agent/src/core/headroom.ts
//
// STATUS: compatibility utility.
// This file is preserved for legacy extension/API consumers and regression tests.
//
// ACTUAL HEADROOM / TOKEN BUDGET SYSTEM:
//   - types/jailbreak.ts → defines HeadroomSnapshot, HeadroomPrediction (different shape)
//   - context-budget-compressors.ts → context budget compression with adapters
//   - context-budget-token-counter.ts → token counting for budget decisions
//   - compaction/compaction.ts getCompactionHeadroomThreshold() → headroom threshold
//   - compaction/compaction.ts shouldCompact() → triggers compaction when headroom low
//
// NOTE: types/jailbreak.ts defines similar types (HeadroomSnapshot, HeadroomPrediction)
// but with different field structures. Both are distinct from this file's types.
//
// Keep this utility deterministic and aligned with the active context budget policy.

import { EventEmitter } from "events";

export interface HeadroomSnapshot {
	timestamp: number;
	promptTokens: number;
	toolOutputTokens: number;
	responseTokens: number;
	totalTokens: number;
	headroomRemaining: number;
	status: "idle" | "active" | "stressed" | "critical" | "blocked";
}

export interface HeadroomPrediction {
	predictedTokens: number;
	confidence: number;
	trend: "increasing" | "stable" | "decreasing";
	recommendedAction: string;
}

export class HeadroomMonitor extends EventEmitter {
	private history: HeadroomSnapshot[] = [];
	private maxHistory = 100;

	record(snapshot: HeadroomSnapshot): void {
		this.history.push(snapshot);
		if (this.history.length > this.maxHistory) {
			this.history = this.history.slice(-this.maxHistory);
		}
		this.emit("snapshot", snapshot);
	}

	predict(): HeadroomPrediction {
		if (this.history.length < 3) {
			return { predictedTokens: 0, confidence: 0, trend: "stable", recommendedAction: "collect more data" };
		}

		const recent = this.history.slice(-10);
		const first = recent[0].totalTokens;
		const last = recent[recent.length - 1].totalTokens;
		const delta = last - first;
		const slope = delta / Math.max(recent.length - 1, 1);
		const trend = Math.abs(delta) <= Math.max(1, last * 0.02) ? "stable" : delta > 0 ? "increasing" : "decreasing";
		const projectedTokens = trend === "increasing" ? last + Math.max(1, slope) : Math.max(0, last + slope);
		const confidence = Math.min(0.95, 0.45 + recent.length * 0.05);

		return {
			predictedTokens: Math.round(projectedTokens),
			confidence,
			trend,
			recommendedAction: trend === "increasing" ? "compress context" : "maintain",
		};
	}

	getStatus(totalTokens: number, maxTokens: number): HeadroomSnapshot["status"] {
		const ratio = totalTokens / maxTokens;
		let status: HeadroomSnapshot["status"];
		if (ratio < 0.4) {
			status = "idle";
		} else if (ratio < 0.7) {
			status = "active";
		} else if (ratio < 0.8) {
			status = "stressed";
		} else if (ratio < 0.9) {
			status = "critical";
		} else {
			status = "blocked";
		}

		const previous = this.history.at(-1)?.status;
		if (previous === "critical" && status === "stressed" && ratio >= 0.75) {
			return "critical";
		}
		if (previous === "blocked" && status !== "blocked" && ratio >= 0.85) {
			return "blocked";
		}
		return status;
	}
}

export class DynamicContextAllocator extends EventEmitter {
	private maxTokens: number;

	constructor(maxTokens = 15000) {
		super();
		this.maxTokens = maxTokens;
	}

	allocate(currentTokens: number): { maxTokens: number; canAddAgents: boolean } {
		const ratio = currentTokens / this.maxTokens;
		if (ratio < 0.4) return { maxTokens: this.maxTokens, canAddAgents: true };
		if (ratio < 0.7) return { maxTokens: this.maxTokens * 0.9, canAddAgents: true };
		if (ratio < 0.8) return { maxTokens: this.maxTokens * 0.75, canAddAgents: false };
		if (ratio < 0.9) return { maxTokens: this.maxTokens * 0.5, canAddAgents: false };
		return { maxTokens: 0, canAddAgents: false };
	}
}

export class HeadroomManager extends EventEmitter {
	private monitor: HeadroomMonitor;
	private allocator: DynamicContextAllocator;
	private maxTokens: number;

	constructor(maxTokens = 15000) {
		super();
		this.maxTokens = maxTokens;
		this.monitor = new HeadroomMonitor();
		this.allocator = new DynamicContextAllocator(maxTokens);
	}

	check(promptTokens: number, toolOutputTokens = 0, responseTokens = 0): HeadroomSnapshot {
		const totalTokens = promptTokens + toolOutputTokens + responseTokens;
		const status = this.monitor.getStatus(totalTokens, this.maxTokens);
		this.allocator.allocate(totalTokens);

		const snapshot: HeadroomSnapshot = {
			timestamp: Date.now(),
			promptTokens,
			toolOutputTokens,
			responseTokens,
			totalTokens,
			headroomRemaining: this.maxTokens - totalTokens,
			status,
		};

		this.monitor.record(snapshot);

		if (status === "critical" || status === "blocked") {
			this.emit("warning", { status, message: `Headroom ${status}: ${totalTokens}/${this.maxTokens} tokens` });
		}

		return snapshot;
	}

	predict(): HeadroomPrediction {
		return this.monitor.predict();
	}

	getAllocation(currentTokens: number): { maxTokens: number; canAddAgents: boolean } {
		return this.allocator.allocate(currentTokens);
	}
}

export default HeadroomManager;
