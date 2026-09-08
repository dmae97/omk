import { describe, expect, it, vi } from "vitest";
import { runAdaptOrchDoctorCli } from "../src/commands/adaptorch-doctor-cli.ts";

function capture() {
	const lines: string[] = [];
	return { lines, writeLine: (line: string) => lines.push(line) };
}

describe("AdaptOrch offline CRM handoff", () => {
	it.each([
		{},
		{ ADAPTORCH_API_KEY: "fixture-key", ADAPTORCH_API_URL: "https://localhost.invalid" },
		{ ADAPTORCH_API_KEY: "fixture-key", ADAPTORCH_API_URL: "http://unsafe.invalid" },
	])("prints links without contacting or validating the API for configuration %j", async (env) => {
		const { lines, writeLine } = capture();
		const fetch = vi.fn(async () => {
			throw new Error("Offline handoff must not use HTTP");
		});
		const result = await runAdaptOrchDoctorCli(["doctor", "adaptorch", "--links"], { env, writeLine, fetch });
		expect(result).toEqual({ handled: true, exitCode: 0 });
		expect(fetch).not.toHaveBeenCalled();
		const output = lines.join("\n");
		expect(output).toContain("https://adaptorch.com/app/signup?");
		expect(output).toContain("#pricing");
		expect(output).toContain("#bookDemo");
		expect(output).toContain("omk doctor adaptorch");
		expect(output).not.toContain("fixture-key");
		expect(output).not.toContain("unsafe.invalid");
	});

	it.each([
		["--links", "--json"],
		["--json", "--links"],
	])("emits a stable offline report for options %j", async (...options) => {
		const { lines, writeLine } = capture();
		await runAdaptOrchDoctorCli(["doctor", "adaptorch", ...options], { env: {}, writeLine });
		// Malformed CLI JSON must fail the test, not be caught and hidden.
		const report: unknown = JSON.parse(lines.join("\n"));
		expect(report).toMatchObject({
			mode: "links",
			networkAccess: false,
			accountRequired: false,
			links: {
				plans: expect.stringContaining("#pricing"),
				signup: expect.stringContaining("https://adaptorch.com/app/signup?"),
				contact: expect.stringContaining("#bookDemo"),
				claimBoundary: expect.stringContaining("/claim-boundary?"),
			},
		});
		expect(report).not.toHaveProperty("reachable");
		expect(report).not.toHaveProperty("subjectId");
	});

	it("never reads credentials when only links were requested", async () => {
		const env: NodeJS.ProcessEnv = {};
		Object.defineProperty(env, "ADAPTORCH_API_KEY", {
			get() {
				throw new Error("Credential access is forbidden in links mode");
			},
		});
		const { writeLine } = capture();
		const result = await runAdaptOrchDoctorCli(["doctor", "adaptorch", "--links"], { env, writeLine });
		expect(result.exitCode).toBe(0);
	});

	it("rejects unknown options instead of silently falling back to a live probe", async () => {
		const { writeLine } = capture();
		const fetch = vi.fn();
		const result = await runAdaptOrchDoctorCli(["doctor", "adaptorch", "--links", "--send"], { writeLine, fetch });
		expect(result.exitCode).toBe(2);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("advertises offline handoff when the API is not configured", async () => {
		const { lines, writeLine } = capture();
		const result = await runAdaptOrchDoctorCli(["doctor", "adaptorch"], { env: {}, writeLine });
		expect(result.exitCode).toBe(1);
		expect(lines.join("\n")).toContain("omk doctor adaptorch --links");
	});
});
