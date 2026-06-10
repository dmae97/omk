import { afterEach, describe, expect, it, vi } from "vitest";
import {
	checkForNewPiVersion,
	comparePackageVersions,
	getLatestPiRelease,
	getLatestPiVersion,
	isNewerPackageVersion,
} from "../src/utils/version-check.ts";

const originalSkipVersionCheck = process.env.OMK_SKIP_VERSION_CHECK;
const originalOffline = process.env.OMK_OFFLINE;
const originalVersionCheckUrl = process.env.OMK_VERSION_CHECK_URL;

afterEach(() => {
	vi.unstubAllGlobals();
	if (originalSkipVersionCheck === undefined) {
		delete process.env.OMK_SKIP_VERSION_CHECK;
	} else {
		process.env.OMK_SKIP_VERSION_CHECK = originalSkipVersionCheck;
	}
	if (originalOffline === undefined) {
		delete process.env.OMK_OFFLINE;
	} else {
		process.env.OMK_OFFLINE = originalOffline;
	}
	if (originalVersionCheckUrl === undefined) {
		delete process.env.OMK_VERSION_CHECK_URL;
	} else {
		process.env.OMK_VERSION_CHECK_URL = originalVersionCheckUrl;
	}
});

describe("version checks", () => {
	it("compares package versions", () => {
		expect(comparePackageVersions("0.70.6", "0.70.5")).toBeGreaterThan(0);
		expect(comparePackageVersions("0.70.5", "0.70.5")).toBe(0);
		expect(comparePackageVersions("0.70.4", "0.70.5")).toBeLessThan(0);
		expect(isNewerPackageVersion("0.70.5", "0.70.5")).toBe(false);
		expect(isNewerPackageVersion("0.70.6", "0.70.5")).toBe(true);
	});

	function enableOmkVersionCheck(): void {
		process.env.OMK_VERSION_CHECK_URL = "https://omk.dev/api/latest-version";
	}
	it("returns only newer versions", async () => {
		enableOmkVersionCheck();
		const fetchMock = vi.fn(async () => Response.json({ version: "1.2.3" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(checkForNewPiVersion("1.2.3")).resolves.toBeUndefined();
		await expect(checkForNewPiVersion("1.2.2")).resolves.toEqual({ version: "1.2.3" });
	});

	it("uses the configured OMK version check api with an OMK user agent", async () => {
		enableOmkVersionCheck();
		const fetchMock = vi.fn(async () => Response.json({ version: "1.2.4" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestPiVersion("1.2.3")).resolves.toBe("1.2.4");
		expect(fetchMock).toHaveBeenCalledWith(
			"https://omk.dev/api/latest-version",
			expect.objectContaining({
				headers: expect.objectContaining({
					"User-Agent": expect.stringMatching(/^omk\/1\.2\.3 /),
					accept: "application/json",
				}),
			}),
		);
	});

	it("returns the active package metadata from the configured version check api", async () => {
		enableOmkVersionCheck();
		const fetchMock = vi.fn(async () =>
			Response.json({
				packageName: "@earendil-works/omk-coding-agent",
				version: "1.2.4",
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestPiRelease("1.2.3")).resolves.toEqual({
			packageName: "@earendil-works/omk-coding-agent",
			version: "1.2.4",
		});
	});

	it("returns update notes from the configured version check api", async () => {
		enableOmkVersionCheck();
		const fetchMock = vi.fn(async () => Response.json({ note: " **Read this** ", version: "1.2.4" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestPiRelease("1.2.3")).resolves.toEqual({ note: "**Read this**", version: "1.2.4" });
	});

	it("skips api calls when version checks are disabled", async () => {
		enableOmkVersionCheck();
		process.env.OMK_SKIP_VERSION_CHECK = "1";
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestPiVersion("1.2.3")).resolves.toBeUndefined();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
