import { compareIds } from "./commit-types.ts";

/** Iterative Kosaraju traversal; graph identities have already passed input validation. */
export function stronglyConnected(
	nodes: readonly string[],
	adjacency: ReadonlyMap<string, readonly string[]>,
): string[][] {
	const seen = new Set<string>();
	const order: string[] = [];
	const reverse = new Map(nodes.map((id) => [id, [] as string[]]));
	for (const id of nodes)
		for (const target of adjacency.get(id) ?? []) {
			const bucket = reverse.get(target);
			if (!bucket) throw new Error("Unknown commit graph node");
			bucket.push(id);
		}
	for (const root of [...nodes].sort(compareIds)) {
		if (seen.has(root)) continue;
		const stack = [{ id: root, cursor: 0 }];
		seen.add(root);
		while (stack.length) {
			const top = stack[stack.length - 1];
			if (!top) break;
			const edges = adjacency.get(top.id) ?? [];
			const next = edges[top.cursor++];
			if (next !== undefined) {
				if (!seen.has(next)) {
					seen.add(next);
					stack.push({ id: next, cursor: 0 });
				}
			} else {
				order.push(top.id);
				stack.pop();
			}
		}
	}
	seen.clear();
	const result: string[][] = [];
	for (const root of order.reverse()) {
		if (seen.has(root)) continue;
		const component: string[] = [];
		const stack = [root];
		seen.add(root);
		while (stack.length) {
			const id = stack.pop();
			if (id === undefined) break;
			component.push(id);
			for (const next of reverse.get(id) ?? [])
				if (!seen.has(next)) {
					seen.add(next);
					stack.push(next);
				}
		}
		result.push(component.sort(compareIds));
	}
	return result.sort((a, b) => compareIds(a[0] ?? "", b[0] ?? ""));
}

/** Prerequisite-first stable layers, not a second execution scheduler. */
export function topologicalOrder(
	nodes: readonly string[],
	prerequisites: ReadonlyMap<string, readonly string[]>,
): string[] {
	const pending = new Map<string, number>();
	const dependents = new Map(nodes.map((id) => [id, [] as string[]]));
	for (const id of nodes) {
		const deps = [...new Set(prerequisites.get(id) ?? [])];
		pending.set(id, deps.length);
		for (const dep of deps) {
			const targets = dependents.get(dep);
			if (!targets) throw new Error("Unknown commit prerequisite");
			targets.push(id);
		}
	}
	let ready = nodes.filter((id) => pending.get(id) === 0).sort(compareIds);
	const order: string[] = [];
	while (ready.length) {
		const next: string[] = [];
		for (const id of ready) {
			order.push(id);
			for (const child of dependents.get(id) ?? []) {
				const count = (pending.get(child) ?? 0) - 1;
				pending.set(child, count);
				if (count === 0) next.push(child);
			}
		}
		ready = next.sort(compareIds);
	}
	if (order.length !== nodes.length) throw new Error("Uncontracted commit dependency cycle");
	return order;
}
