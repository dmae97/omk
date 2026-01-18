/**
 * Setup CLI command handler.
 *
 * Handles `omp setup <component>` to install dependencies for optional features.
 */

import chalk from "chalk";
import { APP_NAME } from "../config";
import { theme } from "../modes/interactive/theme/theme";

export type SetupComponent = "python";

export interface SetupCommandArgs {
	component: SetupComponent;
	flags: {
		json?: boolean;
		check?: boolean;
	};
}

const VALID_COMPONENTS: SetupComponent[] = ["python"];

const PYTHON_PACKAGES = ["jupyter_kernel_gateway", "ipykernel"];

/**
 * Parse setup subcommand arguments.
 * Returns undefined if not a setup command.
 */
export function parseSetupArgs(args: string[]): SetupCommandArgs | undefined {
	if (args.length === 0 || args[0] !== "setup") {
		return undefined;
	}

	if (args.length < 2) {
		console.error(chalk.red(`Usage: ${APP_NAME} setup <component>`));
		console.error(`Valid components: ${VALID_COMPONENTS.join(", ")}`);
		process.exit(1);
	}

	const component = args[1];
	if (!VALID_COMPONENTS.includes(component as SetupComponent)) {
		console.error(chalk.red(`Unknown component: ${component}`));
		console.error(`Valid components: ${VALID_COMPONENTS.join(", ")}`);
		process.exit(1);
	}

	const flags: SetupCommandArgs["flags"] = {};
	for (let i = 2; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--json") {
			flags.json = true;
		} else if (arg === "--check" || arg === "-c") {
			flags.check = true;
		}
	}

	return {
		component: component as SetupComponent,
		flags,
	};
}

interface PythonCheckResult {
	available: boolean;
	pythonPath?: string;
	uvPath?: string;
	pipPath?: string;
	missingPackages: string[];
	installedPackages: string[];
}

/**
 * Check Python environment and kernel dependencies.
 */
async function checkPythonSetup(): Promise<PythonCheckResult> {
	const result: PythonCheckResult = {
		available: false,
		missingPackages: [],
		installedPackages: [],
	};

	const pythonPath = Bun.which("python") ?? Bun.which("python3");
	if (!pythonPath) {
		return result;
	}
	result.pythonPath = pythonPath;
	result.uvPath = Bun.which("uv") ?? undefined;
	result.pipPath = Bun.which("pip3") ?? Bun.which("pip") ?? undefined;

	for (const pkg of PYTHON_PACKAGES) {
		const moduleName = pkg === "jupyter_kernel_gateway" ? "kernel_gateway" : pkg;
		const check = Bun.spawnSync(
			[pythonPath, "-c", `import importlib.util; exit(0 if importlib.util.find_spec('${moduleName}') else 1)`],
			{ stdin: "ignore", stdout: "pipe", stderr: "pipe" },
		);
		if (check.exitCode === 0) {
			result.installedPackages.push(pkg);
		} else {
			result.missingPackages.push(pkg);
		}
	}

	result.available = result.missingPackages.length === 0;
	return result;
}

/**
 * Install Python packages using uv (preferred) or pip.
 */
function installPythonPackages(packages: string[], uvPath?: string, pipPath?: string): boolean {
	if (uvPath) {
		console.log(chalk.dim(`Installing via uv: ${packages.join(" ")}`));
		const result = Bun.spawnSync([uvPath, "pip", "install", ...packages], {
			stdin: "ignore",
			stdout: "inherit",
			stderr: "inherit",
		});
		return result.exitCode === 0;
	}

	if (pipPath) {
		console.log(chalk.dim(`Installing via pip: ${packages.join(" ")}`));
		const result = Bun.spawnSync([pipPath, "install", ...packages], {
			stdin: "ignore",
			stdout: "inherit",
			stderr: "inherit",
		});
		return result.exitCode === 0;
	}

	return false;
}

/**
 * Run the setup command.
 */
export async function runSetupCommand(cmd: SetupCommandArgs): Promise<void> {
	switch (cmd.component) {
		case "python":
			await handlePythonSetup(cmd.flags);
			break;
	}
}

async function handlePythonSetup(flags: { json?: boolean; check?: boolean }): Promise<void> {
	const check = await checkPythonSetup();

	if (flags.json) {
		console.log(JSON.stringify(check, null, 2));
		if (!check.available) process.exit(1);
		return;
	}

	if (!check.pythonPath) {
		console.error(chalk.red(`${theme.status.error} Python not found`));
		console.error(chalk.dim("Install Python 3.8+ and ensure it's in your PATH"));
		process.exit(1);
	}

	console.log(chalk.dim(`Python: ${check.pythonPath}`));

	if (check.uvPath) {
		console.log(chalk.dim(`uv: ${check.uvPath}`));
	} else if (check.pipPath) {
		console.log(chalk.dim(`pip: ${check.pipPath}`));
	}

	if (check.installedPackages.length > 0) {
		console.log(chalk.green(`${theme.status.success} Installed: ${check.installedPackages.join(", ")}`));
	}

	if (check.missingPackages.length === 0) {
		console.log(chalk.green(`\n${theme.status.success} Python execution is ready`));
		return;
	}

	console.log(chalk.yellow(`${theme.status.warning} Missing: ${check.missingPackages.join(", ")}`));

	if (flags.check) {
		process.exit(1);
	}

	if (!check.uvPath && !check.pipPath) {
		console.error(chalk.red(`\n${theme.status.error} No package manager found`));
		console.error(chalk.dim("Install uv (recommended) or pip:"));
		console.error(chalk.dim("  curl -LsSf https://astral.sh/uv/install.sh | sh"));
		process.exit(1);
	}

	console.log("");
	const success = installPythonPackages(check.missingPackages, check.uvPath, check.pipPath);

	if (!success) {
		console.error(chalk.red(`\n${theme.status.error} Installation failed`));
		console.error(chalk.dim("Try installing manually:"));
		console.error(chalk.dim(`  ${check.uvPath ? "uv pip" : "pip"} install ${check.missingPackages.join(" ")}`));
		process.exit(1);
	}

	const recheck = await checkPythonSetup();
	if (recheck.available) {
		console.log(chalk.green(`\n${theme.status.success} Python execution is ready`));
	} else {
		console.error(chalk.red(`\n${theme.status.error} Setup incomplete`));
		console.error(chalk.dim(`Still missing: ${recheck.missingPackages.join(", ")}`));
		process.exit(1);
	}
}

/**
 * Print setup command help.
 */
export function printSetupHelp(): void {
	console.log(`${chalk.bold(`${APP_NAME} setup`)} - Install dependencies for optional features

${chalk.bold("Usage:")}
  ${APP_NAME} setup <component> [options]

${chalk.bold("Components:")}
  python    Install Jupyter kernel dependencies for Python code execution
            Packages: ${PYTHON_PACKAGES.join(", ")}

${chalk.bold("Options:")}
  -c, --check   Check if dependencies are installed without installing
  --json        Output status as JSON

${chalk.bold("Examples:")}
  ${APP_NAME} setup python           Install Python execution dependencies
  ${APP_NAME} setup python --check   Check if Python execution is available
`);
}
