/**
 * Capability-coverage skill planning under host-approved constraints.
 *
 * Ported from docs/OMK_skill_knowledge_control_2026-09-19.zip
 * (src/skills.ts). Exact search for small sets, bounded greedy for large sets.
 */
import { arrayBound, ensure, integer, lexical, text, unique } from "./validation.ts";

export interface CapabilityNeed {
	readonly capability: string;
	readonly weight: number;
	readonly required: boolean;
}
export interface SkillDescriptor {
	readonly id: string;
	readonly contentHash: string;
	readonly capabilities: readonly string[];
	readonly phases: readonly string[];
	readonly tokenCost: number;
	readonly dependencies: readonly string[];
	readonly conflicts: readonly string[];
	readonly permissions: readonly string[];
	readonly explicitOnly: boolean;
	/** Exact versions intentionally, never a hand-written semver implementation. */
	readonly packages: Readonly<Record<string, readonly string[]>>;
}
export interface SkillPlanInput {
	readonly phase: string;
	readonly needs: readonly CapabilityNeed[];
	readonly catalog: readonly SkillDescriptor[];
	/** Host-owned content pins, not fields supplied by the skill being selected. */
	readonly approvedHashes: Readonly<Record<string, string>>;
	readonly installedVersions: Readonly<Record<string, string>>;
	readonly allowedPermissions: readonly string[];
	readonly explicitSkills: readonly string[];
	readonly tokenBudget: number;
	readonly maxSkills: number;
}
export interface SkillPlan {
	readonly selected: readonly string[];
	readonly tokenCost: number;
	readonly covered: readonly string[];
	readonly uncoveredRequired: readonly string[];
	readonly blockedExplicit: readonly string[];
	readonly rejected: Readonly<Record<string, string>>;
	readonly algorithm: "exact-small" | "greedy-with-singleton";
	readonly state: "covered" | "capability-gap" | "explicit-blocked";
}
interface Value {
	required: number;
	optional: number;
	cost: number;
	ids: string[];
}

