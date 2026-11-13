import { describe, expect, it } from "vitest";
import { createEventBus } from "../src/core/event-bus.ts";
import {
	createExtensionRuntime,
	type EntryRenderer,
	type ExtensionAPI,
	loadExtensionFromFactory,
} from "../src/core/extensions/index.ts";

describe("optional extension entry registry", () => {
	it("initializes a missing registry when a legacy extension registers a renderer", async () => {
		let api!: ExtensionAPI;
		const extension = await loadExtensionFromFactory(
			(loaded) => {
				api = loaded;
			},
			process.cwd(),
			createEventBus(),
			createExtensionRuntime(),
		);
		delete extension.entryRenderers;
		const renderer: EntryRenderer = () => null;
		expect(() => api.registerEntryRenderer("test.legacy", renderer)).not.toThrow();
		const registry = extension.entryRenderers as Map<string, EntryRenderer> | undefined;
		expect(registry?.get("test.legacy")).toBe(renderer);
	});
});
