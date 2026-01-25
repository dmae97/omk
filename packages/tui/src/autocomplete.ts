import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Check if query is a subsequence of target (fuzzy match).
 * "wig" matches "skill:wig" because w-i-g appear in order.
 */
function fuzzyMatch(query: string, target: string): boolean {
	if (query.length === 0) return true;
	if (query.length > target.length) return false;

	let qi = 0;
	for (let ti = 0; ti < target.length && qi < query.length; ti++) {
		if (query[qi] === target[ti]) qi++;
	}
	return qi === query.length;
}

/**
 * Score a fuzzy match. Higher = better match.
 * Prioritizes: exact match > starts-with > contains > subsequence
 */
function fuzzyScore(query: string, target: string): number {
	if (query.length === 0) return 1;
	if (target === query) return 100;
	if (target.startsWith(query)) return 80;
	if (target.includes(query)) return 60;

	// Subsequence match - score by how "tight" the match is
	// (fewer gaps between matched characters = higher score)
	let qi = 0;
	let gaps = 0;
	let lastMatchIdx = -1;
	for (let ti = 0; ti < target.length && qi < query.length; ti++) {
		if (query[qi] === target[ti]) {
			if (lastMatchIdx >= 0 && ti - lastMatchIdx > 1) gaps++;
			lastMatchIdx = ti;
			qi++;
		}
	}
	if (qi !== query.length) return 0;

	// Base score 40 for subsequence, minus penalty for gaps
	return Math.max(1, 40 - gaps * 5);
}

async function walkDirectoryWithFd(
	baseDir: string,
	fdPath: string,
	query: string,
	maxResults: number,
): Promise<Array<{ path: string; isDirectory: boolean }>> {
	const args = ["--base-directory", baseDir, "--max-results", String(maxResults), "--type", "f", "--type", "d"];

	if (query) {
		args.push(query);
	}

	const proc = Bun.spawn([fdPath, ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});

	const exitCode = await proc.exited;
	if (exitCode !== 0 || !proc.stdout) {
		return [];
	}

	const stdout = await new Response(proc.stdout).text();
	const lines = stdout.trim().split("\n").filter(Boolean);
	const results: Array<{ path: string; isDirectory: boolean }> = [];

	for (const line of lines) {
		const isDirectory = line.endsWith("/");
		results.push({
			path: line,
			isDirectory,
		});
	}

	return results;
}

export interface AutocompleteItem {
	value: string;
	label: string;
	description?: string;
}

export interface SlashCommand {
	name: string;
	description?: string;
	// Function to get argument completions for this command
	// Returns null if no argument completion is available
	getArgumentCompletions?(argumentPrefix: string): AutocompleteItem[] | null;
}

export interface AutocompleteProvider {
	// Get autocomplete suggestions for current text/cursor position
	// Returns null if no suggestions available
	getSuggestions(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
	): Promise<{
		items: AutocompleteItem[];
		prefix: string; // What we're matching against (e.g., "/" or "src/")
	} | null>;

	// Apply the selected item
	// Returns the new text and cursor position
	applyCompletion(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		item: AutocompleteItem,
		prefix: string,
	): {
		lines: string[];
		cursorLine: number;
		cursorCol: number;
	};
}

// Combined provider that handles both slash commands and file paths
export class CombinedAutocompleteProvider implements AutocompleteProvider {
	private commands: (SlashCommand | AutocompleteItem)[];
	private basePath: string;
	private fdPath: string | null;
	private dirCache: Map<string, { entries: fs.Dirent[]; timestamp: number }> = new Map();
	private readonly DIR_CACHE_TTL = 2000; // 2 seconds

	constructor(
		commands: (SlashCommand | AutocompleteItem)[] = [],
		basePath: string = process.cwd(),
		fdPath: string | null = null,
	) {
		this.commands = commands;
		this.basePath = basePath;
		this.fdPath = fdPath ?? Bun.which("fd") ?? Bun.which("fdfind");
	}

