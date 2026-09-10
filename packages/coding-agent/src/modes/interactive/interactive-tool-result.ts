import { Text } from "omk-tui";

/** Interface for components that can be expanded/collapsed */
interface Expandable {
	setExpanded(expanded: boolean): void;
}

export function isExpandable(obj: unknown): obj is Expandable {
	return typeof obj === "object" && obj !== null && "setExpanded" in obj && typeof obj.setExpanded === "function";
}

export function disposeComponent(component: unknown): void {
	if (
		typeof component === "object" &&
		component !== null &&
		"dispose" in component &&
		typeof component.dispose === "function"
	) {
		component.dispose();
	}
}
type ToolExecutionContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

type ToolExecutionResult = {
	content: ToolExecutionContent[];
	details?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isToolExecutionContent(value: unknown): value is ToolExecutionContent {
	if (!isRecord(value)) return false;
	if (value.type === "text") return typeof value.text === "string";
	return value.type === "image" && typeof value.data === "string" && typeof value.mimeType === "string";
}

function isToolExecutionResult(value: unknown): value is ToolExecutionResult {
	return isRecord(value) && Array.isArray(value.content) && value.content.every(isToolExecutionContent);
}

export function normalizeToolExecutionResult(
	result: unknown,
	isError: boolean,
): ToolExecutionResult & { isError: boolean } {
	try {
		if (isToolExecutionResult(result)) {
			return { content: result.content, details: result.details, isError };
		}
	} catch {
		// Treat inaccessible or malformed extension payloads as invalid results.
	}

	return {
		content: [{ type: "text", text: "Tool returned an invalid result." }],
		isError: true,
	};
}

export class ExpandableText extends Text implements Expandable {
	private readonly getCollapsedText: () => string;
	private readonly getExpandedText: () => string;
	private expanded: boolean;

	constructor(
		getCollapsedText: () => string,
		getExpandedText: () => string,
		expanded = false,
		paddingX = 0,
		paddingY = 0,
	) {
		super(expanded ? getExpandedText() : getCollapsedText(), paddingX, paddingY);
		this.getCollapsedText = getCollapsedText;
		this.getExpandedText = getExpandedText;
		this.expanded = expanded;
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.setText(expanded ? this.getExpandedText() : this.getCollapsedText());
	}

	override invalidate(): void {
		this.setText(this.expanded ? this.getExpandedText() : this.getCollapsedText());
		super.invalidate();
	}
}
