import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { $ } from "bun";
import { nanoid } from "nanoid";
import { ensureTool } from "../../../utils/tools-manager";
import { createRequestSignal } from "./types";

const MAX_BYTES = 50 * 1024 * 1024; // 50MB for binary files

interface ExecResult {
	stdout: string;
	stderr: string;
	ok: boolean;
	exitCode: number;
}

async function exec(
	cmd: string,
	args: string[],
	options?: { timeout?: number; input?: string | Buffer },
): Promise<ExecResult> {
	void options;
	const result = await $`${cmd} ${args}`.quiet().nothrow();
	const decoder = new TextDecoder();
	return {
		stdout: result.stdout ? decoder.decode(result.stdout) : "",
		stderr: result.stderr ? decoder.decode(result.stderr) : "",
		ok: result.exitCode === 0,
		exitCode: result.exitCode ?? -1,
	};
}

export interface ConvertResult {
	content: string;
	ok: boolean;
	error?: string;
}

export interface BinaryFetchResult {
	buffer: Buffer;
	contentType: string;
	contentDisposition?: string;
	ok: boolean;
	status?: number;
	error?: string;
}

export async function convertWithMarkitdown(
	content: Buffer,
	extensionHint: string,
	timeout: number,
	signal?: AbortSignal,
): Promise<ConvertResult> {
	if (signal?.aborted) {
		return { content: "", ok: false, error: "aborted" };
	}

	const markitdown = await ensureTool("markitdown", true);
	if (!markitdown) {
		return { content: "", ok: false, error: "markitdown not available" };
	}

	// Write to temp file with extension hint
	const ext = extensionHint || ".bin";
	const tmpDir = tmpdir();
	const tmpFile = path.join(tmpDir, `omp-convert-${nanoid()}${ext}`);

	if (content.length > MAX_BYTES) {
		return { content: "", ok: false, error: `content exceeds ${MAX_BYTES} bytes` };
	}

	try {
		await Bun.write(tmpFile, content);
		const result = await exec(markitdown, [tmpFile], { timeout });
		if (!result.ok) {
			const stderr = result.stderr.trim();
			return {
				content: result.stdout,
				ok: false,
				error: stderr.length > 0 ? stderr : `markitdown failed (exit ${result.exitCode})`,
			};
		}
		return { content: result.stdout, ok: true };
	} finally {
		try {
			await rm(tmpFile, { force: true });
		} catch {}
	}
}

export async function fetchBinary(url: string, timeout: number, signal?: AbortSignal): Promise<BinaryFetchResult> {
	if (signal?.aborted) {
		return { buffer: Buffer.alloc(0), contentType: "", ok: false, error: "aborted" };
	}

	const { signal: requestSignal, cleanup } = createRequestSignal(timeout * 1000, signal);

	try {
		const response = await fetch(url, {
			signal: requestSignal,
			headers: {
				"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0",
			},
			redirect: "follow",
		});

		const contentType = response.headers.get("content-type") ?? "";
		const contentDisposition = response.headers.get("content-disposition") ?? undefined;

		if (!response.ok) {
			return {
				buffer: Buffer.alloc(0),
				contentType,
				contentDisposition,
				ok: false,
				status: response.status,
				error: `status ${response.status}`,
			};
		}

		const contentLength = response.headers.get("content-length");
		if (contentLength) {
			const size = Number.parseInt(contentLength, 10);
			if (Number.isFinite(size) && size > MAX_BYTES) {
				return {
					buffer: Buffer.alloc(0),
					contentType,
					contentDisposition,
					ok: false,
					status: response.status,
					error: `content-length ${size} exceeds ${MAX_BYTES}`,
				};
			}
		}

		const buffer = Buffer.from(await response.arrayBuffer());
		if (buffer.length > MAX_BYTES) {
			return {
				buffer: Buffer.alloc(0),
				contentType,
				contentDisposition,
				ok: false,
				status: response.status,
				error: `response exceeds ${MAX_BYTES} bytes`,
			};
		}

		return { buffer, contentType, contentDisposition, ok: true, status: response.status };
	} catch (err) {
		if (signal?.aborted) {
			return { buffer: Buffer.alloc(0), contentType: "", ok: false, error: "aborted" };
		}
		return {
			buffer: Buffer.alloc(0),
			contentType: "",
			ok: false,
			error: `request failed: ${String(err)}`,
		};
	} finally {
		cleanup();
	}
}