	async getSuggestions(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
	): Promise<{ items: AutocompleteItem[]; prefix: string } | null> {
		const currentLine = lines[cursorLine] || "";
		const textBeforeCursor = currentLine.slice(0, cursorCol);

		// Check for @ file reference (fuzzy search) - must be after a space or at start
		const atMatch = textBeforeCursor.match(/(?:^|[\s])(@[^\s]*)$/);
		if (atMatch) {
			const prefix = atMatch[1] ?? "@"; // The @... part
			const query = prefix.slice(1); // Remove the @
			const suggestions =
				query.length > 0 ? await this.getFuzzyFileSuggestions(query) : await this.getFileSuggestions("@");
			if (suggestions.length === 0 && query.length > 0) {
				const fallback = await this.getFileSuggestions(prefix);
				if (fallback.length === 0) return null;
				return { items: fallback, prefix };
			}
			if (suggestions.length === 0) return null;

			return {
				items: suggestions,
				prefix: prefix,
			};
		}

		// Check for slash commands
		if (textBeforeCursor.startsWith("/")) {
			const spaceIndex = textBeforeCursor.indexOf(" ");

			if (spaceIndex === -1) {
				// No space yet - complete command names
				const prefix = textBeforeCursor.slice(1); // Remove the "/"
				const lowerPrefix = prefix.toLowerCase();

				// Filter commands using fuzzy matching (subsequence match)
				const matches = this.commands
					.filter(cmd => {
						const name = "name" in cmd ? cmd.name : cmd.value;
						if (!name) return false;
						// Match name or description
						if (fuzzyMatch(lowerPrefix, name.toLowerCase())) return true;
						const desc = cmd.description?.toLowerCase();
						return desc ? fuzzyMatch(lowerPrefix, desc) : false;
					})
					.map(cmd => {
						const name = "name" in cmd ? cmd.name : cmd.value;
						const lowerName = name?.toLowerCase() ?? "";
						const lowerDesc = cmd.description?.toLowerCase() ?? "";
						// Score name matches higher than description matches
						const nameScore = fuzzyMatch(lowerPrefix, lowerName) ? fuzzyScore(lowerPrefix, lowerName) : 0;
						const descScore = fuzzyMatch(lowerPrefix, lowerDesc) ? fuzzyScore(lowerPrefix, lowerDesc) * 0.5 : 0;
						return {
							value: name,
							label: "name" in cmd ? cmd.name : cmd.label,
							score: Math.max(nameScore, descScore),
							...(cmd.description && { description: cmd.description }),
						};
					})
					.sort((a, b) => b.score - a.score)
					.map(({ score: _, ...rest }) => rest);

				if (matches.length === 0) return null;

				return {
					items: matches,
					prefix: textBeforeCursor,
				};
			} else {
				// Space found - complete command arguments
				const commandName = textBeforeCursor.slice(1, spaceIndex); // Command without "/"
				const argumentText = textBeforeCursor.slice(spaceIndex + 1); // Text after space

				const command = this.commands.find(cmd => {
					const name = "name" in cmd ? cmd.name : cmd.value;
					return name === commandName;
				});
				if (!command || !("getArgumentCompletions" in command) || !command.getArgumentCompletions) {
					return null; // No argument completion for this command
				}

				const argumentSuggestions = command.getArgumentCompletions(argumentText);
				if (!argumentSuggestions || argumentSuggestions.length === 0) {
					return null;
				}

				return {
					items: argumentSuggestions,
					prefix: argumentText,
				};
			}
		}

		// Check for file paths - triggered by Tab or if we detect a path pattern
		const pathMatch = this.extractPathPrefix(textBeforeCursor, false);

		if (pathMatch !== null) {
			const suggestions = await this.getFileSuggestions(pathMatch);
			if (suggestions.length === 0) return null;

			// Check if we have an exact match that is a directory
			// In that case, we might want to return suggestions for the directory content instead
			// But only if the prefix ends with /
			if (suggestions.length === 1 && suggestions[0]?.value === pathMatch && !pathMatch.endsWith("/")) {
				// Exact match found (e.g. user typed "src" and "src/" is the only match)
				// We still return it so user can select it and add /
				return {
					items: suggestions,
					prefix: pathMatch,
				};
			}

			return {
				items: suggestions,
				prefix: pathMatch,
			};
		}

		return null;
	}

