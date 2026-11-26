import type { ImageContent } from "omk-ai";
import { AttachmentStore } from "../../core/attachment-store.ts";
import {
	describePromptImageAttachment,
	PROMPT_ATTACHMENT_LIMITS,
	PromptAttachmentError,
	type PromptAttachmentSource,
} from "../../core/prompt-attachment.ts";
import { parseAttachmentPaths, pastedImagePaths, readPromptImageFile } from "../../core/prompt-image-files.ts";
import { readClipboardImage } from "../../utils/clipboard-image.ts";

interface DraftHost {
	readonly cwd: () => string;
	readonly changed: () => void;
	readonly status: (message: string) => void;
	readonly warning: (message: string) => void;
}

interface AcquiredImage {
	readonly bytes: Uint8Array;
	readonly source: PromptAttachmentSource;
}

/** Serial acquisition and draft ownership, independent of editor swaps and provider submission. */
export class PromptAttachmentDraft {
	readonly store = new AttachmentStore();
	private readonly host: DraftHost;
	private epoch = 0;
	private readonly pendingEpochs = new Map<number, number>();
	private tail: Promise<void> = Promise.resolve();
	private disposed = false;

	constructor(host: DraftHost) {
		this.host = host;
	}

	get ids(): readonly string[] {
		return this.store.list().map((attachment) => attachment.id);
	}

	get busy(): boolean {
		return !this.disposed && (this.pendingEpochs.get(this.epoch) ?? 0) > 0;
	}

	dispose(): void {
		this.disposed = true;
		this.epoch++;
		this.store.clear();
	}

	materialize(ids: readonly string[]): ImageContent[] {
		return this.store.materializeImages(ids);
	}

	consume(ids: readonly string[]): void {
		for (const id of ids) this.store.remove(id);
		this.host.changed();
	}

	clear(): void {
		this.epoch++;
		this.tail = Promise.resolve();
		this.store.clear();
		this.host.changed();
	}

	/** Returns false for ordinary text; consumes empty paste frames and file-only drops. */
	paste(text: string): boolean {
		if (text === "") {
			void this.clipboard();
			return true;
		}
		const paths = pastedImagePaths(text);
		if (!paths) return false;
		void this.addFiles(paths);
		return true;
	}

	clipboard(): Promise<void> {
		return this.acquire(async () => {
			const image = await readClipboardImage();
			if (!image) return [];
			return [{ bytes: image.bytes, source: "clipboard" }];
		});
	}

	addFiles(paths: readonly string[]): Promise<void> {
		const cwd = this.host.cwd();
		return this.acquire(async () => {
			if (!paths.length || paths.length > PROMPT_ATTACHMENT_LIMITS.maxAttachments) {
				throw new PromptAttachmentError("limit-reached", "Attach between 1 and 8 image files at a time.");
			}
			const images: AcquiredImage[] = [];
			let bytes = 0;
			for (const path of paths) {
				const image = await readPromptImageFile(path, cwd);
				bytes += image.length;
				if (bytes > PROMPT_ATTACHMENT_LIMITS.maxDraftBytes)
					throw new PromptAttachmentError("too-large", "Image batch exceeds 32 MiB.");
				images.push({ bytes: image, source: "file" });
			}
			return images;
		});
	}

	async command(argument: string): Promise<void> {
		const match = argument.match(/^(\S+)(?:\s+([\s\S]*))?$/);
		const verb = match?.[1] ?? "list";
		const rest = match?.[2] ?? "";
		switch (verb) {
			case "list": {
				const items = this.store.list();
				this.host.status(
					items.length
						? items.map((item, i) => `${i + 1}. ${describePromptImageAttachment(item)}`).join(" | ")
						: "No image attachments.",
				);
				return;
			}
			case "clear":
				this.clear();
				this.host.status("Image attachments cleared.");
				return;
			case "remove":
			case "rm": {
				const ids = this.ids;
				const index = rest === "" ? ids.length - 1 : /^\d+$/.test(rest) ? Number(rest) - 1 : -1;
				const id = ids[index];
				if (!id) this.host.warning("No attachment at that position. Use /attach list.");
				else {
					this.store.remove(id);
					this.host.changed();
					this.host.status("Image attachment removed.");
				}
				return;
			}
			case "paste":
				await this.clipboard();
				return;
			case "add":
				try {
					await this.addFiles(parseAttachmentPaths(rest));
				} catch (error) {
					this.report(error);
				}
				return;
			default:
				this.host.status("Usage: /attach [add <paths>|paste|list|clear|remove [n]]");
		}
	}

	private acquire(load: () => Promise<readonly AcquiredImage[]>): Promise<void> {
		if (this.disposed) return Promise.resolve();
		const epoch = this.epoch;
		this.pendingEpochs.set(epoch, (this.pendingEpochs.get(epoch) ?? 0) + 1);
		this.host.changed();
		const work = this.tail
			.then(async () => {
				if (epoch !== this.epoch) return;
				const images = await load();
				if (epoch !== this.epoch) return;
				if (!images.length) {
					this.host.status("No image in clipboard. Copy a screenshot, then press Alt+V (or Ctrl+V if forwarded).");
					return;
				}
				const original = new Set(this.ids);
				try {
					for (const image of images) this.store.put(image.bytes, image.source);
				} catch (error) {
					for (const id of this.ids) if (!original.has(id)) this.store.remove(id);
					throw error;
				}
				this.host.status(
					`${this.ids.length - original.size} new image(s) attached; ${this.ids.length} total. Submit when ready.`,
				);
			})
			.catch((error: unknown) => {
				if (epoch === this.epoch) this.report(error);
			})
			.finally(() => {
				const remaining = (this.pendingEpochs.get(epoch) ?? 1) - 1;
				if (remaining > 0) this.pendingEpochs.set(epoch, remaining);
				else this.pendingEpochs.delete(epoch);
				if (!this.disposed) this.host.changed();
			});
		this.tail = work;
		return work;
	}

	private report(error: unknown): void {
		this.host.warning(`Image attachment failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}
