/**
 * Session-scoped artifact storage for truncated tool outputs.
 *
 * Artifacts are stored in a directory alongside the session file,
 * accessible via artifact:// URLs or the $ARTIFACTS environment variable.
 */

import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Manages artifact storage for a session.
 *
 * Artifacts are stored with sequential IDs in the session's artifact directory.
 * The directory is created lazily on first write.
 */
export class ArtifactManager {
	#nextId = 0;
	readonly #dir: string;
	#dirCreated = false;

	/**
	 * @param sessionFile Path to the session .jsonl file
	 */
	constructor(sessionFile: string) {
		// Artifact directory is session file path without .jsonl extension
		this.#dir = sessionFile.slice(0, -6);
	}

	/**
	 * Artifact directory path.
	 * Directory may not exist until first artifact is saved.
	 */
	get dir(): string {
		return this.#dir;
	}

	async #ensureDir(): Promise<void> {
		if (!this.#dirCreated) {
			await mkdir(this.#dir, { recursive: true });
			this.#dirCreated = true;
		}
	}

	/**
	 * Atomically allocate next artifact ID.
	 * IDs are sequential within the session.
	 */
	allocateId(): number {
		return this.#nextId++;
	}

	/**
	 * Allocate a new artifact path and ID without writing content.
	 *
	 * @param toolType Tool name for file extension (e.g., "bash", "fetch")
	 */
	async allocatePath(toolType: string): Promise<{ id: string; path: string }> {
		await this.#ensureDir();
		const id = String(this.allocateId());
		const filename = `${id}.${toolType}.txt`;
		return { id, path: join(this.#dir, filename) };
	}

	/**
	 * Save content as an artifact and return the artifact ID.
	 *
	 * @param content Full content to save
	 * @param toolType Tool name for file extension (e.g., "bash", "fetch")
	 * @returns Artifact ID (numeric string)
	 */
	async save(content: string, toolType: string): Promise<string> {
		const { id, path } = await this.allocatePath(toolType);
		await Bun.write(path, content);
		return id;
	}

	/**
	 * Check if an artifact exists.
	 * @param id Artifact ID (numeric string)
	 */
	async exists(id: string): Promise<boolean> {
		const files = await this.listFiles();
		return files.some((f) => f.startsWith(`${id}.`));
	}

	/**
	 * List all artifact files in the directory.
	 * Returns empty array if directory doesn't exist.
	 */
	async listFiles(): Promise<string[]> {
		try {
			return await readdir(this.#dir);
		} catch {
			return [];
		}
	}

	/**
	 * Get the full path to an artifact file.
	 * Returns null if artifact doesn't exist.
	 *
	 * @param id Artifact ID (numeric string)
	 */
	async getPath(id: string): Promise<string | null> {
		const files = await this.listFiles();
		const match = files.find((f) => f.startsWith(`${id}.`));
		return match ? join(this.#dir, match) : null;
	}
}