	applyCompletion(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		item: AutocompleteItem,
		prefix: string,
	): { lines: string[]; cursorLine: number; cursorCol: number } {
		const currentLine = lines[cursorLine] || "";
		const beforePrefix = currentLine.slice(0, cursorCol - prefix.length);
		const afterCursor = currentLine.slice(cursorCol);

		// Check if we're completing a slash command (prefix starts with "/" but NOT a file path)
		// Slash commands are at the start of the line and don't contain path separators after the first /
		const isSlashCommand = prefix.startsWith("/") && beforePrefix.trim() === "" && !prefix.slice(1).includes("/");
		if (isSlashCommand) {
			// This is a command name completion
			const newLine = `${beforePrefix}/${item.value} ${afterCursor}`;
			const newLines = [...lines];
			newLines[cursorLine] = newLine;

			return {
				lines: newLines,
				cursorLine,
				cursorCol: beforePrefix.length + item.value.length + 2, // +2 for "/" and space
			};
		}

		// Check if we're completing a file attachment (prefix starts with "@")
		if (prefix.startsWith("@")) {
			// This is a file attachment completion
			const newLine = `${beforePrefix + item.value} ${afterCursor}`;
			const newLines = [...lines];
			newLines[cursorLine] = newLine;

			return {
				lines: newLines,
				cursorLine,
				cursorCol: beforePrefix.length + item.value.length + 1, // +1 for space
			};
		}

		// Check if we're in a slash command context (beforePrefix contains "/command ")
		const textBeforeCursor = currentLine.slice(0, cursorCol);
		if (textBeforeCursor.includes("/") && textBeforeCursor.includes(" ")) {
			// This is likely a command argument completion
			const newLine = beforePrefix + item.value + afterCursor;
			const newLines = [...lines];
			newLines[cursorLine] = newLine;

			return {
				lines: newLines,
				cursorLine,
				cursorCol: beforePrefix.length + item.value.length,
			};
		}

		// For file paths, complete the path
		const newLine = beforePrefix + item.value + afterCursor;
		const newLines = [...lines];
		newLines[cursorLine] = newLine;

		return {
			lines: newLines,
			cursorLine,
			cursorCol: beforePrefix.length + item.value.length,
		};
	}

	// Extract a path-like prefix from the text before cursor
	private extractPathPrefix(text: string, forceExtract: boolean = false): string | null {
		// Check for @ file attachment syntax first
		const atMatch = text.match(/@([^\s]*)$/);
		if (atMatch) {
			return atMatch[0]; // Return the full @path pattern
		}

		// Simple approach: find the last whitespace/delimiter and extract the word after it
		// This avoids catastrophic backtracking from nested quantifiers
		const lastDelimiterIndex = Math.max(
			text.lastIndexOf(" "),
			text.lastIndexOf("\t"),
			text.lastIndexOf('"'),
			text.lastIndexOf("'"),
			text.lastIndexOf("="),
		);

		const pathPrefix = lastDelimiterIndex === -1 ? text : text.slice(lastDelimiterIndex + 1);

		// For forced extraction (Tab key), always return something
		if (forceExtract) {
			return pathPrefix;
		}

		// For natural triggers, return if it looks like a path, ends with /, starts with ~/, .
		// Only return empty string if the text looks like it's starting a path context
		if (pathPrefix.includes("/") || pathPrefix.startsWith(".") || pathPrefix.startsWith("~/")) {
			return pathPrefix;
		}

		// Return empty string only if we're at the beginning of the line or after a space
		// (not after quotes or other delimiters that don't suggest file paths)
		if (pathPrefix === "" && (text === "" || text.endsWith(" "))) {
			return pathPrefix;
		}

		return null;
	}

	// Expand home directory (~/) to actual home path
	private expandHomePath(filePath: string): string {
		if (filePath.startsWith("~/")) {
			const expandedPath = path.join(os.homedir(), filePath.slice(2));
			// Preserve trailing slash if original path had one
			return filePath.endsWith("/") && !expandedPath.endsWith("/") ? `${expandedPath}/` : expandedPath;
		} else if (filePath === "~") {
			return os.homedir();
		}
		return filePath;
	}

	private async getCachedDirEntries(searchDir: string): Promise<fs.Dirent[]> {
		const now = Date.now();
		const cached = this.dirCache.get(searchDir);

		if (cached && now - cached.timestamp < this.DIR_CACHE_TTL) {
			return cached.entries;
		}

		const entries = await fs.promises.readdir(searchDir, { withFileTypes: true });
		this.dirCache.set(searchDir, { entries, timestamp: now });

		if (this.dirCache.size > 100) {
			const sortedKeys = [...this.dirCache.entries()]
				.sort((a, b) => a[1].timestamp - b[1].timestamp)
				.slice(0, 50)
				.map(([key]) => key);
			for (const key of sortedKeys) {
				this.dirCache.delete(key);
			}
		}

		return entries;
	}