export function planSkills(input: SkillPlanInput): SkillPlan {
	text(input.phase, "phase", 128);
	integer(input.tokenBudget, "tokenBudget", 10_000_000);
	integer(input.maxSkills, "maxSkills", 64);
	arrayBound(input.catalog, "catalog", 500);
	arrayBound(input.needs, "needs", 128);
	unique(
		input.catalog.map((s) => s.id),
		"catalog ids",
	);
	unique(
		input.needs.map((n) => n.capability),
		"need ids",
		128,
	);
	unique(input.allowedPermissions, "permissions");
	unique(input.explicitSkills, "explicitSkills", 64);
	for (const need of input.needs) {
		ensure(Number.isFinite(need.weight) && need.weight > 0 && need.weight <= 1_000_000, "invalid need weight");
		ensure(typeof need.required === "boolean", "required must be boolean");
	}
	const byId = new Map(input.catalog.map((skill) => [skill.id, skill]));
	const rejected = new Map<string, string>();
	for (const skill of input.catalog) {
		text(skill.contentHash, "contentHash");
		integer(skill.tokenCost, "tokenCost", 1_000_000);
		unique(skill.capabilities, "capabilities", 128);
		unique(skill.phases, "phases", 32);
		unique(skill.dependencies, "dependencies", 64);
		unique(skill.conflicts, "conflicts", 64);
		unique(skill.permissions, "skill permissions", 64);
		ensure(typeof skill.explicitOnly === "boolean", "explicitOnly must be boolean");
		ensure(skill.packages !== null && typeof skill.packages === "object", "packages must be a record");
		for (const [name, versions] of Object.entries(skill.packages)) {
			text(name, "package");
			unique(versions, "versions", 128);
			ensure(versions.length > 0, "empty supported versions");
		}
		if (input.approvedHashes[skill.id] !== skill.contentHash) rejected.set(skill.id, "unapproved-or-changed-content");
		else if (!skill.phases.includes(input.phase)) rejected.set(skill.id, "phase-mismatch");
		else if (skill.explicitOnly && !input.explicitSkills.includes(skill.id)) rejected.set(skill.id, "explicit-only");
		else if (skill.permissions.some((permission) => !input.allowedPermissions.includes(permission))) {
			rejected.set(skill.id, "permission-denied");
		} else if (
			Object.entries(skill.packages).some(
				([name, versions]) => !versions.includes(input.installedVersions[name] ?? ""),
			)
		) {
			rejected.set(skill.id, "version-unknown-or-incompatible");
		}
	}
	// A cycle or unavailable prerequisite invalidates the entire dependent closure.
	const closureCache = new Map<string, Set<string> | undefined>();
	const closure = (id: string, trail = new Set<string>()): Set<string> | undefined => {
		if (trail.has(id) || rejected.has(id)) return undefined;
		if (closureCache.has(id)) return closureCache.get(id);
		const skill = byId.get(id);
		if (!skill) return undefined;
		const result = new Set([id]);
		const next = new Set([...trail, id]);
		for (const dependency of skill.dependencies) {
			const children = closure(dependency, next);
			if (!children) {
				closureCache.set(id, undefined);
				return undefined;
			}
			for (const child of children) result.add(child);
		}
		closureCache.set(id, result);
		return result;
	};
	const closures = new Map<string, Set<string>>();
	for (const id of [...byId.keys()].sort(lexical)) {
		const set = closure(id);
		if (set) closures.set(id, set);
		else if (!rejected.has(id)) rejected.set(id, "invalid-dependency-closure");
	}
	const feasible = (ids: ReadonlySet<string>): boolean => {
		if (ids.size > input.maxSkills) return false;
		let cost = 0;
		for (const id of ids) {
			const skill = byId.get(id);
			if (!skill || rejected.has(id)) return false;
			if (skill.dependencies.some((d) => !ids.has(d))) return false;
			if (skill.conflicts.some((c) => ids.has(c))) return false;
			cost += skill.tokenCost;
		}
		return cost <= input.tokenBudget;
	};
	const value = (ids: ReadonlySet<string>): Value => {
		const coverage = new Set<string>();
		let cost = 0;
		for (const id of ids) {
			const skill = byId.get(id)!;
			cost += skill.tokenCost;
			for (const capability of skill.capabilities) coverage.add(capability);
		}
		let required = 0,
			optional = 0;
		for (const need of input.needs) {
			if (coverage.has(need.capability)) {
				if (need.required) required += need.weight;
				else optional += need.weight;
			}
		}
		return { required, optional, cost, ids: [...ids].sort(lexical) };
	};
	const better = (left: Value, right: Value): boolean =>
		left.required !== right.required
			? left.required > right.required
			: left.optional !== right.optional
				? left.optional > right.optional
				: left.cost !== right.cost
					? left.cost < right.cost
					: left.ids.length !== right.ids.length
						? left.ids.length < right.ids.length
						: lexical(left.ids.join("\0"), right.ids.join("\0")) < 0;
	let base = new Set<string>();
	const blockedExplicit: string[] = [];
	for (const id of [...input.explicitSkills].sort(lexical)) {
		const set = closures.get(id);
		if (!set) blockedExplicit.push(id);
		else for (const item of set) base.add(item);
	}
	if (!feasible(base)) blockedExplicit.push(...input.explicitSkills.filter((id) => !blockedExplicit.includes(id)));
	// Conflicting explicit requests are never silently replaced by automatic picks.
	if (blockedExplicit.length > 0) base = new Set();
	let best = base;
	const candidates = [...closures.entries()].filter(([id]) => !base.has(id));
	const algorithm = candidates.length <= 12 ? "exact-small" : "greedy-with-singleton";
	if (blockedExplicit.length === 0) {
		if (algorithm === "exact-small") {
			const visit = (position: number, current: Set<string>): void => {
				if (!feasible(current)) return;
				if (better(value(current), value(best))) best = current;
				const candidate = candidates[position];
				if (!candidate) return;
				visit(position + 1, current);
				visit(position + 1, new Set([...current, ...candidate[1]]));
			};
			visit(0, base);
		} else {
			let current = base;
			while (true) {
				const previous = value(current);
				let winner: Set<string> | undefined;
				let rank: readonly [number, number, string] = [-1, -1, ""];
				for (const [id, set] of candidates) {
					if (current.has(id)) continue;
					const joined = new Set([...current, ...set]);
					if (!feasible(joined)) continue;
					const after = value(joined);
					const requiredGain = after.required - previous.required;
					const optionalGain = after.optional - previous.optional;
					if (requiredGain <= 0 && optionalGain <= 0) continue;
					const cost = Math.max(1, after.cost - previous.cost);
					const proposal = [requiredGain / cost, optionalGain / cost, id] as const;
					if (
						!winner ||
						proposal[0] > rank[0] ||
						(proposal[0] === rank[0] &&
							(proposal[1] > rank[1] || (proposal[1] === rank[1] && lexical(proposal[2], rank[2]) < 0)))
					) {
						winner = joined;
						rank = proposal;
					}
				}
				if (!winner) break;
				current = winner;
			}
			best = current;
			for (const [, set] of candidates) {
				const joined = new Set([...base, ...set]);
				if (feasible(joined) && better(value(joined), value(best))) best = joined;
			}
		}
	}
	const allCovered = new Set([...best].flatMap((id) => byId.get(id)!.capabilities));
	const uncoveredRequired = input.needs
		.filter((n) => n.required && !allCovered.has(n.capability))
		.map((n) => n.capability)
		.sort(lexical);
	return {
		selected: [...best].sort(lexical),
		tokenCost: value(best).cost,
		covered: input.needs
			.filter((n) => allCovered.has(n.capability))
			.map((n) => n.capability)
			.sort(lexical),
		uncoveredRequired,
		blockedExplicit: blockedExplicit.sort(lexical),
		rejected: Object.fromEntries([...rejected].sort(([a], [b]) => lexical(a, b))),
		algorithm,
		state: blockedExplicit.length ? "explicit-blocked" : uncoveredRequired.length ? "capability-gap" : "covered",
	};
}
