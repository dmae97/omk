/**
 * `omk doctor [--json] [--online]`: one read-only pass over everything a first run depends on.
 *
 * Exit codes: 0 = no check failed (warnings allowed), 1 = at least one check failed, 2 = usage.
 * The narrower doctors keep their own commands: `omk doctor resources`, `omk doctor adaptorch`,
 * `omk provider doctor <id>`, `omk session doctor`, `omk package doctor <source>`.
 */
import { APP_NAME, getAgentDir } from "../config.ts";
import { type CheckReport, runCheckDag } from "../core/onboarding/check-dag.ts";
import { DOCTOR_CHECKS, type DoctorContext } from "./onboard-doctor-checks.ts";

const USAGE = `Usage: ${APP_NAME} doctor [--json] [--online]`;
const FLAGS = new Set(["--json", "--online", "--help", "-h"]);
const MARK: Readonly<Record<CheckReport["status"], string>> = { pass: "✓", warn: "!", fail: "✗", skip: "-" };

export interface OnboardDoctorDependencies {
	readonly writeLine?: (line: string) => void;
	readonly agentDir?: string;
	readonly env?: Readonly<Record<string, string | undefined>>;
}

function render(reports: readonly CheckReport[], elapsedMs: number, writeLine: (line: string) => void): void {
	const width = Math.max(...reports.map((report) => report.title.length));
	for (const report of reports) {
		writeLine(`  ${MARK[report.status]} ${report.title.padEnd(width)}  ${report.summary}`);
		if (report.fix && report.status !== "pass") writeLine(`      fix: ${report.fix}`);
	}
	const count = (status: CheckReport["status"]) => reports.filter((report) => report.status === status).length;
	writeLine(
		`${count("fail")} failed · ${count("warn")} warnings · ${count("pass")} passed · ${Math.round(elapsedMs)} ms`,
	);
}

export async function runOnboardDoctorCli(
	args: readonly string[],
	dependencies: OnboardDoctorDependencies = {},
): Promise<{ readonly handled: boolean; readonly exitCode: number }> {
	if (args[0] !== "doctor" || args.slice(1).some((arg) => !arg.startsWith("-"))) {
		return { handled: false, exitCode: 0 };
	}
	const writeLine = dependencies.writeLine ?? ((line: string) => process.stdout.write(`${line}\n`));
	const flags = args.slice(1);
	if (flags.some((flag) => !FLAGS.has(flag))) {
		writeLine(USAGE);
		return { handled: true, exitCode: 2 };
	}
	if (flags.includes("--help") || flags.includes("-h")) {
		writeLine(
			`${USAGE}\nRead-only check of runtime, credentials, default model, bash sandbox, tools and (--online) network.`,
		);
		return { handled: true, exitCode: 0 };
	}
	const context: DoctorContext = {
		agentDir: dependencies.agentDir ?? getAgentDir(),
		env: dependencies.env ?? process.env,
		online: flags.includes("--online"),
	};
	const started = performance.now();
	const reports = await runCheckDag(DOCTOR_CHECKS, context, { concurrency: 4 });
	const elapsedMs = performance.now() - started;
	const failed = reports.some((report) => report.status === "fail");
	if (flags.includes("--json")) {
		writeLine(JSON.stringify({ ok: !failed, elapsedMs: Math.round(elapsedMs), checks: reports }, null, 2));
	} else {
		writeLine(`${APP_NAME} doctor`);
		render(reports, elapsedMs, writeLine);
	}
	return { handled: true, exitCode: failed ? 1 : 0 };
}
