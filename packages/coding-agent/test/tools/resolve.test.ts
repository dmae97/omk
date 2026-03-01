import { describe, expect, it } from "bun:test";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { getThemeByName } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { PendingActionStore } from "@oh-my-pi/pi-coding-agent/tools/pending-action";
import { ResolveTool, resolveToolRenderer } from "@oh-my-pi/pi-coding-agent/tools/resolve";
import { sanitizeText } from "@oh-my-pi/pi-natives";

function createSession(pendingActionStore?: PendingActionStore): ToolSession {
	return {
		cwd: "/tmp",
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated(),
		pendingActionStore,
	};
}

function getText(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content.find(part => part.type === "text")?.text ?? "";
}

describe("ResolveTool", () => {
	it("requires action and reason in schema", () => {
		const tool = new ResolveTool(createSession(new PendingActionStore()));
		const schema = tool.parameters as { required?: string[] };
		expect(schema.required).toEqual(["action", "reason"]);
	});

	it("errors when there is no pending action", async () => {
		const tool = new ResolveTool(createSession(new PendingActionStore()));
		await expect(tool.execute("call-none", { action: "apply", reason: "looks correct" })).rejects.toThrow(
			"No pending action to resolve. Nothing to apply or discard.",
		);
	});

	it("discards pending action and clears store", async () => {
		const pendingActionStore = new PendingActionStore();
		let rejectedReason: string | undefined;
		pendingActionStore.push({
			label: "AST Edit: 2 replacements in 1 file",
			sourceToolName: "ast_edit",
			apply: async (_reason: string) => ({ content: [{ type: "text", text: "should not run" }] }),
			reject: async (reason: string) => {
				rejectedReason = reason;
				return { content: [{ type: "text", text: "Rejected pending preview." }] };
			},
		});
		const tool = new ResolveTool(createSession(pendingActionStore));
		const result = await tool.execute("call-discard", {
			action: "discard",
			reason: "Preview changed wrong callsites",
		});

		expect(getText(result)).toContain("Rejected pending preview.");
		expect(pendingActionStore.hasPending).toBe(false);
		expect(rejectedReason).toBe("Preview changed wrong callsites");
		expect(result.details).toEqual({
			action: "discard",
			reason: "Preview changed wrong callsites",
			sourceToolName: "ast_edit",
			label: "AST Edit: 2 replacements in 1 file",
		});
	});

	it("applies pending action and clears store", async () => {
		const pendingActionStore = new PendingActionStore();
		let applied = false;
		let appliedReason: string | undefined;
		pendingActionStore.push({
			label: "AST Edit: 1 replacement in 1 file",
			sourceToolName: "ast_edit",
			apply: async reason => {
				applied = true;
				appliedReason = reason;
				return { content: [{ type: "text", text: "Applied 1 replacement in 1 file." }] };
			},
		});

		const tool = new ResolveTool(createSession(pendingActionStore));
		const result = await tool.execute("call-apply", {
			action: "apply",
			reason: "Preview is correct",
		});

		expect(applied).toBe(true);
		expect(appliedReason).toBe("Preview is correct");
		expect(pendingActionStore.hasPending).toBe(false);
		expect(getText(result)).toContain("Applied 1 replacement in 1 file.");
		expect(result.details).toEqual({
			action: "apply",
			reason: "Preview is correct",
			sourceToolName: "ast_edit",
			label: "AST Edit: 1 replacement in 1 file",
		});
	});

	it("resolves pending actions in LIFO order", async () => {
		const pendingActionStore = new PendingActionStore();
		let firstApplied = false;
		let secondApplied = false;

		pendingActionStore.push({
			label: "First action",
			sourceToolName: "ast_edit",
			apply: async (_reason: string) => {
				firstApplied = true;
				return { content: [{ type: "text", text: "first" }] };
			},
		});
		pendingActionStore.push({
			label: "Second action",
			sourceToolName: "ast_edit",
			apply: async () => {
				secondApplied = true;
				return { content: [{ type: "text", text: "second" }] };
			},
		});

		const tool = new ResolveTool(createSession(pendingActionStore));
		const firstResult = await tool.execute("call-apply-1", { action: "apply", reason: "apply top" });
		expect(getText(firstResult)).toContain("second");
		expect(firstApplied).toBe(false);
		expect(secondApplied).toBe(true);
		expect(pendingActionStore.hasPending).toBe(true);

		const secondResult = await tool.execute("call-apply-2", { action: "apply", reason: "apply next" });
		expect(getText(secondResult)).toContain("first");
		expect(firstApplied).toBe(true);
		expect(pendingActionStore.hasPending).toBe(false);
	});
});

it("renders a highlighted apply summary", async () => {
	const theme = await getThemeByName("dark");
	expect(theme).toBeDefined();
	const uiTheme = theme!;

	const component = resolveToolRenderer.renderResult(
		{
			content: [{ type: "text", text: "Applied 2 replacements in 1 file." }],
			details: {
				action: "apply",
				reason: "All replacements are correct",
				sourceToolName: "ast_edit",
				label: "AST Edit: 2 replacements in 1 file",
			},
		},
		{ expanded: false, isPartial: false },
		uiTheme,
	);

	const rendered = sanitizeText(component.render(90).join("\n"));
	expect(rendered).toContain("Accept: 2 replacements in 1 file");
	expect(rendered).toContain("AST Edit");
	expect(rendered).toContain("All replacements are correct");
	expect(rendered).not.toContain("Applied 2 replacements in 1 file.");
	expect(rendered).not.toContain("Decision");
	expect(rendered).not.toContain("┌");
});
