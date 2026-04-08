/**
 * Read CLI command handler.
 *
 * Handles `omp read` subcommand — emits chunk-mode read output for a file.
 */
import * as path from "node:path";
import chalk from "chalk";
import { formatChunkedRead, resolveAnchorStyle } from "../edit/modes/chunk";
import { getLanguageFromPath } from "../modes/theme/theme";

export interface ReadCommandArgs {
	path: string;
	sel?: string;
}

export async function runReadCommand(cmd: ReadCommandArgs): Promise<void> {
	const filePath = path.resolve(cmd.path);

	const file = Bun.file(filePath);
	if (!(await file.exists())) {
		console.error(chalk.red(`Error: File not found: ${cmd.path}`));
		process.exit(1);
	}

	const readPath = cmd.sel ? `${filePath}:${cmd.sel}` : filePath;
	const language = getLanguageFromPath(filePath);
	const cwd = process.cwd();

	try {
		const result = await formatChunkedRead({
			filePath,
			readPath,
			cwd,
			language,
			anchorStyle: resolveAnchorStyle(),
		});
		console.log(result.text);
	} catch (err) {
		console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
		process.exit(1);
	}
}
