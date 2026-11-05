import { VerifiedRunError } from "../../../core/verified-run/storage.ts";
import { type RunGraphSnapshot, readRunGraph } from "../../../core/verified-run/workbench-run-graph.ts";
import {
	buildRNodeViewModel,
	EMPTY_RNODE_FEED,
	feedCell,
	markUnreadable,
	type RNodeFeedState,
	reduceRunGraph,
} from "./rnode-model.ts";
import type { RNodePanelInput } from "./rnode-panel.ts";

export interface RNodeTarget {
	readonly runId: string;
	readonly stateRoot: string;
}

export interface RNodeControllerOptions {
	/** Called after a refresh changes what the panel would show. */
	readonly changed: () => void;
	readonly read?: (stateRoot: string, runId: string) => RunGraphSnapshot;
	readonly intervalMs?: number;
}

interface Binding {
	readonly target: RNodeTarget;
	feed: RNodeFeedState;
	failure: string | undefined;
	timer: ReturnType<typeof setInterval>;
}

export const RNODE_POLL_MS = 2000;

/** VerifiedRunError codes and errno codes only: raw messages can carry local paths. */
function failureCode(error: unknown): string {
	if (error instanceof VerifiedRunError) return error.code;
	const code = (error as { code?: unknown } | null)?.code;
	return typeof code === "string" ? code : "read_failed";
}

/**
 * Owns the one explicit run binding of an interactive session. It only reads snapshots through
 * `readRunGraph`; it never dispatches, retries or writes the journal. Polling runs only while bound.
 */
export class RNodeController {
	private binding: Binding | undefined;
	private readonly changed: () => void;
	private readonly read: (stateRoot: string, runId: string) => RunGraphSnapshot;
	private readonly intervalMs: number;

	constructor(options: RNodeControllerOptions) {
		this.changed = options.changed;
		this.read = options.read ?? readRunGraph;
		this.intervalMs = options.intervalMs ?? RNODE_POLL_MS;
	}

	get target(): RNodeTarget | undefined {
		return this.binding?.target;
	}

	/** Replaces any previous binding, reads once immediately, then polls. */
	bind(target: RNodeTarget): void {
		this.clear();
		const timer = setInterval(() => this.refresh(), this.intervalMs);
		timer.unref?.();
		this.binding = { target, feed: EMPTY_RNODE_FEED, failure: undefined, timer };
		this.refresh();
	}

	clear(): void {
		if (this.binding === undefined) return;
		clearInterval(this.binding.timer);
		this.binding = undefined;
		this.changed();
	}

	dispose(): void {
		if (this.binding !== undefined) clearInterval(this.binding.timer);
		this.binding = undefined;
	}

	/** Returns true when the panel input changed. Safe to call repeatedly. */
	refresh(): boolean {
		const binding = this.binding;
		if (binding === undefined) return false;
		const before = binding.feed;
		const failureBefore = binding.failure;
		try {
			binding.feed = reduceRunGraph(before, this.read(binding.target.stateRoot, binding.target.runId));
			binding.failure = undefined;
		} catch (error) {
			binding.feed = markUnreadable(before);
			binding.failure = failureCode(error);
		}
		const changed =
			binding.feed.current !== before.current ||
			binding.feed.last !== before.last ||
			binding.failure !== failureBefore;
		if (changed) this.changed();
		return changed;
	}

	/** Last read failure code, if the most recent read failed. */
	get failure(): string | undefined {
		return this.binding?.failure;
	}

	panelInput(): RNodePanelInput {
		const binding = this.binding;
		if (binding === undefined) return undefined;
		return buildRNodeViewModel(binding.feed) ?? { runId: binding.target.runId, feed: feedCell(binding.feed.last) };
	}
}
