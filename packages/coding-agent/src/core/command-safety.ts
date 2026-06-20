export type CommandRisk = "block" | "confirm" | "allow";

export interface CommandVerdict {
	risk: CommandRisk;
	rule: string;
	reason: string;
}

interface CommandPrefixResult {
	tokens: string[];
	privilege: string | undefined;
}

const RISK_RANK: Readonly<Record<CommandRisk, number>> = {
	allow: 0,
	confirm: 1,
	block: 2,
};

const PRIVILEGE_COMMANDS = new Set(["sudo", "su", "doas"]);
const SUDO_OPTIONS_WITH_VALUE = new Set([
	"-C",
	"--close-from",
	"-g",
	"--group",
	"-h",
	"--host",
	"-p",
	"--prompt",
	"-T",
	"--command-timeout",
	"-u",
	"--user",
]);
const GIT_GLOBAL_OPTIONS_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);

function verdict(risk: CommandRisk, rule: string, reason: string): CommandVerdict {
	return { risk, rule, reason };
}

function allowVerdict(): CommandVerdict {
	return verdict("allow", "command.allow", "No destructive or protected command pattern matched.");
}

function isEnvAssignment(token: string | undefined): boolean {
	return token !== undefined && /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token);
}

function tokenizeShellSegment(segment: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: string | undefined;
	let escaped = false;

	for (const character of segment.trim()) {
		if (escaped) {
			current += character;
			escaped = false;
			continue;
		}
		if (character === "\\" && quote !== "'") {
			escaped = true;
			continue;
		}
		if (quote) {
			if (character === quote) {
				quote = undefined;
			} else {
				current += character;
			}
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character;
			continue;
		}
		if (/\s/.test(character)) {
			if (current) {
				tokens.push(current);
				current = "";
			}
			continue;
		}
		current += character;
	}

	if (escaped) current += "\\";
	if (current) tokens.push(current);
	return tokens;
}

function splitShellCommands(command: string): string[] {
	const segments: string[] = [];
	let current = "";
	let quote: string | undefined;
	let escaped = false;

	for (let index = 0; index < command.length; index += 1) {
		const character = command[index];
		const next = command[index + 1];
		if (escaped) {
			current += character;
			escaped = false;
			continue;
		}
		if (character === "\\" && quote !== "'") {
			escaped = true;
			current += character;
			continue;
		}
		if (quote) {
			current += character;
			if (character === quote) quote = undefined;
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character;
			current += character;
			continue;
		}
		if (character === ";" || character === "|" || character === "\n" || character === "\r") {
			if (current.trim()) segments.push(current.trim());
			current = "";
			continue;
		}
		if (character === "&") {
			if (current.trim()) segments.push(current.trim());
			current = "";
			if (next === "&") index += 1;
			continue;
		}
		current += character;
	}

	if (current.trim()) segments.push(current.trim());
	return segments;
}

function skipEnvironmentPrefix(tokens: readonly string[], startIndex: number): number {
	let index = startIndex;
	while (isEnvAssignment(tokens[index])) index += 1;
	if (tokens[index]?.toLowerCase() !== "env") return index;

	index += 1;
	while (index < tokens.length) {
		const token = tokens[index];
		if (isEnvAssignment(token)) {
			index += 1;
			continue;
		}
		if (token?.startsWith("-")) {
			index += 1;
			continue;
		}
		break;
	}
	return index;
}

function optionConsumesValue(option: string, optionsWithValue: ReadonlySet<string>): boolean {
	if (option.includes("=")) return false;
	return optionsWithValue.has(option);
}

function skipPrivilegeOptions(tokens: readonly string[], startIndex: number, privilege: string): number {
	if (privilege !== "sudo" && privilege !== "doas") return startIndex;

	let index = startIndex;
	while (index < tokens.length) {
		const token = tokens[index];
		if (!token?.startsWith("-")) break;
		index += 1;
		if (token === "--") break;
		if (optionConsumesValue(token, SUDO_OPTIONS_WITH_VALUE)) index += 1;
	}
	return index;
}

