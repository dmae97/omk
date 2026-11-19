import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	dialects,
	inventory,
	preservationHarness,
	repoRoot,
	runSelected,
} from "./fixtures/native-extension-harness.ts";

describe.each(dialects)("example extension contract (%s)", (dialect) => {
	const harness = preservationHarness();
	const rows = inventory.entries.filter((row) => row.scope === "example");
	for (const row of rows) {
		it(`${row.id} exact reviewed registry (not feature acceptance)`, async () => {
			await harness.load(row, dialect);
		});
		if (row.selected)
			it(`${row.id} selected deterministic behavior`, async () => {
				await runSelected(row, await harness.load(row, dialect), harness);
			});
	}
	async function load(name: string) {
		const row = rows.find((row) => row.id === `packages/coding-agent/examples/extensions/${name}`)!;
		return harness.load(row, dialect);
	}
	it("dynamic-tools actual session handler registers and executes echo_session", async () => {
		const result = await load("dynamic-tools.ts");
		const extension = result.extensions[0];
		const { ctx, notify } = harness.context(result);
		await extension.handlers.get("session_start")![0]({ type: "session_start" }, ctx);
		expect([...extension.tools.keys()]).toEqual(["echo_session"]);
		const output = await extension.tools
			.get("echo_session")!
			.definition.execute("echo", { message: "fixture" }, undefined, undefined, ctx);
		expect(output).toMatchObject({
			content: [{ type: "text", text: "[session] fixture" }],
			details: { tool: "echo_session", prefix: "[session] " },
		});
		await extension.commands.get("add-echo-tool")!.handler("BAD NAME", ctx);
		expect([...extension.tools.keys()]).toEqual(["echo_session"]);
		expect(notify).toHaveBeenLastCalledWith(expect.stringContaining("Usage:"), "warning");
	});
	it("dynamic-resources returns actual shipped skill, prompt and theme paths", async () => {
		const result = await load("dynamic-resources/index.ts");
		const found = await result.extensions[0].handlers.get("resources_discover")![0](
			{ type: "resources_discover", cwd: harness.cwd } as never,
			harness.context(result).ctx,
		);
		expect(found).toEqual({
			skillPaths: [join(repoRoot, "packages/coding-agent/examples/extensions/dynamic-resources/SKILL.md")],
			promptPaths: [join(repoRoot, "packages/coding-agent/examples/extensions/dynamic-resources/dynamic.md")],
			themePaths: [join(repoRoot, "packages/coding-agent/examples/extensions/dynamic-resources/dynamic.json")],
		});
	});
	it("provider-payload appends only synthetic request and response data to isolated cwd", async () => {
		const result = await load("provider-payload.ts");
		const extension = result.extensions[0];
		const { ctx } = harness.context(result);
		await extension.handlers.get("before_provider_request")![0](
			{ type: "before_provider_request", payload: { fixture: 17 } } as never,
			ctx,
		);
		await extension.handlers.get("after_provider_response")![0](
			{ type: "after_provider_response", status: 200, headers: { fixture: "local" } } as never,
			ctx,
		);
		expect(readFileSync(join(harness.cwd, ".omk/provider-payload.log"), "utf8")).toBe(
			'{\n  "fixture": 17\n}\n\n[200] {"fixture":"local"}\n\n',
		);
	});
	it("message-renderer runs its real plain-content fallback without a terminal", async () => {
		const result = await load("message-renderer.ts");
		const renderer = result.extensions[0].messageRenderers.get("status-update")!;
		const theme = {
			fg: (_color: string, text: string) => text,
			bg: (_color: string, text: string) => text,
			bold: (text: string) => text,
		};
		const component = renderer(
			{ role: "custom", customType: "status-update", content: "fixture status", display: true, timestamp: 0 },
			{ expanded: false },
			theme as never,
		);
		if (!component) throw new Error("The actual status-update renderer returned no component");
		expect(component.render(80).join("\n")).toContain("fixture status");
	});
	it("event-bus delivers a real command event once and disposal removes the listener", async () => {
		const result = await load("event-bus.ts");
		const { ctx, notify } = harness.context(result);
		const extension = result.extensions[0];
		for (const handler of extension.handlers.get("session_start")!) await handler({ type: "session_start" }, ctx);
		expect(notify).toHaveBeenCalledExactlyOnceWith("Event from event-bus-example: Session started", "info");
		notify.mockClear();
		await extension.commands.get("emit")!.handler("fixture", ctx);
		expect(notify).toHaveBeenCalledExactlyOnceWith("Event from /emit command: fixture", "info");
		for (const unsubscribe of extension.eventBusSubscriptions ?? []) unsubscribe();
		await extension.commands.get("emit")!.handler("after disposal", ctx);
		expect(notify).toHaveBeenCalledTimes(1);
	});
	it("keeps 79 exact identities distinct from behavior and platform acceptance", () => {
		expect(rows).toHaveLength(79);
		for (const row of rows)
			expect(row.unverified.every((item) => item.status === "UNVERIFIED" && item.reason.length > 0)).toBe(true);
	});
});
