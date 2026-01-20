import { logger, ptree } from "@oh-my-pi/pi-utils";
import {
	RealtimeAgent,
	RealtimeSession,
	type RealtimeSessionConfig,
	type TransportEvent,
	type TransportLayerAudio,
	tool,
} from "@openai/agents/realtime";
import type { ReadableStreamDefaultReader as WebReadableStreamDefaultReader } from "stream/web";
import { z } from "zod";
import type { ModelRegistry } from "./model-registry";

const DEFAULT_REALTIME_MODEL = process.env.OMP_VOICE_REALTIME_MODEL ?? "gpt-realtime";
const DEFAULT_REALTIME_VOICE = process.env.OMP_VOICE_REALTIME_VOICE ?? "marin";
const DEFAULT_SAMPLE_RATE = 24000;
const DEFAULT_CHANNELS = 1;
const DEFAULT_BITS = 16;
const INTERRUPT_DEBOUNCE_MS = 200;
const MAX_RESULT_CHARS = 6000;
const MAX_PROGRESS_CHARS = 1400;
const PLAYBACK_ACTIVE_WINDOW_MS = 350;
// Echo cancellation: only suppress mic when playback is active and mic is much quieter
const ECHO_SUPPRESSION_RATIO = 2.5;
// Minimum RMS to ever send (absolute noise floor)
const MIC_NOISE_FLOOR = 0.005;
const PLAYBACK_ERROR_COOLDOWN_MS = 2000;

const SUPERVISOR_INSTRUCTIONS = [
	"You are the realtime voice supervisor for a terminal coding agent.",
	"Manage conversation flow, turn-taking, and what gets spoken aloud.",
	"For user speech: if unclear, ask exactly one short question.",
	"If clear, call send_to_agent with a concise instruction for the coding agent.",
	"If the user is greeting/smalltalk or gives no actionable request, respond briefly and do not call send_to_agent.",
	"Keep spoken responses to 1-2 short sentences (<=40 words).",
	"You will receive system updates prefixed with SYSTEM_EVENT, PROGRESS_UPDATE, or AGENT_OUTPUT.",
	"For AGENT_OUTPUT, always respond with a brief spoken summary and any single question needed.",
	"For PROGRESS_UPDATE, speak a short update only if it helps the user stay oriented.",
	"Do not call send_to_agent for system updates.",
	"If the user asks to stop or cancel work, call interrupt_agent.",
].join(" ");

type VoiceSupervisorCallbacks = {
	onSendToAgent: (text: string) => Promise<void> | void;
	onInterruptAgent: (reason?: string) => Promise<void> | void;
	onStatus: (status?: string) => void;
	onError: (error: Error) => void;
	onWarning?: (message: string) => void;
};

