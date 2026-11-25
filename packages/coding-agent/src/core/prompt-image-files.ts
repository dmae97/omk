import { constants } from "node:fs";
import { open, stat } from "node:fs/promises";
import { isLocalPath, resolvePath } from "../utils/paths.ts";
import { createPromptImageAttachment, PROMPT_ATTACHMENT_LIMITS, PromptAttachmentError } from "./prompt-attachment.ts";

/** Parse terminal-dropped paths without invoking a shell or expanding shell expressions. */
export function parseAttachmentPaths(text: string): string[] {
	const paths: string[] = [];
	let token = "";
	let quote = "";
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		const next = text[i + 1];
		if (char === "\\" && next === "\\" && token === "") {
			token += "\\\\";
			i++;
		} else if (char === "\\" && quote !== "'" && next && /[\s'"\\]/.test(next)) {
			token += next;
			i++;
		} else if (quote) {
			if (char === quote) quote = "";
			else token += char;
		} else if (char === "'" || char === '"') {
			quote = char;
		} else if (/\s/.test(char)) {
			if (token) paths.push(token);
			token = "";
		} else token += char;
	}
	if (quote) throw new PromptAttachmentError("unsupported", "Unclosed quote in attachment path.");
	if (token) paths.push(token);
	return paths;
}

/** Only a paste consisting entirely of explicit local image paths is consumed as attachments. */
export function pastedImagePaths(text: string): string[] | undefined {
	try {
		const paths = parseAttachmentPaths(text);
		if (!paths.length || paths.length > PROMPT_ATTACHMENT_LIMITS.maxAttachments) return undefined;
		return paths.every((path) => {
			const explicit = /^(?:[/~.]|file:\/\/|[a-z]:[\\/]|\\\\)/i.test(path);
			return explicit && isLocalPath(path) && /\.(?:png|jpe?g|webp|gif)$/i.test(path);
		})
			? paths
			: undefined;
	} catch {
		return undefined; // Unrecognized pastes remain ordinary prompt text.
	}
}

/** Bounded asynchronous file acquisition; file extensions and clipboard MIME labels are not trusted. */
export async function readPromptImageFile(input: string, cwd: string): Promise<Uint8Array> {
	if (
		!isLocalPath(input) ||
		(/^[a-z][\w+.-]*:/i.test(input) && !/^file:\/\//i.test(input) && !/^[a-z]:[\\/]/i.test(input))
	) {
		throw new PromptAttachmentError("unsupported", "Only local image files can be attached.");
	}
	const filePath = resolvePath(input, cwd);
	const info = await stat(filePath);
	if (!info.isFile()) throw new PromptAttachmentError("unsupported", "Attachment must be a regular image file.");
	const max = PROMPT_ATTACHMENT_LIMITS.maxImageBytes;
	if (info.size > max) throw new PromptAttachmentError("too-large", "Image exceeds the 10 MiB attachment limit.");
	// Nonblocking open prevents a replaced FIFO from hanging the prompt between stat and open.
	const handle = await open(filePath, constants.O_RDONLY | constants.O_NONBLOCK);
	try {
		if (!(await handle.stat()).isFile())
			throw new PromptAttachmentError("unsupported", "Attachment is not a regular file.");
		const buffer = Buffer.alloc(max + 1);
		let length = 0;
		while (length < buffer.length) {
			const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
			if (!bytesRead) break;
			length += bytesRead;
		}
		const bytes = Buffer.from(buffer.subarray(0, length));
		createPromptImageAttachment(bytes, "file");
		return bytes;
	} finally {
		await handle.close();
	}
}
