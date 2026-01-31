import { padding } from "@oh-my-pi/pi-tui";

/**
 * Code mutations for edit benchmark generation.
 *
 * Each mutation introduces a subtle bug that tests edit precision, not bug-finding
 * ability. The mutation can be trivial - what matters is whether the model can
 * surgically apply the patch in difficult contexts.
 */

export interface MutationInfo {
	lineNumber: number;
	originalSnippet: string;
	mutatedSnippet: string;
}

export interface Mutation {
	name: string;
	category: string;
	fixHint: string;

	canApply(content: string): boolean;
	mutate(content: string, rng: () => number): [string, MutationInfo];
	describe(info: MutationInfo): string;
}

interface Candidate {
	lineNumber: number;
	start: number;
	end: number;
	original: string;
	replacement: string;
}

function isCommented(line: string, index: number): boolean {
	const commentIndex = line.indexOf("//");
	return commentIndex !== -1 && commentIndex < index;
}

function iterCandidates(
	lines: string[],
	pattern: RegExp,
	replacementFn: (match: RegExpExecArray) => string | null,
): Candidate[] {
	const candidates: Candidate[] = [];
	for (let lineNumber = 1; lineNumber <= lines.length; lineNumber++) {
		const line = lines[lineNumber - 1];
		const regex = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
		let match: RegExpExecArray | null;
		while ((match = regex.exec(line)) !== null) {
			if (isCommented(line, match.index)) continue;
			const replacement = replacementFn(match);
			if (replacement === null) continue;
			candidates.push({
				lineNumber,
				start: match.index,
				end: match.index + match[0].length,
				original: match[0],
				replacement,
			});
		}
	}
	return candidates;
}

function pickCandidate(
	lines: string[],
	pattern: RegExp,
	replacementFn: (match: RegExpExecArray) => string | null,
	rng: () => number,
): Candidate | null {
	const candidates = iterCandidates(lines, pattern, replacementFn);
	if (candidates.length === 0) return null;
	return candidates[Math.floor(rng() * candidates.length)];
}

function applyCandidate(lines: string[], candidate: Candidate): MutationInfo {
	const line = lines[candidate.lineNumber - 1];
	lines[candidate.lineNumber - 1] = line.slice(0, candidate.start) + candidate.replacement + line.slice(candidate.end);
	return {
		lineNumber: candidate.lineNumber,
		originalSnippet: candidate.original,
		mutatedSnippet: candidate.replacement,
	};
}

