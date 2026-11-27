import { isAbsolute, relative, resolve, sep } from "node:path";
import type { PiPackageIntakeSummary } from "../../../core/pi-package-intake.ts";

/** Format token counts for compact footer display. */
export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

/** Format byte counts for compact footer display. */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}K`;
	if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))}M`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
}

export function formatPackageIntake(summary: PiPackageIntakeSummary): string {
	const ready =
		summary.acceptedNative + summary.acceptedReference + summary.acceptedMeasurement + summary.acceptedAdvisory;
	const review = summary.deferred + summary.reject;
	return `PKG ${ready}/${summary.total} R${review} B${summary.hardForkBlocked}`;
}

export function formatCwdForFooter(cwd: string, home: string | undefined): string {
	if (!home) return cwd;
	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const relativeToHome = relative(resolvedHome, resolvedCwd);
	const isInsideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));
	if (!isInsideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

/**
 * Extract the provider endpoint host from a model base URL for footer display.
 * Returns undefined when the URL is missing or unparsable so callers can fall back to provider-only display.
 */
export function formatEndpointForFooter(baseUrl: string | undefined): string | undefined {
	if (!baseUrl) return undefined;
	try {
		const hostname = new URL(baseUrl).hostname.replace(/\.aliyuncs\.com$/, "");
		return hostname || undefined;
	} catch {
		return undefined;
	}
}
