import { renderPromptTemplate } from "../../../../config/prompt-templates";
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";
import ciGreenRequestTemplate from "../../../../prompts/ci-green-request.md" with { type: "text" };

async function getHeadTag(api: CustomCommandAPI): Promise<string | undefined> {
	const result = await api.exec("git", [
		"for-each-ref",
		"--points-at",
		"HEAD",
		"--sort=-version:refname",
		"--format=%(refname:strip=2)",
		"refs/tags",
	]);

	if (result.code !== 0 || result.killed) {
		return undefined;
	}

	const tag = result.stdout
		.split("\n")
		.map(line => line.trim())
		.find(Boolean);
	return tag || undefined;
}

export class GreenCommand implements CustomCommand {
	name = "green";
	description = "Generate a prompt to iterate on CI failures until the branch is green";

	constructor(private api: CustomCommandAPI) {}

	async execute(_args: string[], _ctx: HookCommandContext): Promise<string> {
		const headTag = await getHeadTag(this.api);
		return renderPromptTemplate(ciGreenRequestTemplate, { headTag });
	}
}
