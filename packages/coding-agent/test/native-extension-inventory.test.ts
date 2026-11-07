import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { inventory, preservationHarness } from "./fixtures/native-extension-harness.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const script = fileURLToPath(new URL("../../../scripts/native-extension-inventory.mjs", import.meta.url));

function check(ledger: unknown) {
	return spawnSync(process.execPath, [script, "--check", "--stdin"], {
		cwd: root,
		input: JSON.stringify(ledger),
		encoding: "utf8",
	});
}

describe("public extension inventory drift controls", () => {
	it("accepts only the reviewed 89-entry and separate builtin identity/schema ledger", () => {
		const result = spawnSync(process.execPath, [script, "--check"], { cwd: root, encoding: "utf8" });
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toContain("NOT feature acceptance");
	});
	it("rejects a missing entry instead of certifying a load count", () => {
		const result = check({ entries: [] });
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("identity");
	});
	it("rejects same-count identity substitution", () => {
		const discovered = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
		expect(discovered.status).toBe(0);
		const ledger = JSON.parse(discovered.stdout);
		ledger.entries[0].id = ".omk/extensions/does-not-exist.ts";
		const result = check(ledger);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("identity");
	});
	it("rejects feature evidence without cases or an explicit unverified reason", () => {
		const ledger = structuredClone(inventory);
		ledger.entries[0].features = [{ family: "ui" }];
		expect(check(ledger).stderr).toContain("feature evidence or UNVERIFIED reason missing");
		expect(check(ledger).status).toBe(1);
	});
	it("rejects omission of a builtin instead of folding it into the static entry count", () => {
		const ledger = structuredClone(inventory);
		ledger.builtins.pop();
		const result = check(ledger);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("builtins: exact identity set differs");
	});
	it("records excluded tests/helpers and includes the intentional working-message demo", () => {
		const discovered = JSON.parse(spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" }).stdout);
		expect(discovered.excluded).toContainEqual({
			id: ".omk/extensions/telegram-notify/index.test.ts",
			reason: "test, not declared entry",
		});
		expect(discovered.excluded).toContainEqual({
			id: ".omk/extensions/powershell-compat/translate.ts",
			reason: "helper or non-autoload suffix, not declared entry",
		});
		expect(discovered.entries.some((row: { id: string }) => row.id.endsWith("/working-message-test.ts"))).toBe(true);
	});
	it("has no home-reader, factory import or alternate-root escape hatch", () => {
		const source = readFileSync(script, "utf8");
		expect(source).not.toMatch(/homedir\(|getAgentDir\(|loadExtensions\(|process\.env\.HOME/);
		const result = spawnSync(process.execPath, [script, "--root", "outside"], { cwd: root, encoding: "utf8" });
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("roots cannot be overridden");
	});
});

describe("native owned-entry tracer", () => {
	const harness = preservationHarness();
	it("loads the reviewed hello factory and executes its real typed greeting tool", async () => {
		const row = inventory.entries.find((row) => row.id.endsWith("/hello.ts"))!;
		const result = await harness.load(row, "omk");
		const tool = result.extensions[0].tools.get("hello")!.definition;
		expect(tool.parameters).toMatchObject({
			type: "object",
			required: ["name"],
			properties: { name: { type: "string" } },
		});
		expect(await tool.execute("tracer", { name: "Ada" }, undefined, undefined, harness.context(result).ctx)).toEqual({
			content: [{ type: "text", text: "Hello, Ada!" }],
			details: { greeted: "Ada" },
		});
	});
});
