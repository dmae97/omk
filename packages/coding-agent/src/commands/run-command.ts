import { runAdaptOrchDoctorCli } from "./adaptorch-doctor-cli.ts";
import { runDoctorProviderCli } from "./doctor-provider-cli.ts";
import { runResourceDoctorCli } from "./resource-doctor-cli.ts";
import { runRouterFeedbackCli } from "./router-feedback-cli.ts";
import { runSdkSessionCli } from "./sdk-session-cli.ts";
import { runSessionDoctorCli } from "./session-doctor-cli.ts";
import { runStatsCli } from "./stats-cli.ts";

type CliOutcome = { readonly handled: boolean; readonly exitCode: number };

const COMMANDS: ReadonlyArray<(args: string[]) => CliOutcome | Promise<CliOutcome>> = [
	runSessionDoctorCli,
	runDoctorProviderCli,
	runResourceDoctorCli,
	runAdaptOrchDoctorCli,
	runStatsCli,
	runSdkSessionCli,
	runRouterFeedbackCli,
];

/** Each handler owns a distinct prefix; preserve the first handled outcome. */
export async function runCommand(args: string[]): Promise<CliOutcome> {
	for (const command of COMMANDS) {
		const outcome = await command(args);
		if (outcome.handled) return outcome;
	}
	return { handled: false, exitCode: 0 };
}
