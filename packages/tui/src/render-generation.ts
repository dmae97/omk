/**
 * Structural stand-in for tui.ts `Component` (importing it, even as a type,
 * would put this module in an import cycle with tui.ts).
 */
interface Component {
	render(width: number): string[];
}

/**
 * Process-wide render generation counter.
 *
 * Mutable TUI primitives stamp `nextRenderGeneration()` on every visible
 * change, and containers report the max stamp of themselves and their
 * children. Because stamps only ever increase, any change anywhere in a
 * subtree strictly raises that subtree's generation — removing a child, then
 * adding another, can never land back on a previously observed value. Off-
 * screen windowing compares these numbers instead of object identity.
 */
let renderGenerationCounter = 0;

export function nextRenderGeneration(): number {
	renderGenerationCounter += 1;
	return renderGenerationCounter;
}

type LifecycleNode = Component & {
	isRenderSettled?: () => boolean;
	getRenderGeneration?: () => number;
};

/** Missing hook ⇒ settled (plain components keep freeze-eligible behavior). */
export function isRenderSettled(component: Component): boolean {
	const node = component as LifecycleNode;
	return typeof node.isRenderSettled === "function" ? node.isRenderSettled() : true;
}

/** Missing hook ⇒ 0 (component is treated as immutable once rendered). */
export function renderGeneration(component: Component): number {
	const node = component as LifecycleNode;
	return typeof node.getRenderGeneration === "function" ? node.getRenderGeneration() : 0;
}

/** Max generation over `own` and every child (children without hooks count as 0). */
export function maxChildGeneration(own: number, children: readonly Component[]): number {
	let max = own;
	for (const child of children) {
		const generation = renderGeneration(child);
		if (generation > max) max = generation;
	}
	return max;
}

type CacheNode = Component & { releaseRenderCache?: () => void };

/**
 * Drop render caches of a frozen (off-screen) component without changing its
 * render generation. Opt-in only: a component releases exactly what its own
 * `releaseRenderCache()` drops (Container and Box forward to their children).
 * Components without the hook are left untouched; fields are never cleared by
 * name, because a third-party field called `cache` may not be a render cache.
 */
export function releaseRenderCache(component: Component): void {
	const node = component as CacheNode;
	if (typeof node.releaseRenderCache === "function") node.releaseRenderCache();
}
