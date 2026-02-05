import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ptree, Snowflake } from "@oh-my-pi/pi-utils";
import { ensureTool } from "../../utils/tools-manager";

const MAX_BYTES = 50 * 1024 * 1024; // 50MB for binary files

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
	userSignal?: AbortSignal,
): Promise<ConvertResult> {
	if (userSignal?.aborted) {
		return { content: "", ok: false, error: "aborted" };
	}

	const signal = ptree.combineSignals(userSignal, timeout * 1000);

	const markitdown = await ensureTool("markitdown", { signal, silent: true });
	if (!markitdown) {
		return { content: "", ok: false, error: "markitdown not available" };
	}

	// Write to temp file with extension hint
	const ext = extensionHint || ".bin";
	const tmpDir = os.tmpdir();
	const tmpFile = path.join(tmpDir, `omp-convert-${Snowflake.next()}${ext}`);

	if (content.length > MAX_BYTES) {
		return { content: "", ok: false, error: `content exceeds ${MAX_BYTES} bytes` };
	}

	try {
		await Bun.write(tmpFile, content);
		const result = await ptree.exec([markitdown, tmpFile], {
			signal,
			allowNonZero: true,
			stderr: "full",
		});
		if (!result.ok) {
			return {
				content: result.stdout,
				ok: false,
				error:
					result.stderr.length > 0 ? result.stderr : `markitdown failed (exit ${result.exitCode ?? "unknown"})`,
			};
		}
		return { content: result.stdout, ok: true };
	} finally {
		void fs.rm(tmpFile, { force: true }).catch(() => {});
	}
}

const kEmptyBuffer = Buffer.alloc(0);

export async function fetchBinary(url: string, timeout: number, userSignal?: AbortSignal): Promise<BinaryFetchResult> {
	if (userSignal?.aborted) {
		return { buffer: kEmptyBuffer, contentType: "", ok: false, error: "aborted" };
	}

	const signal = ptree.combineSignals(userSignal, timeout * 1000);

	try {
		const response = await fetch(url, {
			signal,
			headers: {
				"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0",
			},
			redirect: "follow",
		});

		const contentType = response.headers.get("content-type") ?? "";
		const contentDisposition = response.headers.get("content-disposition") ?? undefined;

		if (!response.ok) {
			return {
				buffer: kEmptyBuffer,
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
					buffer: kEmptyBuffer,
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
				buffer: kEmptyBuffer,
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
			return { buffer: kEmptyBuffer, contentType: "", ok: false, error: "aborted" };
		}
		return {
			buffer: kEmptyBuffer,
			contentType: "",
			ok: false,
			error: `request failed: ${String(err)}`,
		};
	}
}
