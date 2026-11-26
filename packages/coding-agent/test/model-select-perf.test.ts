import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SettingsManager } from "../src/core/settings-manager.ts";

describe("model selection latency optimizations", () => {
	it("skips duplicate synchronous settings.json writes when default provider and model are unchanged", async () => {
		const root = mkdtempSync(join(tmpdir(), "omk-settings-noop-"));
		const agentDir = join(root, "agent");
		const cwd = join(root, "repo");
		try {
			const sm = SettingsManager.create(cwd, agentDir);
			sm.setDefaultModelAndProvider("antigravity", "gemini-4-neon-xhigh");
			await sm.flush();
			const settingsPath = join(agentDir, "settings.json");
			const mtime1 = statSync(settingsPath, { bigint: true }).mtimeNs;
			await new Promise((r) => setTimeout(r, 25));
			// Second identical call (e.g. handleSelect + setModel) must be a no-op with zero disk write.
			sm.setDefaultModelAndProvider("antigravity", "gemini-4-neon-xhigh");
			await sm.flush();
			const mtime2 = statSync(settingsPath, { bigint: true }).mtimeNs;
			expect(mtime2).toBe(mtime1);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
