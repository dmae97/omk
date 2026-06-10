import { describe, expect, test } from "vitest";
import { createOmkCommandBus } from "../src/omk-command-bus.ts";

describe("OMK command bus", () => {
	test("dispatches registered slash commands with event prefix", async () => {
		const bus = createOmkCommandBus();
		bus.registerHandler("status", async () => ({
			handled: true,
			events: [{ type: "status:ok", timestamp: "t" }],
			output: "ok",
		}));

		const result = await bus.dispatch({ kind: "slash", source: "cli", rawText: "/status" });

		expect(result.handled).toBe(true);
		expect(result.output).toBe("ok");
		expect(result.events.map((event) => event.type)).toEqual([
			"command:received",
			"command:identified",
			"command:dispatching",
			"status:ok",
		]);
		expect(bus.listCommands()).toEqual(["status"]);
	});

	test("reports unknown slash commands", async () => {
		const result = await createOmkCommandBus().dispatch({ kind: "slash", source: "cli", rawText: "/missing" });

		expect(result.handled).toBe(false);
		expect(result.output).toContain("Unknown command: /missing");
		expect(result.events.at(-1)?.type).toBe("command:unhandled");
	});

	test("classifies plain chat fallback risk", async () => {
		const result = await createOmkCommandBus().dispatch({
			kind: "chat",
			source: "cli",
			rawText: "implement the bridge",
		});

		expect(result.handled).toBe(false);
		expect(result.output).toBe("");
		expect(result.events.at(-1)).toMatchObject({ type: "command:fallback", data: { intent: "chat", risk: "write" } });
	});
});
