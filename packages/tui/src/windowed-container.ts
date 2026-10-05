import { type Component, Container } from "./tui.ts";

/**
 * Duck-typed release of render caches for frozen (off-screen) components.
 * Avoids importing every component class so sibling PRs can keep editing them.
 */
export function releaseRenderCache(component: Component): void {
	const node = component as Component & {
		releaseRenderCache?: () => void;
		cachedLines?: string[];
		cachedText?: string;
		cachedWidth?: number;
		cache?: unknown;
		children?: Component[];
	};
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
	if (Array.isArray(node.children)) {
		for (const child of node.children) {
			releaseRenderCache(child);
		}
	}
}

/**
 * Container that freezes a leading prefix of children into a line buffer once
 * the live tail exceeds a line budget. Frozen children are not re-rendered and
 * have their render caches released. Width changes and invalidate() thaw.
 */
export class WindowedContainer extends Container {
	private frozenLines: string[] = [];
	private frozenChildCount = 0;
	private frozenWidth = -1;
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
	}

	override render(width: number): string[] {
		if (width !== this.frozenWidth && this.frozenChildCount > 0) {
			this.thaw();
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
			const count = childLineCounts[0];
			if (live.length - count < 1) break;
			const peeled = live.splice(0, count);
			for (const line of peeled) {
				this.frozenLines.push(line);
			}
			childLineCounts.shift();
			releaseRenderCache(this.children[this.frozenChildCount]);
			this.frozenChildCount += 1;
		}

		this.frozenWidth = width;
		if (this.frozenLines.length === 0) {
			return live;
		}
		return this.frozenLines.concat(live);
	}
}
