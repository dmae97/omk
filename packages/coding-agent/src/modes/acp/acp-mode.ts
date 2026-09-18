import type { Args } from "../../cli/args.ts";
import { VERSION } from "../../config.ts";
import { flushRawStdout, takeOverStdout, writeRawStdout } from "../../core/output-guard.ts";
import { createAcpSession } from "./acp-session.ts";
import { serveAcp } from "./acp-transport.ts";

/** Start before session/resource discovery so initialization requires no credentials or provider calls. */
export async function runAcpMode(args: Args): Promise<void> {
	if (
		args.messages.length ||
		args.fileArgs.length ||
		args.print ||
		args.session ||
		args.resume ||
		args.continue ||
		args.fork ||
		args.sessionId ||
		args.extensions?.length ||
		args.tools?.length ||
		args.apiKey ||
		args.modelContractFile
	) {
		throw new Error("ACP conversation mode accepts --model/--provider/--thinking; prompts arrive via session/prompt");
	}
	takeOverStdout();
	const stop = () => process.stdin.destroy();
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	try {
		await serveAcp(
			process.stdin,
			(message) => writeRawStdout(`${JSON.stringify(message)}\n`),
			(cwd) => createAcpSession(cwd, args),
			VERSION,
		);
		await flushRawStdout();
	} finally {
		process.off("SIGINT", stop);
		process.off("SIGTERM", stop);
	}
}
