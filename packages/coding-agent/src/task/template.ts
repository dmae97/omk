import type { TaskItem } from "./types";

type RenderResult = {
	task: string;
	args: Record<string, string>;
	id: string;
	description: string;
};

export function renderTemplate(template: string, task: TaskItem): RenderResult {
	const { id, description, args } = task;

	let usedPlaceholder = false;
	const unknownArguments: string[] = [];
	let renderedTask = template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
		const value = args?.[key];
		if (value) {
			usedPlaceholder = true;
			return value;
		}
		switch (key) {
			case "id":
				usedPlaceholder = true;
				return id;
			case "description":
				usedPlaceholder = true;
				return description;
			default:
				unknownArguments.push(key);
				return `{{${key}}}`;
		}
	});

	if (unknownArguments.length > 0) {
		throw new Error(`Task "${id}" has unknown arguments: ${unknownArguments.join(", ")}`);
	}

	if (!usedPlaceholder) {
		renderedTask += `\n----------------------\n# ${id}\n${description}`;
	}
	return {
		task: renderedTask,
		args: { id, description, ...args },
		id,
		description,
	};
}
