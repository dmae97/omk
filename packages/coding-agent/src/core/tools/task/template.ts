export function renderTemplate(template: string, vars: Record<string, string>): string {
	return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => vars[key] ?? `{{${key}}}`);
}

export function extractPlaceholders(template: string): string[] {
	return [...template.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]);
}

export function validateTaskTemplate(
	context: string | undefined,
	tasks: Array<{ id: string; vars: Record<string, string> }>,
): string | null {
	const template = context ?? "";
	const placeholders = extractPlaceholders(template);

	if (tasks.length > 1 && placeholders.length === 0) {
		return "Multi-task invocations require {{placeholders}} in context";
	}

	if (placeholders.length > 0) {
		for (const task of tasks) {
			const missing = placeholders.filter((placeholder) => !(placeholder in task.vars));
			if (missing.length > 0) {
				return `Task "${task.id}" missing vars: ${missing.join(", ")}`;
			}
		}
	}

	if (tasks.length > 1 && placeholders.length > 0) {
		const withoutPlaceholders = template.replace(/\{\{\w+\}\}/g, "").trim();
		if (withoutPlaceholders.length < 50) {
			return "Context must contain instructions (50+ chars) around {{placeholders}}";
		}
	}

	return null;
}
