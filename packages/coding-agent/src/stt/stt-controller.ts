import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { logger, Snowflake } from "@oh-my-pi/pi-utils";
import { settings } from "../config/settings";
import { ensureSTTDependencies } from "./downloader";
import { type RecordingHandle, startRecording, verifyRecordingFile } from "./recorder";
import { transcribe } from "./transcriber";

export type SttState = "idle" | "recording" | "transcribing";

interface ToggleOptions {
	showWarning(msg: string): void;
	showStatus(msg: string): void;
	onStateChange(state: SttState): void;
}

interface Editor {
	insertText(text: string): void;
}

export class STTController {
	#state: SttState = "idle";
	#recordingHandle: RecordingHandle | null = null;
	#tempFile: string | null = null;
	#depsResolved = false;
	#toggling = false;
	#disposed = false;
	#transcriptionAbort: AbortController | null = null;

	get state(): SttState {
		return this.#state;
	}

	#setState(state: SttState, options: ToggleOptions): void {
		this.#state = state;
		options.onStateChange(state);
	}

	async toggle(editor: Editor, options: ToggleOptions): Promise<void> {
		if (this.#toggling) return;
		this.#toggling = true;
		try {
			switch (this.#state) {
				case "idle":
					await this.#startRecording(options);
					break;
				case "recording":
					await this.#stopAndTranscribe(editor, options);
					break;
				case "transcribing":
					options.showStatus("Transcription in progress...");
					break;
			}
		} finally {
			this.#toggling = false;
		}
	}

	async #startRecording(options: ToggleOptions): Promise<void> {
		if (!this.#depsResolved) {
			try {
				options.showStatus("Checking STT dependencies...");
				await ensureSTTDependencies({
					modelName: settings.get("stt.modelName") as string | undefined,
					onProgress: p => options.showStatus(p.stage + (p.percent != null ? ` (${p.percent}%)` : "")),
				});
				this.#depsResolved = true;
			} catch (err) {
				const msg = err instanceof Error ? err.message : "Failed to setup STT dependencies";
				options.showWarning(msg);
				logger.error("STT dependency setup failed", { error: msg });
				return;
			}
		}
		const id = Snowflake.next();
		this.#tempFile = path.join(os.tmpdir(), `omp-stt-${id}.wav`);

		try {
			this.#recordingHandle = await startRecording(this.#tempFile);
			this.#setState("recording", options);
			options.showStatus("Recording...");
			logger.debug("STT recording started", { tempFile: this.#tempFile });
		} catch (err) {
			this.#tempFile = null;
			const msg = err instanceof Error ? err.message : "Failed to start recording";
			options.showWarning(msg);
			logger.error("STT recording failed to start", { error: msg });
		}
	}

	async #stopAndTranscribe(editor: Editor, options: ToggleOptions): Promise<void> {
		const handle = this.#recordingHandle;
		const tempFile = this.#tempFile;
		this.#recordingHandle = null;

		if (!handle || !tempFile) {
			this.#setState("idle", options);
			return;
		}

		try {
			await handle.stop();
			// Validate the recording produced a usable file
			await verifyRecordingFile(tempFile);
			this.#setState("transcribing", options);
			options.showStatus("Transcribing...");

			const sttSettings = {
				modelName: settings.get("stt.modelName") as string | undefined,
				language: settings.get("stt.language") as string | undefined,
			};
			this.#transcriptionAbort = new AbortController();
			const text = await transcribe(tempFile, { ...sttSettings, signal: this.#transcriptionAbort.signal });
			this.#transcriptionAbort = null;
			if (this.#disposed) return;
			if (text.length > 0) {
				editor.insertText(text);
				options.showStatus("");
			} else {
				options.showStatus("No speech detected.");
			}
			if (!this.#disposed) this.#setState("idle", options);
		} catch (err) {
			if (this.#disposed) return;
			if (err instanceof DOMException && err.name === "AbortError") {
				this.#setState("idle", options);
				return;
			}
			const msg = err instanceof Error ? err.message : "Transcription failed";
			options.showWarning(msg);
			logger.error("STT transcription failed", { error: msg });
			this.#setState("idle", options);
		} finally {
			try {
				await fs.rm(tempFile, { force: true });
			} catch {
				// best effort cleanup
			}
			this.#tempFile = null;
		}
	}

	dispose(): void {
		this.#disposed = true;
		if (this.#transcriptionAbort) {
			this.#transcriptionAbort.abort();
			this.#transcriptionAbort = null;
		}
		if (this.#recordingHandle) {
			this.#recordingHandle.stop().catch(() => {});
			this.#recordingHandle = null;
		}
		if (this.#tempFile) {
			fs.rm(this.#tempFile, { force: true }).catch(() => {});
			this.#tempFile = null;
		}
		this.#state = "idle";
		this.#depsResolved = false;
	}
}
