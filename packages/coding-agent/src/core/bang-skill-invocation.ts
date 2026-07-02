export interface BangSkillRegistry {
	hasSkill(name: string): boolean;
}

export type BangInvocation =
	| { kind: "plain"; prompt: string }
	| { kind: "empty" }
	| { kind: "bash"; command: string; includeContext: boolean }
	| { kind: "skill"; skillName: string; prompt: string; activeSkillNames: readonly string[]; source: "bang" }
	| { kind: "unknownSkill"; skillName: string; prompt: string; source: "bang" };

export function parseBangInvocation(input: string, registry: BangSkillRegistry): BangInvocation {
	if (!input.startsWith("!")) {
		return { kind: "plain", prompt: input };
	}

	if (input.startsWith("!!")) {
		const command = input.slice(2).trim();
		return command ? { kind: "bash", command, includeContext: false } : { kind: "empty" };
	}

	const second = input[1];
	if (second === undefined) {
		return { kind: "plain", prompt: input };
	}

	if (/\s/.test(second)) {
		const command = input.slice(2).trim();
		return command ? { kind: "bash", command, includeContext: true } : { kind: "empty" };
	}

	const body = input.slice(1);
	if (body.startsWith("skill:")) {
		const explicit = body.slice("skill:".length);
		const { token: skillName, rest } = splitFirstToken(explicit);
		if (!skillName) {
			return { kind: "plain", prompt: input };
		}
		if (!registry.hasSkill(skillName)) {
			return { kind: "unknownSkill", skillName, prompt: rest, source: "bang" };
		}
		return {
			kind: "skill",
			skillName,
			prompt: rest,
			activeSkillNames: [skillName],
			source: "bang",
		};
	}

	const { token: skillName, rest } = splitFirstToken(body);
	if (!skillName) {
		return { kind: "plain", prompt: input };
	}
	if (registry.hasSkill(skillName)) {
		return {
			kind: "skill",
			skillName,
			prompt: rest,
			activeSkillNames: [skillName],
			source: "bang",
		};
	}

	const command = body.trim();
	return command ? { kind: "bash", command, includeContext: true } : { kind: "empty" };
}

function splitFirstToken(input: string): { token: string; rest: string } {
	const trimmed = input.trimStart();
	const match = /^([^\s]+)(?:\s+([\s\S]*))?$/.exec(trimmed);
	if (!match) {
		return { token: "", rest: "" };
	}
	return { token: match[1] ?? "", rest: match[2]?.trimStart() ?? "" };
}
