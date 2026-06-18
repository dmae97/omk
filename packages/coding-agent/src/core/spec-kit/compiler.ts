import { createHash } from "node:crypto";

export interface SpecRequirement {
	id: string;
	title: string;
	priority: string;
	acceptance: string[];
}

export interface SpecTask {
	id: string;
	title: string;
	completed: boolean;
	role?: string;
	deps: string[];
	lane?: string;
	files: string[];
	verify?: string;
	gate?: string;
	risk?: string;
	requirementIds: string[];
}

export interface CompiledHarnessDagNode {
	id: string;
	title: string;
	dependsOn: string[];
	files: string[];
	verify?: string;
	gate?: string;
	requirementIds: string[];
}

export interface TraceabilityEntry {
	requirementId: string;
	taskIds: string[];
	verifyCommands: string[];
	evidenceGates: string[];
}

export interface EvidenceManifestEntry {
	taskId: string;
	gate?: string;
	verify?: string;
	files: string[];
	evidencePaths: string[];
}

export interface CompiledSpecKit {
	requirements: SpecRequirement[];
	tasks: SpecTask[];
	compiledDag: CompiledHarnessDagNode[];
	traceability: TraceabilityEntry[];
	evidenceManifest: EvidenceManifestEntry[];
	specHash: string;
}

export interface SpecKitValidationResult {
	ok: boolean;
	errors: string[];
	warnings: string[];
}

export interface SpecKitCompileInput {
	specMarkdown: string;
	tasksMarkdown: string;
	planMarkdown?: string;
	templateMarkdown?: string;
}

function stableJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	return `{${Object.keys(value)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
		.join(",")}}`;
}

function hashText(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function parseBracketList(value: string | undefined): string[] {
	if (!value) return [];
	const trimmed = value.trim();
	if (trimmed === "none" || trimmed === "[]") return [];
	if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
		return trimmed
			.split(",")
			.map((entry) => entry.trim())
			.filter(Boolean);
	}
	return trimmed
		.slice(1, -1)
		.split(",")
		.map((entry) => entry.trim().replace(/^`|`$/g, ""))
		.filter(Boolean);
}

