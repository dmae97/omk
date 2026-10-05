import { type Component, Container } from "./tui.ts";

type CacheNode = Component & {
	releaseRenderCache?: () => void;
	cachedLines?: string[];
	cachedText?: string;
	cachedWidth?: number;
	cache?: unknown;
	streamCache?: unknown;
	children?: Component[];
};

type SettledNode = Component & {
	isRenderSettled?: () => boolean;
	getRenderGeneration?: () => number;
};

/**
 * Duck-typed release of render caches for frozen (off-screen) components.
 * Prefer an explicit `releaseRenderCache()` hook when present (so #65 Markdown
 * can clear `streamCache` in one method). Otherwise clear known cache fields,
 * including `streamCache` if a future Markdown lands it without a hook yet.
 */
export function releaseRenderCache(component: Component): void {
	const node = component as CacheNode;
	if (typeof node.releaseRenderCache === "function") {
		node.releaseRenderCache();
		return;
	}
	if ("cachedLines" in node) {
		node.cachedLines = undefined;
		node.cachedText = undefined;
		node.cachedWidth = undefined;
	}
	if ("cache" in node) {
		node.cache = undefined;
	}
	if ("streamCache" in node) {
		node.streamCache = undefined;
	}
	if (Array.isArray(node.children)) {
		for (const child of node.children) {
			releaseRenderCache(child);
		}
	}
}

/**
 * Optional duck-typed settle hook. Missing hook ⇒ treated as settled (plain
 * Text/Box/Spacer keep today's freeze behavior). Message components will wire
 * this via the shared settled predicate (spec 026) in a follow-up.
 */
export function isRenderSettled(component: Component): boolean {
	const node = component as SettledNode;
	if (typeof node.isRenderSettled === "function") {
		return node.isRenderSettled();
	}
	return true;
}

function renderGeneration(component: Component): number {
	const node = component as SettledNode;
	if (typeof node.getRenderGeneration === "function") {
		return node.getRenderGeneration();
	}
	return 0;
}

/**
 * Container that freezes a leading prefix of settled children into a line buffer
 * once the live tail exceeds a line budget. Freezing stops at the first
 * unsettled child. Frozen children are not re-rendered and have their render
 * caches released. Width changes, invalidate(), an unsettled frozen child, or a
 * generation bump on a frozen child thaw the prefix.
 */
export class WindowedContainer extends Container {
	private frozenLines: string[] = [];
	private frozenChildCount = 0;
	private frozenWidth = -1;
	private frozenGenerations: number[] = [];
	private liveLineBudget = 120;

	/** Rows of still-rendered (unfrozen) content to keep at the tail. */
	setLiveLineBudget(lines: number): void {
		this.liveLineBudget = Math.max(1, Math.floor(lines));
	}

	getLiveLineBudget(): number {
		return this.liveLineBudget;
	}

	/** How many leading children are currently represented only by frozenLines. */
	getFrozenChildCount(): number {
		return this.frozenChildCount;
	}

	getFrozenLineCount(): number {
		return this.frozenLines.length;
	}

	override removeChild(component: Component): void {
		const index = this.children.indexOf(component);
		if (index !== -1 && index < this.frozenChildCount) {
			this.thaw();
		}
		super.removeChild(component);
	}

	override clear(): void {
		this.thaw();
		super.clear();
	}

	override invalidate(): void {
		this.thaw();
		super.invalidate();
	}

	/** Drop the frozen prefix and keep all children live. */
	thaw(): void {
		this.frozenLines = [];
		this.frozenChildCount = 0;
		this.frozenWidth = -1;
		this.frozenGenerations = [];
	}

	/** Thaw when a frozen child is no longer settled or its generation moved. */
	private thawIfFrozenStale(): void {
		for (let i = 0; i < this.frozenChildCount; i++) {
			const child = this.children[i];
			if (!isRenderSettled(child) || renderGeneration(child) !== this.frozenGenerations[i]) {
				this.thaw();
				return;
			}
		}
	}

	override render(width: number): string[] {
		if (width !== this.frozenWidth && this.frozenChildCount > 0) {
			this.thaw();
		} else if (this.frozenChildCount > 0) {
			this.thawIfFrozenStale();
		}

		const live: string[] = [];
		const childLineCounts: number[] = [];
		for (let i = this.frozenChildCount; i < this.children.length; i++) {
			const childLines = this.children[i].render(width);
			childLineCounts.push(childLines.length);
			for (const line of childLines) {
				live.push(line);
			}
		}

		while (
			this.frozenChildCount < this.children.length - 1 &&
			live.length > this.liveLineBudget &&
			childLineCounts.length > 0
		) {
			const child = this.children[this.frozenChildCount];
			// Never freeze past (or including) an unsettled child — pending tools /
			// streaming assistants must stay live until they settle.
			if (!isRenderSettled(child)) {
				break;
			}
			const count = childLineCounts[0];
			if (live.length - count < 1) break;
			const peeled = live.splice(0, count);
			for (const line of peeled) {
				this.frozenLines.push(line);
			}
			childLineCounts.shift();
			this.frozenGenerations.push(renderGeneration(child));
			releaseRenderCache(child);
			this.frozenChildCount += 1;
		}

		this.frozenWidth = width;
		if (this.frozenLines.length === 0) {
			return live;
		}
		return this.frozenLines.concat(live);
	}
}
