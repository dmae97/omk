import { expect, it } from "vitest";
import { fixture, type ResultDetails } from "./improvement-subagent-fixture.ts";

it.each(["unicode", "truncated"])("preserves the final attempt receipt in bounded execution (%s)", async (task) => {
	const env = await fixture();
	try {
		const result = await env.execute({ agent: "fixture", task, executionBudgetMs: 120_000, maxResumeAttempts: 0 });
		const single = (result.details as ResultDetails).results[0];
		expect(Boolean(result.isError), single.errorMessage).toBe(task === "truncated");
		expect(single.attemptId).toMatch(/^[0-9a-f-]{36}$/);
		expect(single.process?.terminationObserved).toBe(true);
		await expect(single.process?.settlement).resolves.toBeUndefined();
		expect(single.stream?.stdoutBytes).toBeGreaterThan(0);
		expect(single.stream?.stdoutDigest).toMatch(/^[0-9a-f]{64}$/);
		if (task === "truncated") expect(single.stream?.failure).toBe("subagent.stream.invalid_json");
		else expect(single.output).toBe("한글😀");
	} finally {
		await env.cleanup();
	}
});
