/**
 * Session-scoped manager for agent output IDs.
 *
 * Ensures unique output IDs across task tool invocations within a session.
 * Prefixes each ID with a sequential number (e.g., "0-AuthProvider", "1-AuthApi").
 *
 * This enables reliable agent:// URL resolution and prevents artifact collisions.
 */

import * as fs from "node:fs/promises";

/**
 * Manages agent output ID allocation to ensure uniqueness.
 *
 * Each allocated ID gets a numeric prefix based on allocation order.
 * On resume, scans existing files to find the next available index.
 */
export class AgentOutputManager {
	#nextId = 0;
	#initialized = false;
	readonly #getArtifactsDir: () => string | null;

	constructor(getArtifactsDir: () => string | null) {
		this.#getArtifactsDir = getArtifactsDir;
	}

	/**
	 * Scan existing agent output files to find the next available ID.
	 * This ensures we don't overwrite outputs when resuming a session.
	 */
	async #ensureInitialized(): Promise<void> {
		if (this.#initialized) return;
		this.#initialized = true;

		const dir = this.#getArtifactsDir();
		if (!dir) return;

		let files: string[];
		try {
			files = await fs.readdir(dir);
		} catch {
			return; // Directory doesn't exist yet
		}

		let maxId = -1;
		for (const file of files) {
			// Agent outputs are named: {index}-{id}.md (e.g., "0-AuthProvider.md")
			const match = file.match(/^(\d+)-.*\.md$/);
			if (match) {
				const id = parseInt(match[1], 10);
				if (id > maxId) maxId = id;
			}
		}
		this.#nextId = maxId + 1;
	}

	/**
	 * Allocate a unique ID with numeric prefix.
	 *
	 * @param id Requested ID (e.g., "AuthProvider")
	 * @returns Unique ID with prefix (e.g., "0-AuthProvider")
	 */
	async allocate(id: string): Promise<string> {
		await this.#ensureInitialized();
		return `${this.#nextId++}-${id}`;
	}

	/**
	 * Allocate unique IDs for a batch of tasks.
	 *
	 * @param ids Array of requested IDs
	 * @returns Array of unique IDs in same order
	 */
	async allocateBatch(ids: string[]): Promise<string[]> {
		await this.#ensureInitialized();
		return ids.map((id) => `${this.#nextId++}-${id}`);
	}

	/**
	 * Get the next ID that would be allocated (without allocating).
	 */
	async peekNextIndex(): Promise<number> {
		await this.#ensureInitialized();
		return this.#nextId;
	}

	/**
	 * Reset state (primarily for testing).
	 */
	reset(): void {
		this.#nextId = 0;
		this.#initialized = false;
	}
}
