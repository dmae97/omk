import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatHeadroomStatusLabel } from "../src/modes/interactive/components/control-panel-runtime-status.ts";
import {
	loadHeadroomVersion,
	setHeadroomProbeSpawnForTesting,
} from "../src/modes/interactive/components/headroom-version-probe.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";

/** Only the fields `stop()` touches, for an InteractiveMode that never ran `init()`. */
function stoppableFakeThis() {
	return {
		unregisterSignalHandlers: () => {},
		settingsManager: { getShowTerminalProgress: () => false },
		loadingAnimation: undefined,
		clearExtensionTerminalInputListeners: () => {},
		chatContainer: undefined,
		builtInHeader: undefined,
		customHeader: undefined,
		footer: { dispose: () => {} },
		footerDataProvider: { dispose: () => {} },
		unsubscribeThemedOutputStale: undefined,
		unsubscribe: undefined,
		isInitialized: false,
	};
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * execFile settles an aborted call as soon as it sends the kill signal, before the child has exited and
 * been reaped, so the pid can still answer `kill(pid, 0)` for a moment.
 */
async function waitUntilGone(pid: number, timeoutMs: number): Promise<boolean> {
	const deadline = performance.now() + timeoutMs;
	while (performance.now() < deadline) {
		if (!isAlive(pid)) return true;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	return !isAlive(pid);
}

async function waitForFile(path: string, timeoutMs: number): Promise<string> {
	const deadline = performance.now() + timeoutMs;
	while (performance.now() < deadline) {
		if (existsSync(path)) {
			const content = readFileSync(path, "utf8").trim();
			if (content) return content;
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`${path} was not written within ${timeoutMs} ms`);
}

describe.skipIf(process.platform === "win32")("InteractiveMode.stop() and a hung headroom probe (spec 046)", () => {
	const originalPath = process.env.PATH;
	let dir: string | undefined;

	afterEach(() => {
		process.env.PATH = originalPath;
		if (dir) rmSync(dir, { recursive: true, force: true });
		dir = undefined;
	});

	it("kills the running `headroom` child and settles the probe well before its 750 ms timeout", async () => {
		dir = mkdtempSync(join(tmpdir(), "omk-headroom-hang-"));
		const pidFile = join(dir, "headroom.pid");
		// A `headroom` that never answers: it records its pid, then becomes `sleep` under the same pid.
		writeFileSync(join(dir, "headroom"), `#!/bin/sh\necho $$ > '${pidFile}'\nexec /bin/sleep 30\n`);
		chmodSync(join(dir, "headroom"), 0o755);
		process.env.PATH = dir;
		// The test setup installs a "no version" spawn; this case needs the real one.
		setHeadroomProbeSpawnForTesting(undefined);

		const probe = loadHeadroomVersion();
		const pid = Number(await waitForFile(pidFile, 2_000));
		expect(isAlive(pid)).toBe(true);

		const stoppedAt = performance.now();
		(InteractiveMode.prototype.stop as (this: unknown) => void).call(stoppableFakeThis());

		await expect(probe).resolves.toBeNull();
		expect(performance.now() - stoppedAt).toBeLessThan(500);
		await expect(waitUntilGone(pid, 1_000)).resolves.toBe(true);
		expect(formatHeadroomStatusLabel()).not.toMatch(/^headroom:/);
	});

	it("the test setup's default spawn starts no process, even with a `headroom` on PATH", async () => {
		dir = mkdtempSync(join(tmpdir(), "omk-headroom-setup-"));
		const markerFile = join(dir, "ran");
		writeFileSync(join(dir, "headroom"), `#!/bin/sh\necho ran > '${markerFile}'\necho 3.0.1\n`);
		chmodSync(join(dir, "headroom"), 0o755);
		process.env.PATH = dir;

		await expect(loadHeadroomVersion()).resolves.toBeNull();
		expect(formatHeadroomStatusLabel()).not.toMatch(/^headroom:/);
		expect(existsSync(markerFile)).toBe(false);
	});
});