function extractSection(markdown: string, heading: string): string {
	const start = markdown.indexOf(heading);
	if (start < 0) return "";
	const rest = markdown.slice(start + heading.length);
	const next = rest.search(/\n#{2,3}\s/);
	return next < 0 ? rest : rest.slice(0, next);
}

export function parseSpecRequirements(markdown: string): SpecRequirement[] {
	const matches = [...markdown.matchAll(/^###\s+(R\d+)\s+[—-]\s+(.+?)(?:\s+\((P\d+)\))?\s*$/gm)];
	return matches.map((match, index) => {
		const id = match[1]!;
		const nextIndex = index + 1 < matches.length ? matches[index + 1]!.index! : markdown.length;
		const body = markdown.slice(match.index!, nextIndex);
		const acceptance = extractSection(body, "**Acceptance**")
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => /^\d+\./.test(line))
			.map((line) => line.replace(/^\d+\.\s*/, ""));
		return {
			id,
			title: match[2]!.trim(),
			priority: match[3] ?? "P0",
			acceptance,
		};
	});
}

export function parseSpecTasks(markdown: string): SpecTask[] {
	const lines = markdown.split("\n");
	const tasks: SpecTask[] = [];
	let current: SpecTask | undefined;
	for (const line of lines) {
		const taskMatch = line.match(/^- \[([ xX])] (HCP-\d+)\s+(.+)$/);
		if (taskMatch) {
			current = {
				id: taskMatch[2]!,
				title: taskMatch[3]!.trim(),
				completed: taskMatch[1]!.toLowerCase() === "x",
				deps: [],
				files: [],
				requirementIds: [],
			};
			tasks.push(current);
			continue;
		}
		if (!current) continue;
		const metaMatch = line.match(/^\s*>\s*([A-Za-z]+):\s*(.+)$/);
		if (!metaMatch) continue;
		const key = metaMatch[1]!;
		const value = metaMatch[2]!.trim();
		switch (key) {
			case "role":
				current.role = value;
				break;
			case "deps":
				current.deps = parseBracketList(value);
				break;
			case "lane":
				current.lane = value;
				break;
			case "files":
				current.files = parseBracketList(value);
				break;
			case "verify":
				current.verify = value.replace(/^`|`$/g, "");
				break;
			case "gate":
				current.gate = value;
				break;
			case "risk":
				current.risk = value;
				break;
			case "requirementIds":
				current.requirementIds = parseBracketList(value);
				break;
		}
	}
	return tasks;
}

function detectCycle(tasks: SpecTask[]): string | undefined {
	const byId = new Map(tasks.map((task) => [task.id, task]));
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (id: string, path: string[]): string | undefined => {
		if (visiting.has(id)) return [...path, id].join(" -> ");
		if (visited.has(id)) return undefined;
		visiting.add(id);
		for (const dep of byId.get(id)?.deps ?? []) {
			const cycle = visit(dep, [...path, id]);
			if (cycle) return cycle;
		}
		visiting.delete(id);
		visited.add(id);
		return undefined;
	};
	for (const task of tasks) {
		const cycle = visit(task.id, []);
		if (cycle) return cycle;
	}
	return undefined;
}

function findHardcodedAuthority(input: SpecKitCompileInput): string[] {
	const combined = [
		input.specMarkdown,
		input.tasksMarkdown,
		input.planMarkdown ?? "",
		input.templateMarkdown ?? "",
	].join("\n");
	const violations: string[] = [];
	if (/^\s*-\s+\*\*Authority\*\*:\s*.*Kimi is final writer/im.test(combined)) {
		violations.push("Provider-hardcoded authority: Kimi is final writer");
	}
	return violations;
}

function extractEvidencePathsFromText(value: string | undefined): string[] {
	if (!value) return [];
	return [...value.matchAll(/\.omk\/[\w./-]+/g)].map((match) => match[0]!.replace(/[),.;:]+$/, ""));
}

export function collectSpecEvidencePaths(tasks: readonly SpecTask[]): string[] {
	const paths: string[] = [];
	const seen = new Set<string>();
	for (const task of tasks) {
		for (const path of [
			...task.files.filter((file) => file.startsWith(".omk/")),
			...extractEvidencePathsFromText(task.verify),
		]) {
			if (seen.has(path)) continue;
			seen.add(path);
			paths.push(path);
		}
	}
	return paths;
}

export function validateTaskCompletionDependencies(tasks: readonly SpecTask[]): string[] {
	const errors: string[] = [];
	const byId = new Map(tasks.map((task) => [task.id, task]));
	for (const task of tasks) {
		if (!task.completed) continue;
		for (const dep of task.deps) {
			const dependency = byId.get(dep);
			if (dependency && !dependency.completed) {
				errors.push(`Task ${task.id} is completed but dependency ${dep} is incomplete`);
			}
		}
	}
	return errors;
}

export function validateSpecKit(input: SpecKitCompileInput, compiled?: CompiledSpecKit): SpecKitValidationResult {
	const spec = compiled ?? compileSpecKit(input);
	const errors: string[] = [];
	const warnings: string[] = [];
	const requirementIds = new Set(spec.requirements.map((requirement) => requirement.id));
	const taskIds = new Set<string>();
	for (const hardcoded of findHardcodedAuthority(input)) errors.push(hardcoded);
	for (const task of spec.tasks) {
		if (taskIds.has(task.id)) errors.push(`Duplicate task id: ${task.id}`);
		taskIds.add(task.id);
		if (!task.gate) errors.push(`Task ${task.id} missing evidence gate`);
		if (!task.verify) errors.push(`Task ${task.id} missing verify command`);
		if (task.requirementIds.length === 0) errors.push(`Task ${task.id} missing requirementIds`);
		for (const dep of task.deps) {
			if (!taskIds.has(dep) && !spec.tasks.some((candidate) => candidate.id === dep)) {
				errors.push(`Task ${task.id} depends on missing task ${dep}`);
			}
		}
		for (const requirementId of task.requirementIds) {
			if (!requirementIds.has(requirementId)) errors.push(`Task ${task.id} references missing ${requirementId}`);
		}
	}
	errors.push(...validateTaskCompletionDependencies(spec.tasks));
	const cycle = detectCycle(spec.tasks);
	if (cycle) errors.push(`Task DAG has cycle: ${cycle}`);
	for (const requirement of spec.requirements) {
		const linked = spec.tasks.filter((task) => task.requirementIds.includes(requirement.id));
		if (linked.length === 0) errors.push(`Requirement ${requirement.id} has no linked task`);
		if (requirement.acceptance.length === 0)
			warnings.push(`Requirement ${requirement.id} has no parsed acceptance items`);
	}
	return { ok: errors.length === 0, errors, warnings };
}

export function compileSpecKit(input: SpecKitCompileInput): CompiledSpecKit {
	const requirements = parseSpecRequirements(input.specMarkdown);
	const tasks = parseSpecTasks(input.tasksMarkdown);
	const compiledDag = tasks.map((task) => ({
		id: task.id,
		title: task.title,
		dependsOn: task.deps,
		files: task.files,
		verify: task.verify,
		gate: task.gate,
		requirementIds: task.requirementIds,
	}));
	const traceability = requirements.map((requirement) => {
		const linkedTasks = tasks.filter((task) => task.requirementIds.includes(requirement.id));
		return {
			requirementId: requirement.id,
			taskIds: linkedTasks.map((task) => task.id),
			verifyCommands: linkedTasks.flatMap((task) => (task.verify ? [task.verify] : [])),
			evidenceGates: linkedTasks.flatMap((task) => (task.gate ? [task.gate] : [])),
		};
	});
	const evidenceManifest = tasks.map((task) => ({
		taskId: task.id,
		gate: task.gate,
		verify: task.verify,
		files: task.files,
		evidencePaths: collectSpecEvidencePaths([task]),
	}));
	const hashInput = stableJson({ requirements, compiledDag, traceability, evidenceManifest });
	return {
		requirements,
		tasks,
		compiledDag,
		traceability,
		evidenceManifest,
		specHash: hashText(hashInput),
	};
}
