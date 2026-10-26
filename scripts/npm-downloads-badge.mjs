#!/usr/bin/env node
/**
 * Write a shields.io endpoint badge for an npm package's last-month downloads.
 *
 * The README badge used to make shields.io query api.npmjs.org on behalf of every
 * viewer, which surfaced as "rate limited by upstream service". A daily workflow
 * runs this once and publishes the JSON to the `badges` branch instead, so the
 * badge only reads a static file. On any failure this exits nonzero without
 * writing, and the previously published value stays in place.
 *
 * Usage: node scripts/npm-downloads-badge.mjs --package <name> --out <file>
 */
import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const METRIC_PREFIXES = ["k", "M", "G", "T"];
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 4;
const MAX_RETRY_DELAY_MS = 60_000;
/** shields.io treats endpoint cacheSeconds below 300 as 300. */
export const BADGE_CACHE_SECONDS = 3600;

/**
 * Abbreviate a nonnegative count the way the shields.io npm badge does: one decimal
 * below ten of a unit unless it is `.0`, otherwise a rounded integer, rolling over
 * to the next prefix at 1000.
 */
export function formatMetric(count) {
	if (!Number.isSafeInteger(count) || count < 0) throw new TypeError(`invalid count: ${count}`);
	for (let index = METRIC_PREFIXES.length - 1; index >= 0; index--) {
		const unit = 1000 ** (index + 1);
		if (count < unit) continue;
		const scaled = count / unit;
		if (scaled < 10) {
			const oneDecimal = scaled.toFixed(1);
			if (!oneDecimal.endsWith("0")) return `${oneDecimal}${METRIC_PREFIXES[index]}`;
		}
		const rounded = Math.round(scaled);
		if (rounded < 1000 || index === METRIC_PREFIXES.length - 1) return `${rounded}${METRIC_PREFIXES[index]}`;
		return `1${METRIC_PREFIXES[index + 1]}`;
	}
	return `${count}`;
}

/** The download-count color scale of the shields.io npm badge. */
export function downloadColor(count) {
	if (count <= 0) return "red";
	if (count < 10) return "yellow";
	if (count < 100) return "yellowgreen";
	if (count < 1000) return "green";
	return "brightgreen";
}

/** Validate an api.npmjs.org `downloads/point/last-month` body for `packageName`. */
export function parseDownloads(body, packageName) {
	if (typeof body !== "object" || body === null) throw new TypeError("npm downloads response is not an object");
	if (body.package !== packageName) throw new TypeError(`npm downloads response is for ${String(body.package)}`);
	if (!Number.isSafeInteger(body.downloads) || body.downloads < 0) {
		throw new TypeError(`npm downloads response has an invalid count: ${String(body.downloads)}`);
	}
	return body.downloads;
}

/** The shields.io endpoint schema for a monthly download badge. */
export function buildBadge(downloads) {
	return {
		schemaVersion: 1,
		label: "downloads",
		message: `${formatMetric(downloads)}/month`,
		color: downloadColor(downloads),
		cacheSeconds: BADGE_CACHE_SECONDS,
	};
}

function retryDelayMs(response, attempt) {
	const header = response?.headers.get("retry-after");
	const seconds = header === null || header === undefined ? Number.NaN : Number(header);
	const delay = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 2 ** attempt * 1000;
	return Math.min(delay, MAX_RETRY_DELAY_MS);
}

/** Fetch the last-month count, retrying 429, 5xx and network errors with bounded backoff. */
export async function fetchDownloads(packageName, { fetchImpl = fetch, wait = sleep } = {}) {
	const url = `https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(packageName)}`;
	let lastError;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		let response;
		try {
			response = await fetchImpl(url, {
				headers: { accept: "application/json" },
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
		} catch (error) {
			lastError = error;
		}
		if (response?.ok) return parseDownloads(await response.json(), packageName);
		if (response && response.status !== 429 && response.status < 500) {
			throw new Error(`npm downloads API returned HTTP ${response.status}`);
		}
		if (response) lastError = new Error(`npm downloads API returned HTTP ${response.status}`);
		if (attempt < MAX_ATTEMPTS) await wait(retryDelayMs(response, attempt));
	}
	throw lastError;
}

function parseArgs(argv) {
	const options = {};
	for (let index = 0; index < argv.length; index += 2) {
		const [flag, value] = [argv[index], argv[index + 1]];
		if ((flag !== "--package" && flag !== "--out") || value === undefined) {
			throw new Error("usage: npm-downloads-badge.mjs --package <name> --out <file>");
		}
		options[flag.slice(2)] = value;
	}
	if (!options.package || !options.out) throw new Error("usage: npm-downloads-badge.mjs --package <name> --out <file>");
	return options;
}

async function main() {
	const { package: packageName, out } = parseArgs(process.argv.slice(2));
	const badge = buildBadge(await fetchDownloads(packageName));
	writeFileSync(out, `${JSON.stringify(badge, null, "\t")}\n`);
	console.log(`${packageName}: ${badge.message} -> ${out}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	main().catch((error) => {
		console.error(`npm downloads badge not updated: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	});
}
