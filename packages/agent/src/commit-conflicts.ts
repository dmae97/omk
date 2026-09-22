import type { ChangeAtom } from "./commit-types.ts";

interface PathOwners {
	readonly atoms: Set<string>;
	conflicted: boolean;
}

/** File-level v1 cannot prove independent patches on an overlapping path, even inside one SCC. */
export function ambiguousAtoms(atoms: readonly ChangeAtom[]): ReadonlySet<string> {
	const scopes = new Map<string, Map<string, PathOwners>>();
	for (const atom of atoms) {
		const scope = JSON.stringify([atom.repoId, atom.worktreeId]);
		let paths = scopes.get(scope);
		if (!paths) {
			paths = new Map();
			scopes.set(scope, paths);
		}
		for (const path of atom.paths) {
			let owners = paths.get(path);
			if (!owners) {
				owners = { atoms: new Set(), conflicted: false };
				paths.set(path, owners);
			}
			owners.atoms.add(atom.id);
		}
	}
	const result = new Set<string>();
	for (const paths of scopes.values()) {
		for (const [path, owners] of paths) {
			if (owners.atoms.size > 1) owners.conflicted = true;
			for (let end = path.indexOf("/"); end >= 0; end = path.indexOf("/", end + 1)) {
				const ancestor = paths.get(path.slice(0, end));
				if (
					ancestor &&
					(ancestor.atoms.size > 1 ||
						owners.atoms.size > 1 ||
						ancestor.atoms.values().next().value !== owners.atoms.values().next().value)
				) {
					ancestor.conflicted = true;
					owners.conflicted = true;
				}
			}
		}
		for (const owners of paths.values()) if (owners.conflicted) for (const id of owners.atoms) result.add(id);
	}
	return result;
}
