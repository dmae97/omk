import { logger } from "@oh-my-pi/pi-utils";
import { Agent, run, setDefaultOpenAIKey } from "@openai/agents";
import { z } from "zod";
import type { ModelRegistry } from "./model-registry";

const DEFAULT_CONTROLLER_MODEL = process.env.OMP_VOICE_CONTROLLER_MODEL ?? "gpt-4o-mini";
const DEFAULT_SUMMARY_MODEL = process.env.OMP_VOICE_SUMMARY_MODEL ?? DEFAULT_CONTROLLER_MODEL;
const MAX_INPUT_CHARS = 8000;

export type VoiceSteeringDecision = { action: "pass" | "ask"; text: string };
export type VoicePresentationDecision = { action: "skip" | "speak"; text?: string };
type VoiceSummaryOutput = { text: string };

const steeringSchema: z.ZodType<VoiceSteeringDecision> = z.object({
	action: z.enum(["pass", "ask"]),
	text: z.string().min(1),
});

const presentationSchema: z.ZodType<VoicePresentationDecision> = z.object({
	action: z.enum(["skip", "speak"]),
	text: z.string().min(1).optional(),
});

const summarySchema: z.ZodType<VoiceSummaryOutput> = z.object({
	text: z.string().min(1),
});

function normalizeText(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function truncateText(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}...`;
}

export class VoiceController {
	private lastApiKey: string | undefined;

	constructor(private registry: ModelRegistry) {}

	private async ensureApiKey(): Promise<string | null> {
		const apiKey = await this.registry.getApiKeyForProvider("openai");
		if (!apiKey) {
			logger.debug("voice-controller: no OpenAI API key available");
			return null;
		}
		if (apiKey !== this.lastApiKey) {
			setDefaultOpenAIKey(apiKey);
			this.lastApiKey = apiKey;
		}
		return apiKey;
	}

	async steerUserInput(text: string): Promise<VoiceSteeringDecision | null> {
		if (!(await this.ensureApiKey())) return null;

		const normalized = truncateText(normalizeText(text), MAX_INPUT_CHARS);
		const agent = new Agent({
			name: "Voice Input Steering",
			instructions:
				"You are a voice-input controller for a coding agent. " +
				"Given a user's speech transcript, decide if it is clear enough to send to the agent. " +
				"If unclear or missing key details, ask exactly one short question. " +
				"If clear, rewrite it as a concise instruction for the agent. " +
				"Keep it short and preserve intent.",
			model: DEFAULT_CONTROLLER_MODEL,
			outputType: steeringSchema,
		});

		try {
			const result = await run(agent, normalized);
			return result.finalOutput ?? null;
		} catch (error) {
			logger.debug("voice-controller: steering error", {
				error: error instanceof Error ? error.message : String(error),
			});
			return null;
		}
	}

	async decidePresentation(text: string): Promise<VoicePresentationDecision | null> {
		if (!(await this.ensureApiKey())) return null;

		const normalized = truncateText(normalizeText(text), MAX_INPUT_CHARS);
		const agent = new Agent({
			name: "Voice Presentation Gate",
			instructions:
				"You are a voice presentation gate for a coding agent. " +
				"Decide whether to speak the assistant response to the user. " +
				"Speak when there is a decision, summary, or a question for the user. " +
				"Skip if it is mostly tool output, verbose logs, or not useful to speak. " +
				"When speaking, respond in 1-3 short sentences (<=45 words) in a casual, concise tone. " +
				"If user input is needed, ask exactly one short question.",
			model: DEFAULT_CONTROLLER_MODEL,
			outputType: presentationSchema,
		});

		try {
			const result = await run(agent, normalized);
			return result.finalOutput ?? null;
		} catch (error) {
			logger.debug("voice-controller: presentation error", {
				error: error instanceof Error ? error.message : String(error),
			});
			return null;
		}
	}

	async summarizeForVoice(text: string): Promise<string | null> {
		if (!(await this.ensureApiKey())) return null;

		const normalized = truncateText(normalizeText(text), MAX_INPUT_CHARS);
		const agent = new Agent({
			name: "Voice Summary",
			instructions:
				"Summarize the assistant response for voice playback. " +
				"Use 1-2 short sentences. " +
				"If a question is required from the user, ask one short question.",
			model: DEFAULT_SUMMARY_MODEL,
			outputType: summarySchema,
		});

		try {
			const result = await run(agent, normalized);
			const output = result.finalOutput?.text ?? "";
			return output.trim() || null;
		} catch (error) {
			logger.debug("voice-controller: summary error", {
				error: error instanceof Error ? error.message : String(error),
			});
			return null;
		}
	}
}
