import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	BADGE_CACHE_SECONDS,
	buildBadge,
	downloadColor,
	fetchDownloads,
	formatMetric,
	parseDownloads,
} from "../npm-downloads-badge.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PACKAGE = "open-multi-agent-kit";

function response(status, body, headers = {}) {
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: new Headers(headers),
		json: async () => body,
	};
}

describe("npm downloads badge: formatting", () => {
	it("abbreviates counts like the shields.io npm badge", () => {
		const cases = [
			[0, "0"],
			[999, "999"],
			[1000, "1k"],
			[1999, "2k"],
			[2463, "2.5k"],
			[9949, "9.9k"],
			[12345, "12k"],
			[999_499, "999k"],
			[999_500, "1M"],
			[1_500_000, "1.5M"],
			[42_000_000, "42M"],
		];
		for (const [count, expected] of cases) assert.equal(formatMetric(count), expected, String(count));
	});

	it("rejects counts the API never returns", () => {
		for (const count of [-1, 1.5, Number.NaN, 2 ** 60]) assert.throws(() => formatMetric(count), TypeError);
	});

	it("uses the shields.io download color scale", () => {
		assert.deepEqual(
			[0, 9, 10, 99, 100, 999, 1000].map(downloadColor),
			["red", "yellow", "yellowgreen", "yellowgreen", "green", "green", "brightgreen"],
		);
	});

	it("builds a shields.io endpoint document", () => {
		assert.deepEqual(buildBadge(2463), {
			schemaVersion: 1,
			label: "downloads",
			message: "2.5k/month",
			color: "brightgreen",
			cacheSeconds: BADGE_CACHE_SECONDS,
		});
		assert.ok(BADGE_CACHE_SECONDS >= 300);
	});
});

describe("npm downloads badge: API response", () => {
	it("accepts only a nonnegative integer count for the requested package", () => {
		assert.equal(parseDownloads({ downloads: 2463, package: PACKAGE }, PACKAGE), 2463);
		for (const body of [
			null,
			{ error: "package open-multi-agent-kit not found" },
			{ downloads: 1, package: "other" },
			{ downloads: -1, package: PACKAGE },
			{ downloads: "2463", package: PACKAGE },
		]) {
			assert.throws(() => parseDownloads(body, PACKAGE), TypeError, JSON.stringify(body));
		}
	});

	it("retries rate limits and server errors with bounded waits, then succeeds", async () => {
		const replies = [
			response(429, {}, { "retry-after": "5" }),
			response(503, {}),
			response(200, { downloads: 7, package: PACKAGE }),
		];
		const waits = [];
		const urls = [];
		const count = await fetchDownloads(PACKAGE, {
			fetchImpl: async (url) => {
				urls.push(url);
				return replies.shift();
			},
			wait: async (ms) => waits.push(ms),
		});
		assert.equal(count, 7);
		assert.deepEqual(urls, Array(3).fill(`https://api.npmjs.org/downloads/point/last-month/${PACKAGE}`));
		assert.deepEqual(waits, [5000, 4000]);
	});

	it("fails without retrying a client error and after exhausting retries", async () => {
		let calls = 0;
		await assert.rejects(
			fetchDownloads(PACKAGE, {
				fetchImpl: async () => {
					calls++;
					return response(404, {});
				},
				wait: async () => {},
			}),
			/HTTP 404/,
		);
		assert.equal(calls, 1);

		calls = 0;
		await assert.rejects(
			fetchDownloads(PACKAGE, {
				fetchImpl: async () => {
					calls++;
					return response(429, {}, { "retry-after": "86400" });
				},
				wait: async (ms) => assert.ok(ms <= 60_000, `wait ${ms} is unbounded`),
			}),
			/HTTP 429/,
		);
		assert.equal(calls, 4);
	});
});

describe("npm downloads badge: workflow and README", () => {
	const workflow = readFileSync(join(repoRoot, ".github", "workflows", "npm-downloads-badge.yml"), "utf8");
	const readme = readFileSync(join(repoRoot, "README.md"), "utf8");

	it("runs only on a schedule or by hand, never on pull request content", () => {
		assert.match(workflow, /^on:\n {2}schedule:\n {4}- cron: "[^"]+"\n {2}workflow_dispatch:\n\n/m);
		assert.doesNotMatch(workflow, /pull_request/);
	});

	it("grants write access only to the job and keeps the checkout token out of the tree", () => {
		assert.match(workflow, /^permissions:\n {2}contents: read$/m);
		assert.equal(workflow.match(/contents: write/g)?.length, 1);
		assert.match(workflow, /persist-credentials: false/);
		for (const [, ref] of workflow.matchAll(/uses: [^@\s]+@(\S+)/g)) assert.match(ref, /^[0-9a-f]{40}$/);
	});

	it("pushes only the badge file, only to the badges branch, without force", () => {
		assert.match(workflow, /BADGE_BRANCH: badges$/m);
		assert.match(workflow, /BADGE_FILE: npm-downloads\.json$/m);
		assert.match(workflow, /git add -- "\$BADGE_FILE"/);
		assert.equal(workflow.match(/git -c "\$auth" push/g)?.length, 1);
		assert.match(workflow, /push -q "\$remote" "HEAD:refs\/heads\/\$BADGE_BRANCH"/);
		assert.doesNotMatch(workflow, /--force|\s-f\s|\+HEAD/);
	});

	it("points the README badge at the published endpoint, not the live npm badge", () => {
		assert.doesNotMatch(readme, /img\.shields\.io\/npm\/d[mwty]\//);
		const endpoint = encodeURIComponent("https://raw.githubusercontent.com/dmae97/omk/badges/npm-downloads.json");
		assert.ok(readme.includes(`https://img.shields.io/endpoint?url=${endpoint}`), "README endpoint badge");
	});
});