function stripCommandPrefixes(tokens: readonly string[]): CommandPrefixResult {
	let index = skipEnvironmentPrefix(tokens, 0);
	const privilege = tokens[index]?.toLowerCase();
	if (!PRIVILEGE_COMMANDS.has(privilege ?? "")) {
		return { tokens: tokens.slice(index), privilege: undefined };
	}

	index += 1;
	index = skipPrivilegeOptions(tokens, index, privilege ?? "");
	index = skipEnvironmentPrefix(tokens, index);
	return { tokens: tokens.slice(index), privilege };
}

function hasForkBomb(command: string): boolean {
	return command.replace(/\s/g, "").includes(":(){:|:&};:");
}

function normalizePathTarget(target: string): string {
	return target.replace(/\/+$/g, (match) => (target === match ? "/" : "")).replace(/\/+/g, "/");
}

function classifyRmTarget(target: string): CommandVerdict | null {
	const normalized = normalizePathTarget(target);
	if (normalized === "/" || normalized === "/*" || normalized === "/.*") {
		return verdict("block", "fs.rm_rf_root", "Recursive forced rm targets filesystem root.");
	}
	if (normalized === "~" || normalized === "~/" || normalized === "~/*" || normalized === "~/.*") {
		return verdict("block", "fs.rm_rf_home", "Recursive forced rm targets the home directory.");
	}
	return null;
}

function classifyRm(tokens: readonly string[]): CommandVerdict | null {
	let hasRecursive = false;
	let hasForce = false;
	let endOfOptions = false;
	const targets: string[] = [];

	for (const token of tokens.slice(1)) {
		if (!endOfOptions && token === "--") {
			endOfOptions = true;
			continue;
		}
		if (!endOfOptions && token.startsWith("-") && token !== "-") {
			if (token === "--recursive") hasRecursive = true;
			if (token === "--force") hasForce = true;
			if (!token.startsWith("--")) {
				const flagCharacters = token.slice(1).split("");
				if (flagCharacters.some((flag) => flag === "r" || flag === "R")) hasRecursive = true;
				if (flagCharacters.includes("f")) hasForce = true;
			}
			continue;
		}
		targets.push(token);
	}

	if (!hasRecursive || !hasForce) return null;
	for (const target of targets) {
		const targetVerdict = classifyRmTarget(target);
		if (targetVerdict) return targetVerdict;
	}
	return null;
}

function isBlockDeviceOutput(token: string): boolean {
	return /^of=\/dev\/(?:sd[a-z][a-z0-9]*|nvme[0-9a-z]+|disk(?:[0-9].*|\/.*|$))/i.test(token);
}

function classifyDestructiveFilesystemCommand(command: string): CommandVerdict | null {
	if (hasForkBomb(command)) {
		return verdict("block", "process.fork_bomb", "Shell fork bomb pattern would exhaust process resources.");
	}

	const { tokens } = stripCommandPrefixes(tokenizeShellSegment(command));
	const executable = tokens[0]?.toLowerCase();
	if (!executable) return null;
	if (executable === "rm") return classifyRm(tokens);
	if (executable.startsWith("mkfs")) {
		return verdict("block", "fs.mkfs", "Filesystem formatting commands are blocked.");
	}
	if (executable === "dd" && tokens.slice(1).some(isBlockDeviceOutput)) {
		return verdict("block", "fs.dd_block_device", "dd writes directly to a block-device output path.");
	}
	return null;
}

function findGitCommand(tokens: readonly string[]): { command: string; args: string[]; originalArgs: string[] } | null {
	if (tokens[0]?.toLowerCase() !== "git") return null;
	let index = 1;
	while (index < tokens.length && tokens[index]?.startsWith("-")) {
		const option = tokens[index];
		const normalizedOption = option.toLowerCase();
		index += 1;
		if (option === "--") break;
		if (
			optionConsumesValue(option, GIT_GLOBAL_OPTIONS_WITH_VALUE) ||
			optionConsumesValue(normalizedOption, GIT_GLOBAL_OPTIONS_WITH_VALUE)
		) {
			index += 1;
		}
	}
	const command = tokens[index]?.toLowerCase();
	if (!command) return null;
	const originalArgs = tokens.slice(index + 1);
	return {
		command,
		args: originalArgs.map((argument) => argument.toLowerCase()),
		originalArgs,
	};
}

