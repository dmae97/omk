import type { Agent, AgentMessage } from "omk-agent-core";
import type { ImageContent, TextContent } from "omk-ai";
import type { ActiveSkillState } from "./active-skill-state.ts";
import type { PromptOptions } from "./prompt-options.ts";

/** One user turn as prompts and the agent queues carry it. */
export function userMessage(text: string, images?: ImageContent[]): AgentMessage {
	const content: (TextContent | ImageContent)[] = [{ type: "text", text }];
	if (images) content.push(...images);
	return { role: "user", content, timestamp: Date.now() };
}

/** A user prompt deferred while another prompt was in preflight; it runs as a full prompt if no run adopts it. */
export interface DeferredPrompt {
	readonly text: string;
	readonly options: PromptOptions;
}

/**
 * Turn-starting input that arrived while the session was busy with no agent loop to drain the queue: extension
 * triggerTurn messages (between a run's turns, prompt preflight, late tool settlement, manual compaction, branch
 * summary) and follow-up prompts sent while another prompt was still in preflight. A run adopts it into the agent
 * queues; otherwise it starts a run once the session is idle.
 */
export class DeferredTurnInput {
	private items: Array<{ readonly message: AgentMessage; readonly steer: boolean; readonly prompt?: DeferredPrompt }> =
		[];

	get size(): number {
		return this.items.length;
	}

	defer(
		message: AgentMessage,
		deliverAs: "steer" | "followUp" | "nextTurn" | undefined,
		prompt?: DeferredPrompt,
	): void {
		this.items.push({ message, steer: deliverAs !== "followUp", prompt });
	}

	/** Moves everything into the agent queues of a run that drains them; true when anything moved. */
	adopt(agent: Pick<Agent, "steer" | "followUp">): boolean {
		const items = this.items;
		this.items = [];
		for (const item of items) {
			if (item.steer) agent.steer(item.message);
			else agent.followUp(item.message);
		}
		return items.length > 0;
	}

	/** The next run to start at idle: a deferred prompt on its own, or the extension messages queued before it. */
	next(): { readonly prompt: DeferredPrompt } | { readonly messages: AgentMessage[] } | undefined {
		const first = this.items[0];
		if (first?.prompt) {
			this.items.shift();
			return { prompt: first.prompt };
		}
		const end = this.items.findIndex((item) => item.prompt !== undefined);
		const taken = this.items.splice(0, end === -1 ? this.items.length : end);
		return taken.length > 0 ? { messages: taken.map((item) => item.message) } : undefined;
	}

	/** A follow-up for the prompt still in preflight. It was accepted already, so its rerun reports nothing again. */
	deferPrompt(
		text: string,
		images: ImageContent[] | undefined,
		options: PromptOptions,
		skills: ActiveSkillState,
	): void {
		const prepared = preparedPromptOptions({ ...options, preflightResult: undefined }, images, skills);
		this.defer(userMessage(text, images), options.streamingBehavior, { text, options: prepared });
	}

	clear(): void {
		this.items = [];
	}
}

/**
 * Whether prompt() routes input inside _prompt instead of opening its own budget scope: while a run owns the
 * session, or while another prompt holds the scope in preflight (registered commands run at once, follow-up input
 * defers). Other input keeps the scope's busy refusal.
 */
export function routesOutsideScope(
	command: boolean,
	options: PromptOptions | undefined,
	runOwns: boolean,
	scopeHeld: boolean,
): boolean {
	if (options?.runBudget !== undefined) return false;
	return runOwns || (scopeHeld && (options?.streamingBehavior !== undefined || command));
}

const handledInput = new WeakSet<PromptOptions>();

/** Options to resume a prompt whose input event already ran and whose text is already expanded. */
export function preparedPromptOptions(
	options: PromptOptions | undefined,
	images: ImageContent[] | undefined,
	skills: ActiveSkillState,
): PromptOptions {
	const prepared: PromptOptions = {
		...options,
		expandPromptTemplates: false,
		images,
		activeSkillNames: skills.names,
		activeSkillSource: skills.source,
	};
	handledInput.add(prepared);
	return prepared;
}

export function inputAlreadyHandled(options: PromptOptions | undefined): boolean {
	return options !== undefined && handledInput.has(options);
}
