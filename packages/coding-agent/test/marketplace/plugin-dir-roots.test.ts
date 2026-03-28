import { describe, expect, it } from "bun:test";
import { buildPluginDirRoot } from "@oh-my-pi/pi-coding-agent/discovery/plugin-dir-roots";

describe("buildPluginDirRoot", () => {
	it("builds root with manifest name", () => {
		const root = buildPluginDirRoot("/path/to/my-plugin", "custom-name");
		expect(root).toEqual({
			id: "custom-name@__local__",
			marketplace: "__local__",
			plugin: "custom-name",
			version: "local",
			path: "/path/to/my-plugin",
			scope: "user",
		});
	});

	it("falls back to directory basename when no manifest name", () => {
		const root = buildPluginDirRoot("/path/to/my-plugin");
		expect(root.plugin).toBe("my-plugin");
		expect(root.id).toBe("my-plugin@__local__");
	});

	it("falls back to directory basename when manifest name is undefined", () => {
		const root = buildPluginDirRoot("/some/dir/cool-plugin", undefined);
		expect(root.plugin).toBe("cool-plugin");
		expect(root.id).toBe("cool-plugin@__local__");
	});

	it("uses __local__ marketplace", () => {
		const root = buildPluginDirRoot("/any/path", "test");
		expect(root.marketplace).toBe("__local__");
	});

	it("uses local version string", () => {
		const root = buildPluginDirRoot("/any/path", "test");
		expect(root.version).toBe("local");
	});

	it("sets scope to user", () => {
		const root = buildPluginDirRoot("/any/path", "test");
		expect(root.scope).toBe("user");
	});

	it("preserves absolute path", () => {
		const root = buildPluginDirRoot("/absolute/path/to/plugin", "test");
		expect(root.path).toBe("/absolute/path/to/plugin");
	});

	it("constructs id as pluginName@__local__", () => {
		const root = buildPluginDirRoot("/p", "my-tool");
		expect(root.id).toBe("my-tool@__local__");
	});
});
