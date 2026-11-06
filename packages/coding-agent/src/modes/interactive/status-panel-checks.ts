import { singleLineDisplayText } from "../../utils/display-text.ts";

export type ObservedCheck = {
	text: string;
	state: "success" | "error" | "warning";
	stale: boolean;
};
export type StatusChecks = { tests?: ObservedCheck; diagnostics?: ObservedCheck };

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/** Observations only: a tool returning normally is not proof that diagnostics ran or tests passed. */
export function observeStatusCheck(
	name: string,
	args: unknown,
	text: string,
	details: unknown,
	isError: boolean,
): { kind: keyof StatusChecks; check: ObservedCheck } | undefined {
	const result = record(details);
	if (name === "diagnostics") {
		if (
			!Array.isArray(result?.diagnostics) ||
			!Array.isArray(result.skipped) ||
			!result.diagnostics.every((item) => ["error", "warning", "info"].includes(String(record(item)?.severity)))
		)
			return {
				kind: "diagnostics",
				check: {
					text: isError ? "tool failed" : "unavailable",
					state: isError ? "error" : "warning",
					stale: false,
				},
			};
		const errors = result.diagnostics.filter((item) => record(item)?.severity === "error").length;
		const warnings = result.diagnostics.filter((item) => record(item)?.severity === "warning").length;
		const total = record(result.counts);
		const capped =
			total && Object.values(total).every((n) => typeof n === "number")
				? (Object.values(total) as number[]).reduce((a, b) => a + b, 0) > result.diagnostics.length
				: false;
		const skipped = result.skipped.length;
		const label = `${capped ? "≥" : ""}${errors} error${errors === 1 ? "" : "s"}${warnings ? ` / ${warnings} warnings` : ""}`;
		return {
			kind: "diagnostics",
			check: {
				text:
					skipped && !errors && !warnings
						? `${skipped} skipped`
						: `${label}${skipped ? ` / ${skipped} skipped` : ""}`,
				state: isError || errors ? "error" : skipped || warnings || capped ? "warning" : "success",
				stale: false,
			},
		};
	}
	if (name === "lsp_diagnostics" || name === "lens_diagnostics") {
		const output = singleLineDisplayText(text);
		const incomplete = /(?:unsupported|unavailable|failed|inconclusive)=[1-9]/.test(output);
		const clean =
			!isError &&
			!incomplete &&
			(/Total diagnostics:\s*0\b/.test(output) || /No error issues across [1-9]\d* files/.test(output));
		return {
			kind: "diagnostics",
			check: {
				text: clean ? "0 errors" : isError ? "tool failed" : "see diagnostic report",
				state: clean ? "success" : isError ? "error" : "warning",
				stale: false,
			},
		};
	}
	if (name !== "bash") return undefined;
	const rawCommand = record(args)?.command;
	if (typeof rawCommand !== "string") return undefined;
	const command = rawCommand.replace(/^\s*cd\s+(?:"[^"$`]+"|'[^']+'|[^\s;&|]+)\s*&&\s*/, "");
	// Accept one runner (optionally after cd), never a pipeline or a masked compound-shell verdict.
	if (/[;&|\n<>`$]/.test(command)) return undefined;
	const known =
		/^\s*(?:(?:\w+=[\w.-]+\s+)*)(?:(?:[\w./-]*\/)?(?:pytest|vitest|jest)\b|(?:npm|pnpm|yarn)\s+(?:run\s+)?test\b|(?:go|cargo)\s+test\b|node\s+(?:--test\b|[\w./-]*vitest\/dist\/cli\.js\b)|python3?\s+-m\s+(?:pytest|unittest)\b)/;
	if (!known.test(command)) return undefined;
	const output = singleLineDisplayText(text);
	const vitest = /\bTests\s+([^\r\n]*?)(?:\(\d+\)|Duration\b|Start at\b|$)/.exec(output)?.[1];
	const summary = vitest ?? output;
	const passed = /\b(\d+) passed\b/.exec(summary)?.[1] ?? /#?\s*pass\s+(\d+)\b/.exec(summary)?.[1];
	const failed = /\b(\d+) failed\b/.exec(summary)?.[1] ?? /#?\s*fail\s+(\d+)\b/.exec(summary)?.[1];
	const skipped = /\b(\d+) skipped\b/.exec(summary)?.[1] ?? /#?\s*skipped\s+(\d+)\b/.exec(summary)?.[1];
	const counts = [
		passed === undefined ? "" : `${passed} passed`,
		failed && failed !== "0" ? `${failed} failed` : "",
		skipped && skipped !== "0" ? `${skipped} skipped` : "",
	].filter(Boolean);
	return {
		kind: "tests",
		check: {
			text: counts.join(" / ") || (isError ? "command failed" : "no test counts"),
			state:
				isError || (failed !== undefined && Number(failed) > 0)
					? "error"
					: passed !== undefined && Number(passed) > 0
						? "success"
						: "warning",
			stale: false,
		},
	};
}
