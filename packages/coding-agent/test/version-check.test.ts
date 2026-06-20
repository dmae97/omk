import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	checkForNewOmkVersion,
	comparePackageVersions,
	getLatestOmkRelease,
	getLatestOmkVersion,
	isNewerPackageVersion,
} from "../src/utils/version-check.ts";

const originalSkipVersionCheck = process.env.OMK_SKIP_VERSION_CHECK;
const originalOffline = process.env.OMK_OFFLINE;

beforeEach(() => {
	delete process.env.OMK_SKIP_VERSION_CHECK;
	delete process.env.OMK_OFFLINE;
});

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
});

describe("version checks", () => {
	it("compares package versions", () => {
		expect(comparePackageVersions("0.70.6", "0.70.5")).toBeGreaterThan(0);
		expect(comparePackageVersions("0.70.5", "0.70.5")).toBe(0);
		expect(comparePackageVersions("0.70.4", "0.70.5")).toBeLessThan(0);
		expect(isNewerPackageVersion("0.70.5", "0.70.5")).toBe(false);
		expect(isNewerPackageVersion("0.70.6", "0.70.5")).toBe(true);
	});

	it("returns only newer versions", async () => {
		const fetchMock = vi.fn(async () => Response.json({ version: "1.2.3" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(checkForNewOmkVersion("1.2.3")).resolves.toBeUndefined();
		await expect(checkForNewOmkVersion("1.2.2")).resolves.toEqual({ version: "1.2.3" });
	});

	it("uses the npm registry version check endpoint with an omk user agent", async () => {
		const fetchMock = vi.fn(async () => Response.json({ version: "1.2.4" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestOmkVersion("1.2.3")).resolves.toBe("1.2.4");
		expect(fetchMock).toHaveBeenCalledWith(
			"https://registry.npmjs.org/open-multi-agent-kit/latest",
			expect.objectContaining({
				headers: expect.objectContaining({
					"User-Agent": expect.stringMatching(/^omk\/1\.2\.3 /),
					accept: "application/json",
				}),
			}),
		);
	});

	it("returns the active package metadata from the version check api", async () => {
		const fetchMock = vi.fn(async () =>
			Response.json({
				packageName: "@new-scope/omk",
				version: "1.2.4",
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestOmkRelease("1.2.3")).resolves.toEqual({
			packageName: "@new-scope/omk",
			version: "1.2.4",
		});
	});

	it("returns update notes from the version check api", async () => {
		const fetchMock = vi.fn(async () => Response.json({ note: " **Read this** ", version: "1.2.4" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestOmkRelease("1.2.3")).resolves.toEqual({ note: "**Read this**", version: "1.2.4" });
	});

	it("skips api calls when version checks are disabled", async () => {
		process.env.OMK_SKIP_VERSION_CHECK = "1";
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestOmkVersion("1.2.3")).resolves.toBeUndefined();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
