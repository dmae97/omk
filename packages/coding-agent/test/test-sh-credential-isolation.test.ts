import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ENV_AGENT_DIR } from "../src/config.ts";

/**
 * The suite used to move the live credential store (~/.omk/agent/auth.json) to
 * a sibling backup for the whole run and move it back on exit. That mounted a
 * multi-minute outage of the live store for every concurrently running
 * session, and a session that wrote a fresh store during the run had it
 * clobbered by the restore. The script must isolate the agent dir instead.
 */
const scriptPath = fileURLToPath(new URL("../../../test.sh", import.meta.url));
const script = readFileSync(scriptPath, "utf-8");
// The rationale comment names the live path on purpose; only executed lines
// are held to the invariant.
const code = script
	.split("\n")
	.filter((line) => !line.trimStart().startsWith("#"))
	.join("\n");

describe("test.sh credential isolation", () => {
	it("never touches the live credential store", () => {
		expect(code).not.toContain(".omk/agent/auth.json");
		expect(code).not.toContain("auth.json.bak");
		expect(code).not.toMatch(/\bmv\b[^\n]*\.json/);
		expect(code).not.toMatch(/AUTH_FILE|AUTH_BACKUP/);
	});

	it("isolates the agent dir through the config env var", () => {
		expect(script).toContain(`export ${ENV_AGENT_DIR}=`);
		expect(script).toMatch(/mktemp -d/);
		// The isolated directory must not outlive the run.
		expect(script).toMatch(/trap[^\n]*EXIT/);
		expect(script).toMatch(/rm -rf "\$ISOLATED_AGENT_DIR"/);
	});
});
