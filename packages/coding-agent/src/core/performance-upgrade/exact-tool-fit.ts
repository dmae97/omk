/**
 * Group-level tool-schema fit that never assumes group costs add up.
 *
 * `count` prices one complete projection the way the provider request serializes it: wrapper,
 * separators and tokenizer merges included. `C(S \ g) = C(S) - C(g)` does not hold for such a
 * counter, so the remaining projection is recounted after every withheld group instead of
 * subtracting the group's standalone cost.
 */
export interface NamedTool {
	readonly name: string;
}

export interface WithheldGroup {
	readonly group: string;
	readonly toolCount: number;
	/** Standalone cost of the group's own projection. */
	readonly tokens: number;
}

export interface ExactFitInput<T extends NamedTool> {
	readonly tools: readonly T[];
	/** Group a tool is withheld with; `undefined` keeps the tool in every projection. */
	readonly groupOf: (name: string) => string | undefined;
	readonly budgetTokens: number;
	readonly count: (tools: readonly T[]) => number;
	/** Trusted host policy only: groups that are never withheld. A model suggestion cannot set this. */
	readonly pinnedGroups?: ReadonlySet<string>;
	/** Trusted host utility per group (default 0); the lowest utility per token is withheld first. */
	readonly utilityOfGroup?: (group: string) => number;
}

export interface ExactFit<T> {
	readonly tools: T[];
	readonly withheld: WithheldGroup[];
	/** Recounted cost of `tools`, never a subtraction estimate. */
	readonly tokens: number;
	/** Only ungrouped or pinned tools remain and they still exceed the budget. */
	readonly overflow: boolean;
	readonly recounts: number;
}

/**
 * Withhold the shortest prefix of ranked groups whose recounted projection fits. Without trusted
 * utility the order is largest standalone cost first, ties by group name, so the selection is
 * stable across turns. Ungrouped and pinned tools are never hidden: an impossible budget returns
 * them with `overflow`.
 */
export function exactToolFit<T extends NamedTool>(input: ExactFitInput<T>): ExactFit<T> {
	if (!Number.isFinite(input.budgetTokens) || input.budgetTokens < 0) throw new RangeError("invalid tool budget");
	let recounts = 0;
	const count = (tools: readonly T[]): number => {
		recounts++;
		const tokens = input.count(tools);
		if (!Number.isFinite(tokens) || tokens < 0) throw new Error("token counter returned invalid cost");
		return tokens;
	};
	let tokens = count(input.tools);
	if (tokens <= input.budgetTokens) {
		return { tools: [...input.tools], withheld: [], tokens, overflow: false, recounts };
	}

	// One groupOf snapshot serves ranking and filtering; tools sharing a name share its group.
	const toolGroups = input.tools.map((tool) => input.groupOf(tool.name));
	const members = new Map<string, T[]>();
	input.tools.forEach((tool, index) => {
		const group = toolGroups[index];
		if (group === undefined || input.pinnedGroups?.has(group)) return;
		const list = members.get(group);
		if (list) list.push(tool);
		else members.set(group, [tool]);
	});
	const ranked = [...members]
		.map(([group, groupTools]) => {
			const utility = input.utilityOfGroup?.(group) ?? 0;
			if (!Number.isFinite(utility) || utility < 0) throw new Error("invalid trusted utility");
			const cost = count(groupTools);
			return { group, toolCount: groupTools.length, tokens: cost, density: utility / Math.max(1, cost) };
		})
		.sort(
			(left, right) =>
				left.density - right.density || right.tokens - left.tokens || (left.group < right.group ? -1 : 1),
		);

	if (ranked.length === 0) return { tools: [...input.tools], withheld: [], tokens, overflow: true, recounts };

	// Withhold the shortest ranked prefix whose recounted projection fits. Standalone costs less the
	// empty projection's cost (the request wrapper) only estimate the prefix length; recounts then
	// correct it upward and confirm that one group fewer overflows, so a typical fit costs a few
	// recounts instead of one per withheld group.
	const projection = (prefix: number): T[] => {
		const dropped = new Set(ranked.slice(0, prefix).map((entry) => entry.group));
		return input.tools.filter((_tool, index) => {
			const group = toolGroups[index];
			return group === undefined || !dropped.has(group);
		});
	};
	const wrapperTokens = count([]);
	let prefix = 0;
	let estimate = tokens;
	for (const entry of ranked) {
		if (estimate <= input.budgetTokens) break;
		estimate -= Math.max(0, entry.tokens - wrapperTokens);
		prefix++;
	}
	let tools = projection(prefix);
	tokens = count(tools);
	while (tokens > input.budgetTokens && prefix < ranked.length) {
		prefix++;
		tools = projection(prefix);
		tokens = count(tools);
	}
	// Prefix 1 needs no check: withholding nothing is the initial count, which overflowed.
	while (prefix > 1) {
		const shorter = projection(prefix - 1);
		const shorterTokens = count(shorter);
		if (shorterTokens > input.budgetTokens) break;
		prefix--;
		tools = shorter;
		tokens = shorterTokens;
	}
	const withheld = ranked.slice(0, prefix).map(({ group, toolCount, tokens: groupTokens }) => ({
		group,
		toolCount,
		tokens: groupTokens,
	}));
	return { tools, withheld, tokens, overflow: tokens > input.budgetTokens, recounts };
}
