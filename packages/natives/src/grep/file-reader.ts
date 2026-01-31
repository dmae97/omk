/**
 * Cross-platform file reader for grep.
 *
 * Uses mmap for files <= 4MB on platforms that support it,
 * falls back to reading into a reusable buffer otherwise.
 */
import * as fs from "node:fs/promises";

const MAX_MMAP_SIZE = 4 * 1024 * 1024; // 4MB
export class FileReader {
	#buffer: Buffer | null = null;
	constructor(private readonly maxSize: number = MAX_MMAP_SIZE) {}
	#getBuffer(size: number): Buffer {
		if (!this.#buffer) {
			this.#buffer = Buffer.allocUnsafe(this.maxSize);
		}
		return this.#buffer.subarray(0, size);
	}

	async read(filePath: string): Promise<Uint8Array | null> {
		let fileSize: number;
		try {
			const stat = await fs.stat(filePath);
			fileSize = stat.size;
		} catch {
			return null;
		}

		// Skip files larger than buffer size (only search first 4MB worth)
		const readSize = Math.min(fileSize, this.maxSize);

		// Try mmap for small files (fast path on Linux/macOS)
		if (fileSize <= this.maxSize) {
			try {
				return Bun.mmap(filePath);
			} catch {
				// mmap not supported (Windows) or failed, fall through to read
			}
		}

		// Fall back to reading into buffer
		try {
			await using handle = await fs.open(filePath, "r");
			const buffer = this.#getBuffer(readSize);
			const { bytesRead } = await handle.read(buffer, 0, readSize, 0);
			return buffer.subarray(0, bytesRead);
		} catch {
			return null;
		}
	}
}