function stripStrings(line: string): string {
	const pattern = /(?<quote>['"])(?<body>(?:\\.|[^\\\n])*?)\k<quote>/g;
	return line.replace(pattern, (match) => padding(match.length));
}

function mutateIdentifier(identifier: string): string | null {
	if (identifier.length < 2) return null;
	let mutated: string;
	if (identifier.length >= 3 && identifier[0] === identifier[1]) {
		mutated = identifier[identifier.length - 1] + identifier.slice(1, -1) + identifier[0];
	} else {
		mutated = identifier[1] + identifier[0] + identifier.slice(2);
	}
	if (mutated === identifier) return null;
	return mutated;
}

function randomChoice<T>(arr: T[], rng: () => number): T {
	return arr[Math.floor(rng() * arr.length)];
}

function randomSample<T>(arr: T[], count: number, rng: () => number): T[] {
	const copy = [...arr];
	const result: T[] = [];
	for (let i = 0; i < count && copy.length > 0; i++) {
		const idx = Math.floor(rng() * copy.length);
		result.push(copy.splice(idx, 1)[0]);
	}
	return result;
}

abstract class BaseMutation implements Mutation {
	abstract name: string;
	abstract category: string;
	abstract fixHint: string;
	abstract description: string;

	abstract canApply(content: string): boolean;
	abstract mutate(content: string, rng: () => number): [string, MutationInfo];

	describe(_info: MutationInfo): string {
		return this.description;
	}
}

class SwapComparisonMutation extends BaseMutation {
	name = "swap-comparison";
	category = "operator";
	fixHint = "Swap the comparison operator to the correct variant.";
	description = "A comparison operator is subtly wrong.";

	private pattern = /(?<=[\s(])(?<op><=|>=|<|>)(?=\s*[\d\w(])/;
	private swap: Record<string, string> = { "<=": "<", "<": "<=", ">=": ">", ">": ">=" };

	canApply(content: string): boolean {
		return this.pattern.test(content);
	}

	mutate(content: string, rng: () => number): [string, MutationInfo] {
		const lines = content.split("\n");
		const candidate = pickCandidate(lines, this.pattern, (m) => this.swap[m.groups?.op ?? m[0]] ?? null, rng);
		if (!candidate) return [content, { lineNumber: 0, originalSnippet: "", mutatedSnippet: "" }];
		const info = applyCandidate(lines, candidate);
		return [lines.join("\n"), info];
	}
}

class SwapEqualityMutation extends BaseMutation {
	name = "swap-equality";
	category = "operator";
	fixHint = "Fix the equality comparison operator.";
	description = "An equality operator is inverted.";

	private pattern = /(?<![=!<>])(?<op>===|!==|==|!=)(?!=)/;
	private swap: Record<string, string> = { "===": "!==", "!==": "===", "==": "!=", "!=": "==" };

	canApply(content: string): boolean {
		return this.pattern.test(content);
	}

	mutate(content: string, rng: () => number): [string, MutationInfo] {
		const lines = content.split("\n");
		const candidate = pickCandidate(lines, this.pattern, (m) => this.swap[m.groups?.op ?? m[0]] ?? null, rng);
		if (!candidate) return [content, { lineNumber: 0, originalSnippet: "", mutatedSnippet: "" }];
		const info = applyCandidate(lines, candidate);
		return [lines.join("\n"), info];
	}
}

class SwapLogicalMutation extends BaseMutation {
	name = "swap-logical";
	category = "operator";
	fixHint = "Use the intended boolean operator.";
	description = "A boolean operator is incorrect.";

	private pattern = /(?<op>&&|\|\|)/;
	private swap: Record<string, string> = { "&&": "||", "||": "&&" };

	canApply(content: string): boolean {
		return this.pattern.test(content);
	}

	mutate(content: string, rng: () => number): [string, MutationInfo] {
		const lines = content.split("\n");
		const candidate = pickCandidate(lines, this.pattern, (m) => this.swap[m.groups?.op ?? m[0]] ?? null, rng);
		if (!candidate) return [content, { lineNumber: 0, originalSnippet: "", mutatedSnippet: "" }];
		const info = applyCandidate(lines, candidate);
		return [lines.join("\n"), info];
	}
}

class RemoveNegationMutation extends BaseMutation {
	name = "remove-negation";
	category = "operator";
	fixHint = "Remove the stray logical negation.";
	description = "A negation operator is accidentally applied.";

	private pattern = /!(?!=)/;

	canApply(content: string): boolean {
		return this.pattern.test(content);
	}

	mutate(content: string, rng: () => number): [string, MutationInfo] {
		const lines = content.split("\n");
		const candidate = pickCandidate(lines, this.pattern, () => "", rng);
		if (!candidate) return [content, { lineNumber: 0, originalSnippet: "", mutatedSnippet: "" }];
		const info = applyCandidate(lines, candidate);
		return [lines.join("\n"), info];
	}
}

class SwapIncDecMutation extends BaseMutation {
	name = "swap-increment-decrement";
	category = "operator";
	fixHint = "Replace the increment/decrement operator with the intended one.";
	description = "An increment/decrement operator points the wrong direction.";

	private pattern = /(?<op>\+\+|--)/;
	private swap: Record<string, string> = { "++": "--", "--": "++" };

	canApply(content: string): boolean {
		return this.pattern.test(content);
	}

	mutate(content: string, rng: () => number): [string, MutationInfo] {
		const lines = content.split("\n");
		const candidate = pickCandidate(lines, this.pattern, (m) => this.swap[m.groups?.op ?? m[0]] ?? null, rng);
		if (!candidate) return [content, { lineNumber: 0, originalSnippet: "", mutatedSnippet: "" }];
		const info = applyCandidate(lines, candidate);
		return [lines.join("\n"), info];
	}
}

class SwapArithmeticMutation extends BaseMutation {
	name = "swap-arithmetic";
	category = "operator";
	fixHint = "Correct the arithmetic operator.";
	description = "An arithmetic operator was swapped.";

	private pattern = /(?<=\s)(?<op>[+\-*/])(?=\s)/;
	private swap: Record<string, string> = { "+": "-", "-": "+", "*": "/", "/": "*" };

	canApply(content: string): boolean {
		return this.pattern.test(content);
	}

	mutate(content: string, rng: () => number): [string, MutationInfo] {
		const lines = content.split("\n");
		const candidate = pickCandidate(lines, this.pattern, (m) => this.swap[m.groups?.op ?? m[0]] ?? null, rng);
		if (!candidate) return [content, { lineNumber: 0, originalSnippet: "", mutatedSnippet: "" }];
		const info = applyCandidate(lines, candidate);
		return [lines.join("\n"), info];
	}
}

class BooleanLiteralFlipMutation extends BaseMutation {
	name = "flip-boolean";
	category = "literal";
	fixHint = "Flip the boolean literal to the intended value.";
	description = "A boolean literal is inverted.";

	private pattern = /\b(true|false)\b/;
	private swap: Record<string, string> = { true: "false", false: "true" };

	canApply(content: string): boolean {
		return this.pattern.test(content);
	}

	mutate(content: string, rng: () => number): [string, MutationInfo] {
		const lines = content.split("\n");
		const candidate = pickCandidate(lines, this.pattern, (m) => this.swap[m[1]] ?? null, rng);
		if (!candidate) return [content, { lineNumber: 0, originalSnippet: "", mutatedSnippet: "" }];
		const info = applyCandidate(lines, candidate);
		return [lines.join("\n"), info];
	}
}

class OptionalChainRemovalMutation extends BaseMutation {
	name = "remove-optional-chain";
	category = "access";
	fixHint =
		"Restore the optional chaining operator (`?.`) at the ONE location where it was removed. Do not add optional chaining elsewhere.";
	description = "Optional chaining was removed from a property access.";

	private pattern = /\?\.(?=[\w\[(])/;

	canApply(content: string): boolean {
		return this.pattern.test(content);
	}

	mutate(content: string, rng: () => number): [string, MutationInfo] {
		const lines = content.split("\n");
		const candidate = pickCandidate(lines, this.pattern, () => ".", rng);
		if (!candidate) return [content, { lineNumber: 0, originalSnippet: "", mutatedSnippet: "" }];
		const info = applyCandidate(lines, candidate);
		return [lines.join("\n"), info];
	}
}

class CallArgumentSwapMutation extends BaseMutation {
	name = "swap-call-args";
	category = "call";
	fixHint = "Swap the two arguments to their original order.";
	description = "Two arguments in a call are swapped.";

	private pattern = /(?<callee>[\w.$]+)\(\s*(?<a>[^(),]+?)\s*,\s*(?<b>[^(),]+?)\s*\)/;

	canApply(content: string): boolean {
		return this.pattern.test(content);
	}

	mutate(content: string, rng: () => number): [string, MutationInfo] {
		const lines = content.split("\n");
		const candidate = pickCandidate(
			lines,
			this.pattern,
			(m) => {
				const callee = m.groups?.callee ?? "";
				const a = m.groups?.a ?? "";
				const b = m.groups?.b ?? "";
				return `${callee}(${b}, ${a})`;
			},
			rng,
		);
		if (!candidate) return [content, { lineNumber: 0, originalSnippet: "", mutatedSnippet: "" }];
		const info = applyCandidate(lines, candidate);
		return [lines.join("\n"), info];
	}
}

class NullishCoalescingSwapMutation extends BaseMutation {
	name = "swap-nullish";
	category = "operator";
	fixHint = "Use the intended nullish/logical operator.";
	description = "A nullish coalescing operator was swapped.";

	private pattern = /(?<op>\?\?|\|\|)/;
	private swap: Record<string, string> = { "??": "||", "||": "??" };

	canApply(content: string): boolean {
		return this.pattern.test(content);
	}

	mutate(content: string, rng: () => number): [string, MutationInfo] {
		const lines = content.split("\n");
		const candidate = pickCandidate(lines, this.pattern, (m) => this.swap[m.groups?.op ?? m[0]] ?? null, rng);
		if (!candidate) return [content, { lineNumber: 0, originalSnippet: "", mutatedSnippet: "" }];
		const info = applyCandidate(lines, candidate);
		return [lines.join("\n"), info];
	}
}

class RegexQuantifierSwapMutation extends BaseMutation {
	name = "swap-regex-quantifier";
	category = "regex";
	fixHint = "Fix the ONE regex quantifier that was swapped (between `+` and `*`). Do not modify other quantifiers.";
	description = "A regex quantifier was swapped, changing whitespace matching.";

	private literalPattern = /\/(?<body>(?:\\\/|[^/\n])*)\/(?<flags>[gimsuy]*)/g;
	private quantPattern = /(\\[A-Za-z]|\\.|\[[^\]]+\])(?<quant>[+*])/g;

	canApply(content: string): boolean {
		const lines = content.split("\n");
		return this.iterCandidates(lines).length > 0;
	}

	mutate(content: string, rng: () => number): [string, MutationInfo] {
		const lines = content.split("\n");
		const candidates = this.iterCandidates(lines);
		if (candidates.length === 0) return [content, { lineNumber: 0, originalSnippet: "", mutatedSnippet: "" }];

		const lineCounts = new Map<string, number>();
		for (const line of lines) {
			lineCounts.set(line, (lineCounts.get(line) ?? 0) + 1);
		}

		const repeatedCandidates = candidates.filter((c) => (lineCounts.get(lines[c.lineNumber - 1]) ?? 0) > 1);

		const candidate = randomChoice(repeatedCandidates.length > 0 ? repeatedCandidates : candidates, rng);
		const info = applyCandidate(lines, candidate);
		return [lines.join("\n"), info];
	}

	private iterCandidates(lines: string[]): Candidate[] {
		const candidates: Candidate[] = [];
		for (let lineNumber = 1; lineNumber <= lines.length; lineNumber++) {
			const line = lines[lineNumber - 1];
			const litRegex = new RegExp(this.literalPattern.source, this.literalPattern.flags);
			let litMatch: RegExpExecArray | null;
			while ((litMatch = litRegex.exec(line)) !== null) {
				if (isCommented(line, litMatch.index)) continue;
				const prefix = line.slice(0, litMatch.index);
				if (prefix && !" =({[,;:!".includes(prefix[prefix.length - 1]) && !/\s/.test(prefix[prefix.length - 1])) {
					continue;
				}
				const bodyStart = litMatch.index + 1; // after opening /
				const body = litMatch.groups?.body ?? "";
				const quantRegex = new RegExp(this.quantPattern.source, this.quantPattern.flags);
				let tokenMatch: RegExpExecArray | null;
				while ((tokenMatch = quantRegex.exec(body)) !== null) {
					const quantifier = tokenMatch.groups?.quant ?? tokenMatch[2];
					const swapped = quantifier === "+" ? "*" : "+";
					const start = bodyStart + tokenMatch.index + tokenMatch[0].length - 1;
					candidates.push({
						lineNumber,
						start,
						end: start + 1,
						original: quantifier,
						replacement: swapped,
					});
				}
			}
		}
		return candidates;
	}
}

class UnicodeHyphenMutation extends BaseMutation {
	name = "unicode-hyphen";
	category = "unicode";
	fixHint = "Replace the unicode dash with a plain ASCII hyphen.";
	description = "A string literal contains a lookalike unicode dash.";

	private stringPattern = /(?<quote>['"])(?<body>(?:\\.|[^\\\n])*?)\k<quote>/g;

	canApply(content: string): boolean {
		return content.includes("-") && this.stringPattern.test(content);
	}

	mutate(content: string, rng: () => number): [string, MutationInfo] {
		const lines = content.split("\n");
		const candidates: Candidate[] = [];
		for (let lineNumber = 1; lineNumber <= lines.length; lineNumber++) {
			const line = lines[lineNumber - 1];
			const regex = new RegExp(this.stringPattern.source, this.stringPattern.flags);
			let match: RegExpExecArray | null;
			while ((match = regex.exec(line)) !== null) {
				if (isCommented(line, match.index)) continue;
				const body = match.groups?.body ?? "";
				const dashIndex = body.indexOf("-");
				if (dashIndex === -1) continue;
				const start = match.index + 1 + dashIndex; // +1 for opening quote
				candidates.push({
					lineNumber,
					start,
					end: start + 1,
					original: "-",
					replacement: "–", // en-dash
				});
			}
		}
		if (candidates.length === 0) return [content, { lineNumber: 0, originalSnippet: "", mutatedSnippet: "" }];
		const candidate = randomChoice(candidates, rng);
		const info = applyCandidate(lines, candidate);
		return [lines.join("\n"), info];
	}
}

class IdentifierMultiEditMutation extends BaseMutation {
	name = "identifier-multi-edit";
	category = "identifier";
	fixHint = "Restore the identifier to its original spelling in all affected locations.";
	description = "An identifier is misspelled in multiple separate locations.";

	private pattern = /\b[A-Za-z_$][\w$]*\b/g;
	private keywords = new Set([
		"await",
		"break",
		"case",
		"catch",
		"class",
		"const",
		"continue",
		"debugger",
		"default",
		"delete",
		"do",
		"else",
		"export",
		"extends",
		"finally",
		"for",
		"function",
		"if",
		"import",
		"in",
		"instanceof",
		"new",
		"return",
		"super",
		"switch",
		"this",
		"throw",
		"try",
		"typeof",
		"var",
		"void",
		"while",
		"with",
		"yield",
		"let",
		"enum",
		"implements",
		"interface",
		"package",
		"private",
		"protected",
		"public",
		"static",
		"null",
		"true",
		"false",
	]);

	canApply(content: string): boolean {
		return this.pattern.test(content);
	}

	mutate(content: string, rng: () => number): [string, MutationInfo] {
		const lines = content.split("\n");
		const occurrences = new Map<string, Array<[number, number, number]>>();

		for (let lineNumber = 1; lineNumber <= lines.length; lineNumber++) {
			const line = lines[lineNumber - 1];
			const masked = stripStrings(line);
			const regex = new RegExp(this.pattern.source, this.pattern.flags);
			let match: RegExpExecArray | null;
			while ((match = regex.exec(masked)) !== null) {
				if (isCommented(line, match.index)) continue;
				const identifier = match[0];
				if (this.keywords.has(identifier)) continue;
				const mutated = mutateIdentifier(identifier);
				if (mutated === null) continue;
				const spans = occurrences.get(identifier) ?? [];
				spans.push([lineNumber, match.index, match.index + identifier.length]);
				occurrences.set(identifier, spans);
			}
		}

		let candidates = Array.from(occurrences.entries()).filter(
			([, spans]) => new Set(spans.map((s) => s[0])).size >= 3,
		);
		if (candidates.length === 0) {
			candidates = Array.from(occurrences.entries()).filter(
				([, spans]) => new Set(spans.map((s) => s[0])).size >= 2,
			);
		}
		if (candidates.length === 0) return [content, { lineNumber: 0, originalSnippet: "", mutatedSnippet: "" }];

		const [identifier, spans] = randomChoice(candidates, rng);
		const mutated = mutateIdentifier(identifier);
		if (mutated === null) return [content, { lineNumber: 0, originalSnippet: "", mutatedSnippet: "" }];

		const lineNumbers = Array.from(new Set(spans.map((s) => s[0])));
		const editCount = Math.min(lineNumbers.length, randomChoice(lineNumbers.length >= 3 ? [2, 3, 3, 4] : [2], rng));
		const chosenLines = randomSample(lineNumbers, editCount, rng);
		const selectedSpans: Array<[number, number, number]> = [];
		for (const ln of chosenLines) {
			const lineSpans = spans.filter((s) => s[0] === ln);
			selectedSpans.push(randomChoice(lineSpans, rng));
		}

		for (const [lineNumber, start, end] of selectedSpans) {
			const line = lines[lineNumber - 1];
			lines[lineNumber - 1] = line.slice(0, start) + mutated + line.slice(end);
		}

		const info: MutationInfo = {
			lineNumber: selectedSpans[0][0],
			originalSnippet: identifier,
			mutatedSnippet: mutated,
		};
		return [lines.join("\n"), info];
	}
}

class DuplicateLineLiteralFlipMutation extends BaseMutation {
	name = "duplicate-line-flip";
	category = "duplicate";
	fixHint = "Fix the literal or operator on the duplicated line.";
	description = "A duplicated line contains a subtle literal/operator change.";

	private boolPattern = /\b(true|false)\b/;
	private eqPattern = /(?<![=!<>])(?:===|!==|==|!=)(?!=)/;
	private compPattern = /(?<=[\s(])(?<comp><=|>=|<|>)(?=\s*[\d\w(])/;
	private boolSwap: Record<string, string> = { true: "false", false: "true" };
	private eqSwap: Record<string, string> = { "===": "!==", "!==": "===", "==": "!=", "!=": "==" };
	private compSwap: Record<string, string> = { "<=": "<", "<": "<=", ">=": ">", ">": ">=" };

	canApply(content: string): boolean {
		const lines = content.split("\n");
		if (lines.length === new Set(lines).size) return false;
		return this.boolPattern.test(content) || this.eqPattern.test(content) || this.compPattern.test(content);
	}

	mutate(content: string, rng: () => number): [string, MutationInfo] {
		const lines = content.split("\n");
		const lineMap = new Map<string, number[]>();
		for (let i = 1; i <= lines.length; i++) {
			const line = lines[i - 1];
			const indices = lineMap.get(line) ?? [];
			indices.push(i);
			lineMap.set(line, indices);
		}

		const candidates: Candidate[] = [];
		for (const [line, indices] of lineMap) {
			if (indices.length < 2) continue;
			for (const [pattern, swapMap] of [
				[this.boolPattern, this.boolSwap],
				[this.eqPattern, this.eqSwap],
				[this.compPattern, this.compSwap],
			] as const) {
				const regex = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
				let match: RegExpExecArray | null;
				while ((match = regex.exec(line)) !== null) {
					if (isCommented(line, match.index)) continue;
					const token = match[0];
					const replacement = swapMap[token];
					if (!replacement) continue;
					for (const lineNumber of indices) {
						candidates.push({
							lineNumber,
							start: match.index,
							end: match.index + token.length,
							original: token,
							replacement,
						});
					}
				}
			}
		}

		if (candidates.length === 0) return [content, { lineNumber: 0, originalSnippet: "", mutatedSnippet: "" }];
		const candidate = randomChoice(candidates, rng);
		const info = applyCandidate(lines, candidate);
		return [lines.join("\n"), info];
	}
}

class SwapAdjacentLinesMutation extends BaseMutation {
	name = "swap-adjacent-lines";
	category = "structural";
	fixHint = "Swap the two adjacent lines back to their original order.";
	description = "Two adjacent statements are in the wrong order.";

	private statementPattern =
		/^\s*(?:(?:const|let|var)\s+\w+\s*=|return\s+|\w+\s*(?:\.\w+)*\s*\(|\w+\s*(?:\.\w+)*\s*=)/;

	canApply(content: string): boolean {
		const lines = content.split("\n");
		for (let i = 0; i < lines.length - 1; i++) {
			if (this.isSwappablePair(lines, i)) return true;
		}
		return false;
	}

	private isSwappablePair(lines: string[], i: number): boolean {
		const lineA = lines[i];
		const lineB = lines[i + 1];
		if (!lineA.trim() || !lineB.trim()) return false;
		const indentA = lineA.length - lineA.trimStart().length;
		const indentB = lineB.length - lineB.trimStart().length;
		if (indentA !== indentB) return false;
		if (!this.statementPattern.test(lineA) || !this.statementPattern.test(lineB)) return false;
		if (lineA.trim() === lineB.trim()) return false;
		if (lineA.includes("//") || lineB.includes("//")) return false;
		return true;
	}

	mutate(content: string, rng: () => number): [string, MutationInfo] {
		const lines = content.split("\n");
		const candidates: number[] = [];
		for (let i = 0; i < lines.length - 1; i++) {
			if (this.isSwappablePair(lines, i)) candidates.push(i);
		}

		if (candidates.length === 0) return [content, { lineNumber: 0, originalSnippet: "", mutatedSnippet: "" }];

		const i = randomChoice(candidates, rng);
		[lines[i], lines[i + 1]] = [lines[i + 1], lines[i]];
		return [
			lines.join("\n"),
			{
				lineNumber: i + 1,
				originalSnippet: `[lines ${i + 1}-${i + 2}]`,
				mutatedSnippet: "[swapped]",
			},
		];
	}
}

class SwapIfElseBranchesMutation extends BaseMutation {
	name = "swap-if-else";
	category = "structural";
	fixHint =
		"Swap the if and else branch bodies back to their original positions. The condition should be negated to match.";
	description = "The if and else branches are swapped (condition should be negated).";

	private ifPattern = /^\s*if\s*\([^)]+\)\s*\{/;

	canApply(content: string): boolean {
		if (!content.includes("} else {")) return false;
		return content.split("\n").some((line) => this.ifPattern.test(line));
	}

	mutate(content: string, rng: () => number): [string, MutationInfo] {
		const lines = content.split("\n");
		const candidates: Array<[number, number, number]> = [];

		let i = 0;
		while (i < lines.length) {
			const line = lines[i];
			if (this.ifPattern.test(line)) {
				const ifStart = i;
				let braceDepth = (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
				let j = i + 1;
				let elseStart = -1;
				let elseEnd = -1;

				while (j < lines.length && braceDepth > 0) {
					const jline = lines[j];
					if (jline.trim().startsWith("} else {")) {
						elseStart = j;
						braceDepth = 1;
						j++;
						while (j < lines.length && braceDepth > 0) {
							braceDepth += (lines[j].match(/\{/g) ?? []).length - (lines[j].match(/\}/g) ?? []).length;
							j++;
						}
						elseEnd = j - 1;
						break;
					}
					braceDepth += (jline.match(/\{/g) ?? []).length - (jline.match(/\}/g) ?? []).length;
					j++;
				}

				if (elseStart !== -1 && elseEnd !== -1) {
					const ifBodyLines = elseStart - ifStart - 1;
					const elseBodyLines = elseEnd - elseStart - 1;
					if (ifBodyLines > 0 && elseBodyLines > 0 && ifBodyLines <= 5 && elseBodyLines <= 5) {
						candidates.push([ifStart, elseStart, elseEnd]);
					}
				}
				i = j;
			} else {
				i++;
			}
		}

		if (candidates.length === 0) return [content, { lineNumber: 0, originalSnippet: "", mutatedSnippet: "" }];

		const [ifStart, elseStart, elseEnd] = randomChoice(candidates, rng);
		const ifBody = lines.slice(ifStart + 1, elseStart);
		const elseBody = lines.slice(elseStart + 1, elseEnd);

		const newLines = [
			...lines.slice(0, ifStart + 1),
			...elseBody,
			lines[elseStart],
			...ifBody,
			...lines.slice(elseEnd),
		];
		return [
			newLines.join("\n"),
			{
				lineNumber: ifStart + 1,
				originalSnippet: "if/else branches",
				mutatedSnippet: "[swapped]",
			},
		];
	}
}

class RemoveEarlyReturnMutation extends BaseMutation {
	name = "remove-early-return";
	category = "structural";
	fixHint =
		"Restore the missing guard clause (if statement with early return). Add back the exact 3-line pattern: if condition, return statement, closing brace.";
	description = "A guard clause (early return) was removed.";

	private guardPattern = /^(?<indent>\s*)if\s*\([^)]+\)\s*\{\s*$/;
	private returnPattern = /^\s*return\b/;

	canApply(content: string): boolean {
		const lines = content.split("\n");
		for (let i = 0; i < lines.length - 2; i++) {
			if (this.isGuardClause(lines, i)) return true;
		}
		return false;
	}

	private isGuardClause(lines: string[], i: number): boolean {
		if (!this.guardPattern.test(lines[i])) return false;
		if (i + 2 >= lines.length) return false;
		if (!this.returnPattern.test(lines[i + 1])) return false;
		if (lines[i + 2].trim() !== "}") return false;
		return true;
	}

	mutate(content: string, rng: () => number): [string, MutationInfo] {
		const lines = content.split("\n");
		const candidates: number[] = [];
		for (let i = 0; i < lines.length - 2; i++) {
			if (this.isGuardClause(lines, i)) candidates.push(i);
		}

		if (candidates.length === 0) return [content, { lineNumber: 0, originalSnippet: "", mutatedSnippet: "" }];

		const i = randomChoice(candidates, rng);
		const removedLines = lines.slice(i, i + 3);
		const newLines = [...lines.slice(0, i), ...lines.slice(i + 3)];
		return [
			newLines.join("\n"),
			{
				lineNumber: i + 1,
				originalSnippet: removedLines.map((l) => l.trim()).join("\n"),
				mutatedSnippet: "[removed]",
			},
		];
	}
}

class SwapNamedImportsMutation extends BaseMutation {
	name = "swap-named-imports";
	category = "import";
	fixHint =
		"Swap ONLY the two imported names that are in the wrong order. Do not reorder other imports or modify other import statements.";
	description = "Two named imports are swapped in a destructuring import.";

	private importPattern = /import\s*\{(?<imports>[^}]+)\}\s*from\s*['"]/;

	canApply(content: string): boolean {
		const regex = new RegExp(this.importPattern.source, "g");
		let match: RegExpExecArray | null;
		while ((match = regex.exec(content)) !== null) {
			const imports = match.groups?.imports ?? "";
			const parts = imports
				.split(",")
				.map((p) => p.trim())
				.filter(Boolean);
			const simpleParts = parts.filter((p) => !p.includes(" as ") && /^\w+$/.test(p));
			if (simpleParts.length >= 2) return true;
		}
		return false;
	}

	mutate(content: string, rng: () => number): [string, MutationInfo] {
		const lines = content.split("\n");
		const candidates: Array<[number, number, number, string, string]> = [];

		for (let lineNumber = 1; lineNumber <= lines.length; lineNumber++) {
			const line = lines[lineNumber - 1];
			const regex = new RegExp(this.importPattern.source, "g");
			let match: RegExpExecArray | null;
			while ((match = regex.exec(line)) !== null) {
				const importsStr = match.groups?.imports ?? "";
				const parts = importsStr.split(",").map((p) => p.trim());
				const simpleIndices = parts
					.map((p, idx) => ({ p, idx }))
					.filter(({ p }) => p && !p.includes(" as ") && /^\w+$/.test(p))
					.map(({ idx }) => idx);

				if (simpleIndices.length >= 2) {
					const [i, j] = randomSample(simpleIndices, 2, rng);
					const newParts = [...parts];
					[newParts[i], newParts[j]] = [newParts[j], newParts[i]];
					const newImports = newParts.join(", ");
					const start = match.index + match[0].indexOf("{") + 1;
					const end = start + importsStr.length;
					candidates.push([lineNumber, start, end, importsStr, newImports]);
				}
			}
		}

		if (candidates.length === 0) return [content, { lineNumber: 0, originalSnippet: "", mutatedSnippet: "" }];

		const [lineNumber, start, end, original, replacement] = randomChoice(candidates, rng);
		const line = lines[lineNumber - 1];
		lines[lineNumber - 1] = line.slice(0, start) + replacement + line.slice(end);
		return [
			lines.join("\n"),
			{
				lineNumber,
				originalSnippet: original.trim(),
				mutatedSnippet: replacement.trim(),
			},
		];
	}
}

class DeleteStatementMutation extends BaseMutation {
	name = "delete-statement";
	category = "structural";
	fixHint = "Restore the deleted statement.";
	description = "A critical statement was deleted from the code.";

	private statementPattern = /^\s*(?:(?:const|let|var)\s+\w+\s*=.+;|\w+\s*\+=.+;|\w+\s*-=.+;|\w+\s*=\s*\w+.+;)\s*$/;

	canApply(content: string): boolean {
		return content.split("\n").some((line) => this.statementPattern.test(line));
	}

	mutate(content: string, rng: () => number): [string, MutationInfo] {
		const lines = content.split("\n");
		const candidates: number[] = [];
		for (let i = 0; i < lines.length; i++) {
			if (this.statementPattern.test(lines[i])) {
				if (!lines[i].includes("//") && !lines[i].includes("/*")) {
					candidates.push(i);
				}
			}
		}

		if (candidates.length === 0) return [content, { lineNumber: 0, originalSnippet: "", mutatedSnippet: "" }];

		const i = randomChoice(candidates, rng);
		const deleted = lines[i];
		const newLines = [...lines.slice(0, i), ...lines.slice(i + 1)];
		return [
			newLines.join("\n"),
			{
				lineNumber: i + 1,
				originalSnippet: deleted.trim(),
				mutatedSnippet: "[deleted]",
			},
		];
	}
}

class OffByOneMutation extends BaseMutation {
	name = "off-by-one";
	category = "literal";
	fixHint = "Fix the off-by-one error in the numeric literal or comparison.";
	description = "A numeric boundary has an off-by-one error.";

	private patterns: Array<[RegExp, (m: RegExpExecArray) => string]> = [
		[/(?<=[\s(,=<>])0(?=[\s),;])/, () => "1"],
		[/(?<=[\s(,=<>])1(?=[\s),;])/, () => "0"],
		[/\.length\s*-\s*1(?=[\s),;\]])/, () => ".length - 2"],
		[/\.length\s*-\s*2(?=[\s),;\]])/, () => ".length - 1"],
		[/<\s*(\w+\.length)/, (m) => `<= ${m[1]}`],
		[/<=\s*(\w+\.length)/, (m) => `< ${m[1]}`],
	];

	canApply(content: string): boolean {
		return this.patterns.some(([pattern]) => pattern.test(content));
	}

	mutate(content: string, rng: () => number): [string, MutationInfo] {
		const lines = content.split("\n");
		const candidates: Candidate[] = [];

		for (let lineNumber = 1; lineNumber <= lines.length; lineNumber++) {
			const line = lines[lineNumber - 1];
			if (isCommented(line, 0)) continue;
			const lineLower = line.toLowerCase();
			if (
				!lineLower.includes("for") &&
				!lineLower.includes("while") &&
				!lineLower.includes("if") &&
				!line.includes("[")
			) {
				continue;
			}

			for (const [pattern, replacementFn] of this.patterns) {
				const regex = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
				let match: RegExpExecArray | null;
				while ((match = regex.exec(line)) !== null) {
					if (isCommented(line, match.index)) continue;
					const original = match[0];
					const replacement = replacementFn(match);
					candidates.push({
						lineNumber,
						start: match.index,
						end: match.index + original.length,
						original,
						replacement,
					});
				}
			}
		}

		if (candidates.length === 0) return [content, { lineNumber: 0, originalSnippet: "", mutatedSnippet: "" }];

		const candidate = randomChoice(candidates, rng);
		const info = applyCandidate(lines, candidate);
		return [lines.join("\n"), info];
	}
}

export const ALL_MUTATIONS: Mutation[] = [
	new SwapComparisonMutation(),
	new SwapEqualityMutation(),
	new SwapLogicalMutation(),
	new RemoveNegationMutation(),
	new SwapIncDecMutation(),
	new SwapArithmeticMutation(),
	new BooleanLiteralFlipMutation(),
	new OptionalChainRemovalMutation(),
	new CallArgumentSwapMutation(),
	new NullishCoalescingSwapMutation(),
	new RegexQuantifierSwapMutation(),
	new UnicodeHyphenMutation(),
	new IdentifierMultiEditMutation(),
	new DuplicateLineLiteralFlipMutation(),
	new SwapAdjacentLinesMutation(),
	new SwapIfElseBranchesMutation(),
	new RemoveEarlyReturnMutation(),
	new SwapNamedImportsMutation(),
	new DeleteStatementMutation(),
	new OffByOneMutation(),
];

export const CATEGORY_MAP: Record<string, string[]> = {
	operator: ALL_MUTATIONS.filter((m) => m.category === "operator").map((m) => m.name),
	literal: ALL_MUTATIONS.filter((m) => m.category === "literal").map((m) => m.name),
	access: ALL_MUTATIONS.filter((m) => m.category === "access").map((m) => m.name),
	call: ALL_MUTATIONS.filter((m) => m.category === "call").map((m) => m.name),
	regex: ALL_MUTATIONS.filter((m) => m.category === "regex").map((m) => m.name),
	unicode: ALL_MUTATIONS.filter((m) => m.category === "unicode").map((m) => m.name),
	identifier: ALL_MUTATIONS.filter((m) => m.category === "identifier").map((m) => m.name),
	duplicate: ALL_MUTATIONS.filter((m) => m.category === "duplicate").map((m) => m.name),
	structural: ALL_MUTATIONS.filter((m) => m.category === "structural").map((m) => m.name),
	import: ALL_MUTATIONS.filter((m) => m.category === "import").map((m) => m.name),
};
