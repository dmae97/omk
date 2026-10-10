import * as undici from "undici";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// cli.ts installs the lazy undici fetch hook before extensions load. An
// extension that wraps `globalThis.fetch` after that must keep seeing every
// request; the first-fetch undici install must not replace its wrapper.
const nativeFetch = globalThis.fetch;
const nativeDispatcher = undici.getGlobalDispatcher();

type InstallModule = typeof import("../src/core/http-dispatcher-install.ts");

async function freshInstallModule(): Promise<InstallModule> {
	vi.resetModules();
	return import("../src/core/http-dispatcher-install.ts");
}

/** What an extension does: capture the current fetch, install a counting wrapper. */
function installExtensionFetchHook(): { calls: () => number; hook: typeof globalThis.fetch } {
	let count = 0;
	const inner = globalThis.fetch;
	const hook: typeof globalThis.fetch = (input, init) => {
		count++;
		return inner(input, init);
	};
	globalThis.fetch = hook;
	return { calls: () => count, hook };
}

async function fetchText(): Promise<string> {
	const response = await globalThis.fetch("data:text/plain,ok");
	return response.text();
}

describe("lazy undici install vs. an extension fetch hook", () => {
	beforeEach(() => {
		globalThis.fetch = nativeFetch;
		undici.setGlobalDispatcher(nativeDispatcher);
	});

	afterEach(() => {
		globalThis.fetch = nativeFetch;
		undici.setGlobalDispatcher(nativeDispatcher);
	});

	it("calls an extension's fetch hook on every request, not only the first", async () => {
		const { installHttpDispatcherFetchHook } = await freshInstallModule();
		installHttpDispatcherFetchHook();
		const extension = installExtensionFetchHook();

		for (let i = 0; i < 3; i++) {
			expect(await fetchText()).toBe("ok");
		}

		expect(extension.calls()).toBe(3);
		expect(globalThis.fetch).toBe(extension.hook);
		expect(undici.getGlobalDispatcher()).toBeInstanceOf(undici.EnvHttpProxyAgent);
	});

	it("keeps the extension hook when the idle timeout is reconfigured later", async () => {
		const { installHttpDispatcherFetchHook, scheduleHttpDispatcher } = await freshInstallModule();
		installHttpDispatcherFetchHook();
		const extension = installExtensionFetchHook();

		await fetchText();
		scheduleHttpDispatcher(120_000);
		await fetchText();

		expect(extension.calls()).toBe(2);
		expect(globalThis.fetch).toBe(extension.hook);
	});

	it("installs undici fetch and dispatcher when no extension replaced fetch", async () => {
		const { installHttpDispatcherFetchHook } = await freshInstallModule();
		installHttpDispatcherFetchHook();

		expect(await fetchText()).toBe("ok");
		expect(await fetchText()).toBe("ok");

		expect(globalThis.fetch).toBe(undici.fetch);
		expect(undici.getGlobalDispatcher()).toBeInstanceOf(undici.EnvHttpProxyAgent);
	});
});