	public invalidateDirCache(dir?: string): void {
		if (dir) {
			this.dirCache.delete(dir);
		} else {
			this.dirCache.clear();
		}
	}

	// Get file/directory suggestions for a given path prefix
	private async getFileSuggestions(prefix: string): Promise<AutocompleteItem[]> {
		try {
			let searchDir: string;
			let searchPrefix: string;
			let expandedPrefix = prefix;
			let isAtPrefix = false;

			// Handle @ file attachment prefix
			if (prefix.startsWith("@")) {
				isAtPrefix = true;
				expandedPrefix = prefix.slice(1); // Remove the @
			}

			// Handle home directory expansion
			if (expandedPrefix.startsWith("~")) {
				expandedPrefix = this.expandHomePath(expandedPrefix);
			}

			if (
				expandedPrefix === "" ||
				expandedPrefix === "./" ||
				expandedPrefix === "../" ||
				expandedPrefix === "~" ||
				expandedPrefix === "~/" ||
				expandedPrefix === "/" ||
				prefix === "@"
			) {
				// Complete from specified position
				if (prefix.startsWith("~") || expandedPrefix === "/") {
					searchDir = expandedPrefix;
				} else {
					searchDir = path.join(this.basePath, expandedPrefix);
				}
				searchPrefix = "";
			} else if (expandedPrefix.endsWith("/")) {
				// If prefix ends with /, show contents of that directory
				if (prefix.startsWith("~") || expandedPrefix.startsWith("/")) {
					searchDir = expandedPrefix;
				} else {
					searchDir = path.join(this.basePath, expandedPrefix);
				}
				searchPrefix = "";
			} else {
				// Split into directory and file prefix
				const dir = path.dirname(expandedPrefix);
				const file = path.basename(expandedPrefix);
				if (prefix.startsWith("~") || expandedPrefix.startsWith("/")) {
					searchDir = dir;
				} else {
					searchDir = path.join(this.basePath, dir);
				}
				searchPrefix = file;
			}

			const entries = await this.getCachedDirEntries(searchDir);
			const suggestions: AutocompleteItem[] = [];

			for (const entry of entries) {
				if (!entry.name.toLowerCase().startsWith(searchPrefix.toLowerCase())) {
					continue;
				}

				// Check if entry is a directory (or a symlink pointing to a directory)
				let isDirectory = entry.isDirectory();
				if (!isDirectory && entry.isSymbolicLink()) {
					try {
						const fullPath = path.join(searchDir, entry.name);
						isDirectory = (await fs.promises.stat(fullPath)).isDirectory();
					} catch {
						// Broken symlink, file deleted between readdir and stat, or permission error
						continue;
					}
				}

				let relativePath: string;
				const name = entry.name;

				// Handle @ prefix path construction
				if (isAtPrefix) {
					const pathWithoutAt = expandedPrefix;
					if (pathWithoutAt.endsWith("/")) {
						relativePath = `@${pathWithoutAt}${name}`;
					} else if (pathWithoutAt.includes("/")) {
						if (pathWithoutAt.startsWith("~/")) {
							const homeRelativeDir = pathWithoutAt.slice(2); // Remove ~/
							const dir = path.dirname(homeRelativeDir);
							relativePath = `@~/${dir === "." ? name : path.join(dir, name)}`;
						} else {
							relativePath = `@${path.join(path.dirname(pathWithoutAt), name)}`;
						}
					} else {
						if (pathWithoutAt.startsWith("~")) {
							relativePath = `@~/${name}`;
						} else {
							relativePath = `@${name}`;
						}
					}
				} else if (prefix.endsWith("/")) {
					// If prefix ends with /, append entry to the prefix
					relativePath = prefix + name;
				} else if (prefix.includes("/")) {
					// Preserve ~/ format for home directory paths
					if (prefix.startsWith("~/")) {
						const homeRelativeDir = prefix.slice(2); // Remove ~/
						const dir = path.dirname(homeRelativeDir);
						relativePath = `~/${dir === "." ? name : path.join(dir, name)}`;
					} else if (prefix.startsWith("/")) {
						// Absolute path - construct properly
						const dir = path.dirname(prefix);
						if (dir === "/") {
							relativePath = `/${name}`;
						} else {
							relativePath = `${dir}/${name}`;
						}
					} else {
						relativePath = path.join(path.dirname(prefix), name);
					}
				} else {
					// For standalone entries, preserve ~/ if original prefix was ~/
					if (prefix.startsWith("~")) {
						relativePath = `~/${name}`;
					} else {
						relativePath = name;
					}
				}

				suggestions.push({
					value: isDirectory ? `${relativePath}/` : relativePath,
					label: name + (isDirectory ? "/" : ""),
				});
			}

			// Sort directories first, then alphabetically
			suggestions.sort((a, b) => {
				const aIsDir = a.value.endsWith("/");
				const bIsDir = b.value.endsWith("/");
				if (aIsDir && !bIsDir) return -1;
				if (!aIsDir && bIsDir) return 1;
				return a.label.localeCompare(b.label);
			});

			return suggestions;
		} catch {
			// Directory doesn't exist or not accessible
			return [];
		}
	}