function hasGitCleanForceDirectory(args: readonly string[]): boolean {
	let hasForce = false;
	let hasDirectory = false;
	for (const arg of args) {
		if (arg === "--force") hasForce = true;
		if (arg === "-f") hasForce = true;
		if (arg === "-d") hasDirectory = true;
		if (arg.startsWith("-") && !arg.startsWith("--")) {
			const flags = arg.slice(1).split("");
			if (flags.includes("f")) hasForce = true;
			if (flags.includes("d")) hasDirectory = true;
		}
	}
	return hasForce && hasDirectory;
}

function classifyProtectedGitCommand(command: string): CommandVerdict | null {
	const { tokens } = stripCommandPrefixes(tokenizeShellSegment(command));
	const gitCommand = findGitCommand(tokens);
	if (!gitCommand) return null;

	if (gitCommand.command === "reset" && gitCommand.args.includes("--hard")) {
		return verdict("confirm", "git.reset_hard", "git reset --hard can discard worktree changes.");
	}
	if (gitCommand.command === "checkout" && gitCommand.originalArgs.includes(".")) {
		return verdict("confirm", "git.checkout_dot", "git checkout . can overwrite local worktree changes.");
	}
	if (gitCommand.command === "clean" && hasGitCleanForceDirectory(gitCommand.args)) {
		return verdict("confirm", "git.clean_force", "git clean -fd can delete untracked files and directories.");
	}
	if (gitCommand.command === "stash" && gitCommand.originalArgs.length === 0) {
		return verdict("confirm", "git.stash_bare", "Bare git stash can hide local worktree changes.");
	}
	if (gitCommand.command === "add") {
		if (gitCommand.originalArgs.includes(".")) {
			return verdict("confirm", "git.add_dot", "git add . can stage unrelated local changes.");
		}
		if (gitCommand.originalArgs.includes("-A") || gitCommand.args.includes("--all")) {
			return verdict("confirm", "git.add_all", "git add -A can stage unrelated local changes.");
		}
	}
	if (gitCommand.command === "commit" && gitCommand.args.includes("--no-verify")) {
		return verdict("confirm", "git.no_verify", "git commit --no-verify bypasses repository verification hooks.");
	}
	if (
		gitCommand.command === "push" &&
		(gitCommand.originalArgs.includes("-f") ||
			gitCommand.args.includes("--force") ||
			gitCommand.args.includes("--force-with-lease"))
	) {
		return verdict("confirm", "git.force_push", "Force-pushing can rewrite remote history.");
	}
	return null;
}

function classifyPrivilegeCommand(command: string): CommandVerdict | null {
	const tokens = tokenizeShellSegment(command);
	const index = skipEnvironmentPrefix(tokens, 0);
	const privilege = tokens[index]?.toLowerCase();
	if (!PRIVILEGE_COMMANDS.has(privilege ?? "")) return null;
	return verdict("confirm", `priv.${privilege}`, `${privilege} requires explicit per-command confirmation.`);
}

function classifySingleCommand(command: string): CommandVerdict {
	const trimmed = command.trim();
	if (!trimmed) return allowVerdict();

	const destructiveFilesystem = classifyDestructiveFilesystemCommand(trimmed);
	if (destructiveFilesystem) return destructiveFilesystem;

	const protectedGit = classifyProtectedGitCommand(trimmed);
	if (protectedGit) return protectedGit;

	const privilege = classifyPrivilegeCommand(trimmed);
	if (privilege) return privilege;

	return allowVerdict();
}

export function classifyShellCommand(command: string): CommandVerdict {
	let selected = classifySingleCommand(command);
	for (const segment of splitShellCommands(command)) {
		const candidate = classifySingleCommand(segment);
		if (RISK_RANK[candidate.risk] > RISK_RANK[selected.risk]) selected = candidate;
		if (selected.risk === "block") break;
	}
	return selected;
}

export function isDestructiveFilesystem(command: string): boolean {
	return classifyDestructiveFilesystemCommand(command) !== null;
}

export function isProtectedGitOperation(command: string): boolean {
	return classifyProtectedGitCommand(command) !== null;
}

export function isPrivilegeEscalation(command: string): boolean {
	return classifyPrivilegeCommand(command) !== null;
}
