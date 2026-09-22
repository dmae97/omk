import type { SessionListEntry } from "../../../core/session-listing.ts";
import { canonicalizePath as resolveCanonicalPath } from "../../../utils/paths.ts";

interface SessionTreeNode {
	session: SessionListEntry;
	children: SessionTreeNode[];
}
export interface FlatSessionNode {
	session: SessionListEntry;
	depth: number;
	isLast: boolean;
	ancestorContinues: boolean[];
}
export function canonicalizePath(path: string | undefined): string | undefined {
	return path ? resolveCanonicalPath(path) : path;
}
export function buildSessionTree(sessions: SessionListEntry[]): SessionTreeNode[] {
	const byPath = new Map<string, SessionTreeNode>();
	for (const session of sessions)
		byPath.set(canonicalizePath(session.path) ?? session.path, { session, children: [] });
	const roots: SessionTreeNode[] = [];
	for (const session of sessions) {
		const node = byPath.get(canonicalizePath(session.path) ?? session.path);
		if (!node) continue;
		const parentPath = canonicalizePath(session.parentSessionPath);
		const parent = parentPath ? byPath.get(parentPath) : undefined;
		if (parent) parent.children.push(node);
		else roots.push(node);
	}
	const sortNodes = (nodes: SessionTreeNode[]): void => {
		nodes.sort((a, b) => b.session.modified.getTime() - a.session.modified.getTime());
		for (const node of nodes) sortNodes(node.children);
	};
	sortNodes(roots);
	return roots;
}
export function flattenSessionTree(roots: SessionTreeNode[]): FlatSessionNode[] {
	const result: FlatSessionNode[] = [];
	const walk = (node: SessionTreeNode, depth: number, ancestorContinues: boolean[], isLast: boolean): void => {
		result.push({ session: node.session, depth, isLast, ancestorContinues });
		for (let i = 0; i < node.children.length; i++) {
			const child = node.children[i];
			if (child)
				walk(child, depth + 1, [...ancestorContinues, depth > 0 ? !isLast : false], i === node.children.length - 1);
		}
	};
	for (let i = 0; i < roots.length; i++) {
		const root = roots[i];
		if (root) walk(root, 0, [], i === roots.length - 1);
	}
	return result;
}