function normalizeText(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function truncateText(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}...`;
}

function toArrayBuffer(chunk: Uint8Array): ArrayBuffer {
	const buffer = chunk.buffer;
	if (buffer instanceof ArrayBuffer) {
		if (chunk.byteOffset === 0 && chunk.byteLength === buffer.byteLength) {
			return buffer;
		}
		return buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
	}
	const copy = new Uint8Array(chunk.byteLength);
	copy.set(chunk);
	return copy.buffer;
}

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	if (error && typeof error === "object") {
		const maybeMessage = (error as { message?: unknown }).message;
		if (typeof maybeMessage === "string") return maybeMessage;
		const nested = (error as { error?: unknown }).error;
		if (nested) return describeError(nested);
		try {
			return JSON.stringify(error);
		} catch {
			return String(error);
		}
	}
	return String(error);
}

type AudioToolStatus = {
	capture: { available: boolean; tool?: string; command?: string[] };
	playback: { available: boolean; tool?: string; command?: string[] };
};

function checkAudioTools(sampleRate: number, channels: number): AudioToolStatus {
	const captureResult = buildCaptureCommand(sampleRate, channels);
	const playbackCmd = buildPlaybackCommand(sampleRate, channels);

	return {
		capture: {
			available: captureResult !== null,
			tool: captureResult?.command[0],
			command: captureResult?.command,
		},
		playback: {
			available: playbackCmd !== null,
			tool: playbackCmd?.[0],
			command: playbackCmd ?? undefined,
		},
	};
}

function getMissingToolsMessage(): string {
	const platform = process.platform;
	const lines: string[] = ["Voice mode requires audio tools. Install one of the following:"];

	if (platform === "linux") {
		lines.push("");
		lines.push("  For capture (microphone):");
		lines.push("    • sox (recommended): sudo dnf install sox");
		lines.push("    • pulseaudio-utils: sudo dnf install pulseaudio-utils");
		lines.push("    • alsa-utils: sudo dnf install alsa-utils");
		lines.push("    • ffmpeg: sudo dnf install ffmpeg");
		lines.push("");
		lines.push("  For playback (speaker):");
		lines.push("    • sox (recommended): sudo dnf install sox");
		lines.push("    • ffmpeg: sudo dnf install ffmpeg");
		lines.push("");
		lines.push("  Set OMP_VOICE_CAPTURE_DEVICE to override the default capture device.");
		lines.push("  (Applies to all tools; for sox, this sets AUDIODEV internally.)");
	} else if (platform === "darwin") {
		lines.push("");
		lines.push("  • sox (recommended): brew install sox");
		lines.push("  • ffmpeg: brew install ffmpeg");
	} else if (platform === "win32") {
		lines.push("");
		lines.push("  • sox: choco install sox");
		lines.push("  • ffmpeg: choco install ffmpeg");
	}

	return lines.join("\n");
}

type CaptureCommand = { command: string[]; env?: Record<string, string> };

function buildCaptureCommand(sampleRate: number, channels: number): CaptureCommand | null {
	const platform = process.platform;
	// Allow user to override capture device via environment
	const captureDevice = process.env.OMP_VOICE_CAPTURE_DEVICE;

	// Prefer sox/rec as they work well across platforms
	const soxPath = Bun.which("sox") ?? Bun.which("rec");
	if (soxPath) {
		const command = [
			soxPath,
			"-q",
			"-d",
			"-t",
			"raw",
			"-r",
			String(sampleRate),
			"-e",
			"signed-integer",
			"-b",
			String(DEFAULT_BITS),
			"-c",
			String(channels),
			"-",
		];
		// sox uses AUDIODEV env var to override the default device
		const env = captureDevice ? { AUDIODEV: captureDevice } : undefined;
		return { command, env };
	}

	// On Linux, try PulseAudio first (parecord)
	if (platform === "linux") {
		const parecordPath = Bun.which("parecord");
		if (parecordPath) {
			const command = [parecordPath, "--raw", "--format=s16le", `--rate=${sampleRate}`, `--channels=${channels}`];
			if (captureDevice) {
				command.push(`--device=${captureDevice}`);
			}
			return { command };
		}
	}

	// ALSA arecord as fallback on Linux
	const arecordPath = Bun.which("arecord");
	if (arecordPath) {
		const device = captureDevice ?? "default";
		return {
			command: [
				arecordPath,
				"-q",
				"-D",
				device,
				"-f",
				"S16_LE",
				"-r",
				String(sampleRate),
				"-c",
				String(channels),
				"-t",
				"raw",
			],
		};
	}

	// ffmpeg fallback with platform-specific input
	const ffmpegPath = Bun.which("ffmpeg");
	if (ffmpegPath) {
		if (platform === "darwin") {
			const device = captureDevice ?? ":0";
			return {
				command: [
					ffmpegPath,
					"-hide_banner",
					"-loglevel",
					"error",
					"-f",
					"avfoundation",
					"-i",
					device,
					"-ac",
					String(channels),
					"-ar",
					String(sampleRate),
					"-f",
					"s16le",
					"-",
				],
			};
		}
		if (platform === "linux") {
			// Try PulseAudio format first, fall back to ALSA
			const hasPulse = Bun.which("pulseaudio") || Bun.which("pipewire-pulse") || process.env.PULSE_SERVER;
			const format = hasPulse ? "pulse" : "alsa";
			const device = captureDevice ?? "default";
			return {
				command: [
					ffmpegPath,
					"-hide_banner",
					"-loglevel",
					"error",
					"-f",
					format,
					"-i",
					device,
					"-ac",
					String(channels),
					"-ar",
					String(sampleRate),
					"-f",
					"s16le",
					"-",
				],
			};
		}
		if (platform === "win32") {
			const device = captureDevice ?? "audio=default";
			return {
				command: [
					ffmpegPath,
					"-hide_banner",
					"-loglevel",
					"error",
					"-f",
					"dshow",
					"-i",
					device,
					"-ac",
					String(channels),
					"-ar",
					String(sampleRate),
					"-f",
					"s16le",
					"-",
				],
			};
		}
	}

	return null;
}

function buildPlaybackCommand(sampleRate: number, channels: number): string[] | null {
	const preferred = process.env.OMP_VOICE_PLAYBACK?.toLowerCase();
	const ffplayPath = Bun.which("ffplay");
	const playPath = Bun.which("play");
	const soxPath = Bun.which("sox");

	const playCommand = playPath
		? [
				playPath,
				"-q",
				"-t",
				"raw",
				"-r",
				String(sampleRate),
				"-e",
				"signed-integer",
				"-b",
				String(DEFAULT_BITS),
				"-c",
				String(channels),
				"-",
			]
		: null;

	const soxCommand = soxPath
		? [
				soxPath,
				"-q",
				"-t",
				"raw",
				"-r",
				String(sampleRate),
				"-e",
				"signed-integer",
				"-b",
				String(DEFAULT_BITS),
				"-c",
				String(channels),
				"-",
				"-d",
			]
		: null;

	const ffplayCommand = ffplayPath
		? [
				ffplayPath,
				"-nodisp",
				"-autoexit",
				"-hide_banner",
				"-loglevel",
				"error",
				"-fflags",
				"nobuffer",
				"-flags",
				"low_delay",
				"-f",
				"s16le",
				"-ar",
				String(sampleRate),
				"-ac",
				String(channels),
				"-",
			]
		: null;

	if (preferred === "ffplay") return ffplayCommand;
	if (preferred === "play") return playCommand ?? soxCommand;
	if (preferred === "sox") return soxCommand ?? playCommand;

	return playCommand ?? soxCommand ?? ffplayCommand;
}

function rms16le(buffer: Uint8Array): number {
	if (buffer.byteLength < 2) return 0;
	const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
	let sum = 0;
	let count = 0;
	for (let i = 0; i + 1 < buffer.byteLength; i += 2) {
		const sample = view.getInt16(i, true) / 32768;
		sum += sample * sample;
		count += 1;
	}
	if (count === 0) return 0;
	return Math.sqrt(sum / count);
}

export class VoiceSupervisor {
	private session: RealtimeSession | undefined = undefined;
	private captureProcess: ptree.ChildProcess | undefined = undefined;
	private captureReader: WebReadableStreamDefaultReader<Uint8Array> | undefined = undefined;
	private playbackProcess: ptree.ChildProcess | undefined = undefined;
	private playbackWriter:
		| {
				write: (chunk: Uint8Array) => Promise<void>;
				close: () => Promise<void>;
		  }
		| undefined = undefined;
	private active = false;
	private connected = false;
	private sessionReady = false;
	private lastInterruptAt = 0;
	private lastPlaybackAt = 0;
	private lastPlaybackRms = 0;
	private lastPlaybackErrorAt = 0;
	// Fallback transcript handling: track user speech when no tool call is made
	private pendingTranscript = "";
	private pendingResponseHasToolCall = false;
	private pendingResponseHasAudioOutput = false;

	constructor(
		private registry: ModelRegistry,
		private callbacks: VoiceSupervisorCallbacks,
	) {}

	/**
	 * Check if audio tools are available for voice mode.
	 * Returns null if all tools are available, or an error message if not.
	 */
	static checkAvailability(): { available: boolean; error?: string; tools?: AudioToolStatus } {
		const status = checkAudioTools(DEFAULT_SAMPLE_RATE, DEFAULT_CHANNELS);
		if (status.capture.available && status.playback.available) {
			return { available: true, tools: status };
		}

		const missing: string[] = [];
		if (!status.capture.available) missing.push("capture");
		if (!status.playback.available) missing.push("playback");

		return {
			available: false,
			error: `Missing audio ${missing.join(" and ")} tools.\n\n${getMissingToolsMessage()}`,
			tools: status,
		};
	}

	get isActive(): boolean {
		return this.active;
	}

	async start(): Promise<void> {
		if (this.active) return;

		const apiKey = await this.registry.getApiKeyForProvider("openai");
		if (!apiKey) {
			throw new Error("OpenAI API key not found (set OPENAI_API_KEY or login).");
		}

		this.active = true;
		this.lastInterruptAt = 0;
		this.sessionReady = false;
		this.lastPlaybackErrorAt = 0;
		this.pendingTranscript = "";
		this.pendingResponseHasToolCall = false;
		this.pendingResponseHasAudioOutput = false;
		this.callbacks.onStatus("Connecting realtime voice...");

		try {
			const agent = this.createSupervisorAgent();
			const session = new RealtimeSession(agent, {
				transport: "websocket",
				model: DEFAULT_REALTIME_MODEL,
				config: this.buildSessionConfig(),
			});

			this.session = session;
			this.bindSessionEvents(session);
			await session.connect({ apiKey });
			this.connected = session.transport.status === "connected";
			this.sessionReady = this.connected;
			if (!this.connected) {
				await this.waitForConnection(session, 5000);
			}
			await this.waitForSessionReady(session, 5000);
			await this.startCapture();
			await this.ensurePlayback();
			this.callbacks.onStatus("Listening... (auto-send on silence, Ctrl+Y to stop)");
		} catch (error) {
			await this.stop();
			throw new Error(describeError(error));
		}
	}

	async stop(): Promise<void> {
		if (!this.active) return;
		this.active = false;
		this.connected = false;
		this.sessionReady = false;
		await this.stopCapture();
		await this.resetPlayback();
		if (this.session) {
			this.session.close();
			this.session = undefined;
		}
		this.callbacks.onStatus(undefined);
	}

	notifyProgress(text: string): void {
		this.sendSystemMessage("PROGRESS_UPDATE", text, MAX_PROGRESS_CHARS);
	}

	notifyResult(text: string): void {
		this.sendSystemMessage("AGENT_OUTPUT", text, MAX_RESULT_CHARS);
	}

	private sendSystemMessage(prefix: string, text: string, maxChars: number): void {
		if (!this.session || !this.active) return;
		if (!this.connected || !this.sessionReady || this.session.transport.status !== "connected") return;
		const trimmed = normalizeText(text);
		if (!trimmed) return;
		const payload = `${prefix}: ${truncateText(trimmed, maxChars)}`;
		try {
			this.session.transport.sendEvent({
				type: "conversation.item.create",
				item: {
					type: "message",
					role: "system",
					content: [{ type: "input_text", text: payload }],
				},
			});
			this.session.transport.sendEvent({ type: "response.create" });
		} catch (error) {
			const message = describeError(error);
			if (message.includes("WebSocket is not connected")) return;
			this.callbacks.onError(error instanceof Error ? error : new Error(message));
		}
	}

	private createSupervisorAgent(): RealtimeAgent {
		const sendToAgentTool = tool({
			name: "send_to_agent",
			description: "Send a concise instruction to the coding agent.",
			parameters: z.object({
				text: z.string().min(1),
			}),
			execute: async ({ text }) => {
				const cleaned = normalizeText(text);
				if (cleaned) {
					await this.callbacks.onSendToAgent(cleaned);
				}
				return "sent";
			},
		});

		const interruptAgentTool = tool({
			name: "interrupt_agent",
			description: "Interrupt the coding agent immediately.",
			parameters: z.object({
				reason: z.string().optional(),
			}),
			execute: async ({ reason }) => {
				await this.callbacks.onInterruptAgent(reason);
				return "interrupted";
			},
		});

		return new RealtimeAgent({
			name: "Voice Supervisor",
			instructions: SUPERVISOR_INSTRUCTIONS,
			tools: [sendToAgentTool, interruptAgentTool],
			voice: DEFAULT_REALTIME_VOICE,
		});
	}

	private buildSessionConfig(): Partial<RealtimeSessionConfig> {
		return {
			outputModalities: ["audio"],
			audio: {
				input: {
					format: { type: "audio/pcm", rate: DEFAULT_SAMPLE_RATE },
					noiseReduction: { type: "near_field" },
					turnDetection: {
						type: "semantic_vad",
						createResponse: true,
						interruptResponse: true,
					},
				},
				output: {
					format: { type: "audio/pcm", rate: DEFAULT_SAMPLE_RATE },
					...(DEFAULT_REALTIME_VOICE ? { voice: DEFAULT_REALTIME_VOICE } : {}),
				},
			},
		};
	}

	private bindSessionEvents(session: RealtimeSession): void {
		session.transport.on("connection_change", (status) => {
			this.connected = status === "connected";
			if (this.connected) {
				this.sessionReady = true;
			} else {
				this.sessionReady = false;
			}
			if (!this.active) return;
			if (this.connected) {
				this.callbacks.onStatus("Listening... (auto-send on silence, Ctrl+Y to stop)");
			} else {
				this.callbacks.onStatus("Reconnecting realtime voice...");
			}
		});

		session.on("audio", (event: TransportLayerAudio) => {
			void this.handleAudio(event);
		});

		session.on("audio_start", () => {
			if (!this.active) return;
			this.pendingResponseHasAudioOutput = true;
			this.callbacks.onStatus("Speaking...");
		});

		session.on("audio_stopped", () => {
			if (!this.active) return;
			this.callbacks.onStatus("Listening... (auto-send on silence, Ctrl+Y to stop)");
		});

		session.on("audio_interrupted", () => {
			void this.resetPlayback();
			if (!this.active) return;
			this.callbacks.onStatus("Listening... (auto-send on silence, Ctrl+Y to stop)");
		});

		session.on("transport_event", (event: TransportEvent) => {
			this.handleTransportEvent(event);
		});

		session.on("error", (error) => {
			const message = describeError(error);
			logger.debug("voice-supervisor: realtime error", { error: message });
			if (message.includes("WebSocket is not connected")) {
				if (this.active) {
					this.callbacks.onStatus("Reconnecting realtime voice...");
				}
				return;
			}
			this.callbacks.onError(new Error(message));
		});
	}

	private handleTransportEvent(event: TransportEvent): void {
		if (!this.active) return;

		// Session ready
		if (event.type === "session.created") {
			this.sessionReady = true;
			return;
		}

		// User speech started - interrupt agent and reset tracking
		if (event.type === "input_audio_buffer.speech_started") {
			const now = Date.now();
			if (now - this.lastInterruptAt < INTERRUPT_DEBOUNCE_MS) return;
			this.lastInterruptAt = now;
			this.pendingTranscript = "";
			this.pendingResponseHasToolCall = false;
			this.pendingResponseHasAudioOutput = false;
			void this.callbacks.onInterruptAgent();
			return;
		}

		// User speech transcript completed - store for fallback
		if (event.type === "conversation.item.input_audio_transcription.completed") {
			const transcript = (event as { transcript?: string }).transcript;
			if (transcript && typeof transcript === "string") {
				this.pendingTranscript = normalizeText(transcript);
				logger.debug("voice-supervisor: transcript captured", { transcript: this.pendingTranscript });
			}
			return;
		}

		// Response started - begin tracking
		if (event.type === "response.created") {
			this.pendingResponseHasToolCall = false;
			this.pendingResponseHasAudioOutput = false;
			return;
		}

		// Tool call detected - mark so we know not to use fallback
		// Check multiple event types for robustness against API changes
		if (
			event.type === "function_call" ||
			event.type === "response.function_call_arguments.done" ||
			event.type === "response.function_call_arguments.delta" ||
			event.type === "response.output_item.added"
		) {
			// For output_item.added, only mark if it's a function_call type
			if (event.type === "response.output_item.added") {
				const item = (event as { item?: { type?: string } }).item;
				if (item?.type === "function_call") {
					this.pendingResponseHasToolCall = true;
				}
			} else {
				this.pendingResponseHasToolCall = true;
			}
			return;
		}

		// Audio output detected - mark so we don't fallback
		if (
			event.type === "response.output_audio.delta" ||
			event.type === "response.output_audio.done" ||
			event.type === "response.output_audio_transcript.delta" ||
			event.type === "response.output_audio_transcript.done" ||
			event.type === "response.content_part.added" ||
			event.type === "response.content_part.done"
		) {
			this.pendingResponseHasAudioOutput = true;
			return;
		}

		// Response completed - check if we need fallback
		if (event.type === "response.done") {
			// Only use fallback if we have a transcript AND there was no tool call AND no audio output
			// This prevents duplicate responses when the realtime assistant already spoke
			if (this.pendingTranscript && !this.pendingResponseHasToolCall && !this.pendingResponseHasAudioOutput) {
				logger.debug("voice-supervisor: using fallback transcript path", {
					transcript: this.pendingTranscript,
				});
				const transcript = this.pendingTranscript;
				this.pendingTranscript = "";
				// Queue the fallback asynchronously to avoid blocking
				setImmediate(() => {
					if (this.active) {
						void this.callbacks.onSendToAgent(transcript);
					}
				});
			}
			return;
		}
	}

	private async handleAudio(event: TransportLayerAudio): Promise<void> {
		if (!this.active) return;
		const now = Date.now();
		try {
			await this.ensurePlayback();
		} catch (error) {
			this.callbacks.onError(new Error(describeError(error)));
			return;
		}
		if (!this.playbackWriter) return;
		try {
			await this.playbackWriter.write(new Uint8Array(event.data));
			this.lastPlaybackAt = now;
			this.lastPlaybackRms = rms16le(new Uint8Array(event.data));
		} catch (error) {
			logger.debug("voice-supervisor: playback write failed", {
				error: describeError(error),
			});
			void this.resetPlayback();
		}
	}

	private async startCapture(): Promise<void> {
		const captureResult = buildCaptureCommand(DEFAULT_SAMPLE_RATE, DEFAULT_CHANNELS);
		if (!captureResult) {
			throw new Error(`No audio capture tool found.\n\n${getMissingToolsMessage()}`);
		}

		const { command, env: captureEnv } = captureResult;
		logger.debug("voice-supervisor: starting mic capture", { command, env: captureEnv });
		const proc = ptree.cspawn(command, {
			env: captureEnv ? { ...process.env, ...captureEnv } : undefined,
		});
		this.captureProcess = proc;
		const reader = proc.stdout.getReader();
		this.captureReader = reader;

		(async () => {
			while (this.active) {
				const { value, done } = await reader.read();
				if (done || !this.active) break;
				if (!value || !this.session) continue;
				if (!this.connected || !this.sessionReady || this.session.transport.status !== "connected") {
					continue;
				}

				const micRms = rms16le(value);
				const now = Date.now();
				const playbackActive = now - this.lastPlaybackAt < PLAYBACK_ACTIVE_WINDOW_MS;

				// Echo suppression: only skip if playback is active AND mic is very quiet relative to playback
				// This prevents feedback loops while allowing user to speak over the assistant
				if (playbackActive && micRms < MIC_NOISE_FLOOR && micRms < this.lastPlaybackRms / ECHO_SUPPRESSION_RATIO) {
					continue;
				}

				// Send all audio to realtime API - let semantic_vad handle turn detection
				const buffer = toArrayBuffer(value);
				if (buffer.byteLength === 0) continue;
				try {
					this.session.sendAudio(buffer);
				} catch (error) {
					const message = describeError(error);
					logger.debug("voice-supervisor: sendAudio failed", { error: message });
					if (message.includes("WebSocket is not connected")) {
						continue;
					}
					this.callbacks.onError(error instanceof Error ? error : new Error(message));
					return;
				}
			}
			if (this.active) {
				this.callbacks.onError(new Error("Voice capture stopped unexpectedly."));
			}
		})().catch((error) => {
			if (!this.active) return;
			logger.debug("voice-supervisor: capture loop error", {
				error: describeError(error),
			});
			this.callbacks.onError(new Error(describeError(error)));
		});
	}

	private async stopCapture(): Promise<void> {
		if (this.captureReader) {
			try {
				await this.captureReader.cancel();
			} catch {
				// ignore
			}
			this.captureReader = undefined;
		}
		if (this.captureProcess) {
			try {
				this.captureProcess.kill("SIGINT");
			} catch {
				// ignore
			}
			await this.captureProcess.exited;
			this.captureProcess = undefined;
		}
	}

	private async ensurePlayback(): Promise<void> {
		if (this.playbackProcess && this.playbackWriter) return;
		const command = buildPlaybackCommand(DEFAULT_SAMPLE_RATE, DEFAULT_CHANNELS);
		if (!command) {
			throw new Error(`No audio playback tool found.\n\n${getMissingToolsMessage()}`);
		}

		logger.debug("voice-supervisor: starting audio playback", { command });
		const proc = ptree.cspawn(command, {
			stdin: "pipe",
		});
		const startedAt = Date.now();

		this.playbackProcess = proc;
		const stdin = proc.stdin;
		if (!stdin) {
			throw new Error("Audio playback stdin unavailable.");
		}
		if ("getWriter" in stdin && typeof stdin.getWriter === "function") {
			const writer = (stdin as unknown as WritableStream<Uint8Array>).getWriter();
			this.playbackWriter = {
				write: async (chunk) => {
					await writer.write(chunk);
				},
				close: async () => {
					await writer.close();
				},
			};
		} else if ("write" in stdin && typeof (stdin as { write?: unknown }).write === "function") {
			const sink = stdin as unknown as {
				write: (chunk: Uint8Array) => undefined | number | Promise<undefined | number>;
				end?: () => undefined | number | Promise<undefined | number>;
				close?: () => undefined | number | Promise<undefined | number>;
			};
			this.playbackWriter = {
				write: async (chunk) => {
					await sink.write(chunk);
				},
				close: async () => {
					if (sink.end) {
						await sink.end();
					} else if (sink.close) {
						await sink.close();
					}
				},
			};
		} else {
			throw new Error("Audio playback stdin is not writable.");
		}

		proc.exited
			.then(() => {
				const code = proc.exitCode;
				if (this.playbackProcess === proc) {
					this.playbackProcess = undefined;
					this.playbackWriter = undefined;
				}
				const trimmed = proc.peekStderr().trim();
				if (trimmed) {
					logger.debug("voice-supervisor: playback stderr", { stderr: trimmed });
				}
				const elapsed = Date.now() - startedAt;
				if (code !== 0 && elapsed < 2000 && this.active && code !== null) {
					this.maybeWarnPlaybackFailure(trimmed || `exit code ${code}`);
				}
			})
			.catch(() => {
				// ignore
			});
	}

	private async resetPlayback(): Promise<void> {
		if (this.playbackWriter) {
			try {
				await this.playbackWriter.close();
			} catch {
				// ignore
			}
		}
		if (this.playbackProcess) {
			try {
				this.playbackProcess.kill();
			} catch {
				// ignore
			}
			await this.playbackProcess.exited;
		}
		this.playbackProcess = undefined;
		this.playbackWriter = undefined;
	}

	private maybeWarnPlaybackFailure(message: string): void {
		if (!this.callbacks.onWarning) return;
		const now = Date.now();
		if (now - this.lastPlaybackErrorAt < PLAYBACK_ERROR_COOLDOWN_MS) return;
		this.lastPlaybackErrorAt = now;
		this.callbacks.onWarning(`Audio playback failed: ${message}`);
	}

	private async waitForConnection(session: RealtimeSession, timeoutMs: number): Promise<void> {
		if (session.transport.status === "connected") {
			this.connected = true;
			return;
		}
		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				cleanup();
				reject(new Error("Realtime voice connection timed out."));
			}, timeoutMs);

			const cleanup = () => {
				clearTimeout(timeout);
				session.transport.off("connection_change", onChange);
			};

			const onChange = (status: string) => {
				if (status === "connected") {
					this.connected = true;
					cleanup();
					resolve();
				}
			};

			session.transport.on("connection_change", onChange);
		});
	}

	private async waitForSessionReady(session: RealtimeSession, timeoutMs: number): Promise<void> {
		if (this.sessionReady) return;
		await new Promise<void>((resolve, reject) => {
			let resolved = false;

			const cleanup = () => {
				clearTimeout(timeout);
				session.off("transport_event", onEvent);
			};

			const timeout = setTimeout(() => {
				if (resolved) return;
				resolved = true;
				cleanup();
				reject(new Error("Realtime voice session not ready."));
			}, timeoutMs);

			const onEvent = (event: TransportEvent) => {
				if (resolved) return;
				if (event.type === "session.created") {
					this.sessionReady = true;
					resolved = true;
					cleanup();
					resolve();
				}
			};

			session.on("transport_event", onEvent);
		});
	}
}