	// Score an entry against the query (higher = better match)
	// isDirectory adds bonus to prioritize folders
	private scoreEntry(filePath: string, query: string, isDirectory: boolean): number {
		const fileName = path.basename(filePath);
		const lowerFileName = fileName.toLowerCase();
		const lowerQuery = query.toLowerCase();

		let score = 0;

		// Exact filename match (highest)
		if (lowerFileName === lowerQuery) score = 100;
		// Filename starts with query
		else if (lowerFileName.startsWith(lowerQuery)) score = 80;
		// Substring match in filename
		else if (lowerFileName.includes(lowerQuery)) score = 50;
		// Substring match in full path
		else if (filePath.toLowerCase().includes(lowerQuery)) score = 30;

		// Directories get a bonus to appear first
		if (isDirectory && score > 0) score += 10;

		return score;
	}

	private async getFuzzyFileSuggestions(query: string): Promise<AutocompleteItem[]> {
		if (!this.fdPath) {
			return [];
		}

		try {
			const entries = await walkDirectoryWithFd(this.basePath, this.fdPath, query, 100);

			const scoredEntries = entries
				.map(entry => ({
					...entry,
					score: query ? this.scoreEntry(entry.path, query, entry.isDirectory) : 1,
				}))
				.filter(entry => entry.score > 0);

			scoredEntries.sort((a, b) => b.score - a.score);
			const topEntries = scoredEntries.slice(0, 20);

			const suggestions: AutocompleteItem[] = [];
			for (const { path: entryPath, isDirectory } of topEntries) {
				const pathWithoutSlash = isDirectory ? entryPath.slice(0, -1) : entryPath;
				const entryName = path.basename(pathWithoutSlash);

				suggestions.push({
					value: `@${entryPath}`,
					label: entryName + (isDirectory ? "/" : ""),
					description: pathWithoutSlash,
				});
			}

			return suggestions;
		} catch {
			return [];
		}
	}

	// Force file completion (called on Tab key) - always returns suggestions
	async getForceFileSuggestions(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
	): Promise<{ items: AutocompleteItem[]; prefix: string } | null> {
		const currentLine = lines[cursorLine] || "";
		const textBeforeCursor = currentLine.slice(0, cursorCol);

		// Don't trigger if we're typing a slash command at the start of the line
		if (textBeforeCursor.trim().startsWith("/") && !textBeforeCursor.trim().includes(" ")) {
			return null;
		}

		// Force extract path prefix - this will always return something
		const pathMatch = this.extractPathPrefix(textBeforeCursor, true);
		if (pathMatch !== null) {
			const suggestions = await this.getFileSuggestions(pathMatch);
			if (suggestions.length === 0) return null;

			return {
				items: suggestions,
				prefix: pathMatch,
			};
		}

		return null;
	}

	// Check if we should trigger file completion (called on Tab key)
	shouldTriggerFileCompletion(lines: string[], cursorLine: number, cursorCol: number): boolean {
		const currentLine = lines[cursorLine] || "";
		const textBeforeCursor = currentLine.slice(0, cursorCol);

		// Don't trigger if we're typing a slash command at the start of the line
		if (textBeforeCursor.trim().startsWith("/") && !textBeforeCursor.trim().includes(" ")) {
			return false;
		}

		return true;
	}
}
