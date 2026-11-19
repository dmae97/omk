import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionRuntimeDiagnostic } from "../src/core/agent-session-runtime.ts";
import { collectSettingsDiagnostics, reportDiagnostics } from "../src/core/cli-diagnostics.ts";
import type { SettingsManager } from "../src/core/settings-manager.ts";

describe("cli-diagnostics", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("collectSettingsDiagnostics", () => {
		it("maps drained settings errors into warning diagnostics with context and scope", () => {
			const fakeManager = {
				drainErrors: () => [{ scope: "project", error: new Error("bad json") }],
			} as unknown as SettingsManager;

			const diagnostics = collectSettingsDiagnostics(fakeManager, "startup");
			expect(diagnostics).toEqual([
				{
					type: "warning",
					message: "(startup, project settings) bad json",
				},
			]);
		});

		it("returns an empty array when drainErrors returns no errors", () => {
			const fakeManager = {
				drainErrors: () => [],
			} as unknown as SettingsManager;

			expect(collectSettingsDiagnostics(fakeManager, "startup")).toEqual([]);
		});

		it("formats multiple errors across different scopes", () => {
			const fakeManager = {
				drainErrors: () => [
					{ scope: "user", error: new Error("invalid token") },
					{ scope: "local", error: new Error("unrecognized field") },
				],
			} as unknown as SettingsManager;

			const diagnostics = collectSettingsDiagnostics(fakeManager, "reload");
			expect(diagnostics).toEqual([
				{
					type: "warning",
					message: "(reload, user settings) invalid token",
				},
				{
					type: "warning",
					message: "(reload, local settings) unrecognized field",
				},
			]);
		});
	});

	describe("reportDiagnostics", () => {
		it("prints nothing when diagnostics list is empty", () => {
			const spy = vi.spyOn(console, "error").mockImplementation(() => {});
			reportDiagnostics([]);
			expect(spy).not.toHaveBeenCalled();
		});

		it("prefixes error diagnostics with Error:", () => {
			const spy = vi.spyOn(console, "error").mockImplementation(() => {});
			const diagnostics: AgentSessionRuntimeDiagnostic[] = [{ type: "error", message: "model unreachable" }];

			reportDiagnostics(diagnostics);
			expect(spy).toHaveBeenCalledTimes(1);
			expect(spy).toHaveBeenCalledWith(expect.stringContaining("Error: model unreachable"));
		});

		it("prefixes warning diagnostics with Warning:", () => {
			const spy = vi.spyOn(console, "error").mockImplementation(() => {});
			const diagnostics: AgentSessionRuntimeDiagnostic[] = [{ type: "warning", message: "quota low" }];

			reportDiagnostics(diagnostics);
			expect(spy).toHaveBeenCalledTimes(1);
			expect(spy).toHaveBeenCalledWith(expect.stringContaining("Warning: quota low"));
		});

		it("prefixes info diagnostics with Warning: as formatted by the CLI helper", () => {
			const spy = vi.spyOn(console, "error").mockImplementation(() => {});
			const diagnostics: AgentSessionRuntimeDiagnostic[] = [
				{ type: "info", message: "falling back to default provider" },
			];

			reportDiagnostics(diagnostics);
			expect(spy).toHaveBeenCalledTimes(1);
			expect(spy).toHaveBeenCalledWith(expect.stringContaining("Warning: falling back to default provider"));
		});

		it("prints multiple diagnostics sequentially in order", () => {
			const spy = vi.spyOn(console, "error").mockImplementation(() => {});
			const diagnostics: AgentSessionRuntimeDiagnostic[] = [
				{ type: "error", message: "first failure" },
				{ type: "warning", message: "second notice" },
			];

			reportDiagnostics(diagnostics);
			expect(spy).toHaveBeenCalledTimes(2);
			expect(spy).toHaveBeenNthCalledWith(1, expect.stringContaining("Error: first failure"));
			expect(spy).toHaveBeenNthCalledWith(2, expect.stringContaining("Warning: second notice"));
		});
	});
});
