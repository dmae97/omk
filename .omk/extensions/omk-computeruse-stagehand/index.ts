import { Stagehand } from "@browserbasehq/stagehand";
import { Type } from "typebox";
import { z } from "zod";
import type { ExtensionAPI, ExtensionContext } from "open-multi-agent-kit";
import { redactSecrets } from "../../../packages/coding-agent/examples/extensions/aside-computer-use/evidence.ts";
import { authorizeAction, authorizeNavigation, DEFAULT_ALLOWED_ORIGINS } from "./policy.ts";

class StagehandInputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StagehandInputError";
	}
}

function blocked(reason: string) {
	return {
		content: [{ type: "text" as const, text: reason }],
		details: { blocked: true, reason },
	};
}

function safeJson(value: unknown): string {
	return JSON.stringify(redactSecrets(value)).slice(0, 20_000);
}

function assertNever(value: never): never {
	throw new StagehandInputError(`Unexpected policy decision: ${JSON.stringify(value)}`);
}

async function confirm(ctx: ExtensionContext, title: string, detail: string): Promise<boolean> {
	if (!ctx.hasUI) return false;
	return ctx.ui.confirm(title, detail);
}

export default function omkComputerUseStagehand(omk: ExtensionAPI): void {
	let session: Stagehand | undefined;
	let initialization: Promise<Stagehand> | undefined;
	let operationQueue = Promise.resolve();

	const getSession = async (): Promise<Stagehand> => {
		if (session) return session;
		if (!initialization) {
			initialization = (async () => {
				const model = process.env.OMK_STAGEHAND_MODEL?.trim();
				const next = model
					? new Stagehand({ env: "LOCAL", model, verbose: 0, logInferenceToFile: false })
					: new Stagehand({ env: "LOCAL", verbose: 0, logInferenceToFile: false });
				await next.init();
				session = next;
				return next;
			})();
		}
		try {
			return await initialization;
		} finally {
			if (!session) initialization = undefined;
		}
	};

	const runExclusive = <T>(operation: () => Promise<T>): Promise<T> => {
		const result = operationQueue.then(operation, operation);
		operationQueue = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	};

	const currentPage = async () => {
		const active = await getSession();
		const page = active.context.pages()[0];
		if (!page) throw new StagehandInputError("Stagehand did not create a browser page");
		return { active, page };
	};

	const guidelines = [
		"Use stagehand_observe before stagehand_act so semantic actions target a known page state.",
		"stagehand_act always requires operator approval and must not be used for payment, deletion, credential, permission, or security actions.",
		"Use stagehand_extract only for bounded string fields and verify critical values with deterministic browser evidence.",
		"Close the local browser with stagehand_close when the lane is complete.",
	];

	omk.registerTool({
		name: "stagehand_status",
		label: "Stagehand Status",
		description: "Report whether the project-local Stagehand browser session is initialized without starting it.",
		promptSnippet: "Check the project-local Stagehand browser session",
		promptGuidelines: guidelines,
		parameters: Type.Object({}),
		async execute() {
			return {
				content: [{ type: "text", text: JSON.stringify({ initialized: Boolean(session) }) }],
				details: { initialized: Boolean(session) },
			};
		},
	});

	omk.registerTool({
		name: "stagehand_navigate",
		label: "Stagehand Navigate",
		description: "Navigate the local Stagehand browser. Public origins require operator approval; non-HTTP URLs are denied.",
		promptSnippet: "Navigate the project-local Stagehand browser",
		parameters: Type.Object({ url: Type.String({ minLength: 1 }) }),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			return runExclusive(async () => {
				const decision = authorizeNavigation(params.url, DEFAULT_ALLOWED_ORIGINS);
				switch (decision.kind) {
					case "allow":
						break;
					case "approve": {
						const approved = await confirm(ctx, "Stagehand navigation approval", `Navigate to ${decision.origin}?`);
						if (!approved) return blocked("Navigation approval denied");
						break;
					}
					case "deny":
						return blocked(decision.reason);
					default:
						return assertNever(decision);
				}
				const { page } = await currentPage();
				await page.goto(params.url, { waitUntil: "load" });
				const evidence = redactSecrets({ url: page.url(), title: await page.title() });
				return { content: [{ type: "text", text: safeJson(evidence) }], details: evidence };
			});
		},
	});

	omk.registerTool({
		name: "stagehand_observe",
		label: "Stagehand Observe",
		description: "Return up to 20 candidate browser actions for a narrow instruction. Page content is untrusted and redacted.",
		promptSnippet: "Observe candidate actions in the Stagehand browser",
		parameters: Type.Object({ instruction: Type.String({ minLength: 1, maxLength: 2_000 }) }),
		async execute(_id, params) {
			return runExclusive(async () => {
				const { active } = await currentPage();
				const actions = (await active.observe(params.instruction)).slice(0, 20);
				const safeActions = redactSecrets(actions);
				return { content: [{ type: "text", text: safeJson(safeActions) }], details: { actions: safeActions } };
			});
		},
	});

	omk.registerTool({
		name: "stagehand_act",
		label: "Stagehand Act",
		description: "Execute one semantic browser action after mandatory operator approval, then return the redacted result.",
		promptSnippet: "Execute one operator-approved Stagehand action",
		parameters: Type.Object({ instruction: Type.String({ minLength: 1, maxLength: 2_000 }) }),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			return runExclusive(async () => {
				const decision = authorizeAction(params.instruction);
				switch (decision.kind) {
					case "approve":
						break;
					case "deny":
						return blocked(decision.reason);
					default:
						return assertNever(decision);
				}
				const approved = await confirm(ctx, "Stagehand action approval", params.instruction);
				if (!approved) return blocked("Action approval denied or unavailable outside UI mode");
				const { active } = await currentPage();
				const result = redactSecrets(await active.act(params.instruction));
				return { content: [{ type: "text", text: safeJson(result) }], details: { result } };
			});
		},
	});

	omk.registerTool({
		name: "stagehand_extract",
		label: "Stagehand Extract",
		description: "Extract bounded string fields from the current page with a generated strict Zod object schema.",
		promptSnippet: "Extract bounded string fields from the Stagehand browser",
		parameters: Type.Object({
			instruction: Type.String({ minLength: 1, maxLength: 2_000 }),
			fields: Type.Array(
				Type.Object({
					name: Type.String({ pattern: "^[A-Za-z][A-Za-z0-9_]{0,63}$" }),
					description: Type.String({ minLength: 1, maxLength: 500 }),
				}),
				{ minItems: 1, maxItems: 20 },
			),
		}),
		async execute(_id, params) {
			return runExclusive(async () => {
				const shape: Record<string, z.ZodString> = {};
				for (const field of params.fields) {
					if (shape[field.name]) throw new StagehandInputError(`Duplicate extraction field: ${field.name}`);
					shape[field.name] = z.string().describe(field.description);
				}
				const { active } = await currentPage();
				const result = redactSecrets(await active.extract(params.instruction, z.object(shape)));
				return { content: [{ type: "text", text: safeJson(result) }], details: { result } };
			});
		},
	});

	omk.registerTool({
		name: "stagehand_close",
		label: "Stagehand Close",
		description: "Close the project-local Stagehand browser session. This is idempotent.",
		promptSnippet: "Close the project-local Stagehand browser session",
		parameters: Type.Object({}),
		async execute() {
			return runExclusive(async () => {
				const active = session;
				session = undefined;
				initialization = undefined;
				if (active) await active.close();
				return { content: [{ type: "text", text: "Stagehand session closed" }], details: { closed: true } };
			});
		},
	});

	omk.registerCommand("stagehand", {
		description: "Show the project-local Stagehand extension status",
		handler: async (_args, ctx) => {
			ctx.ui.notify(`Stagehand local session: ${session ? "initialized" : "idle"}`, "info");
		},
	});

	omk.on("session_shutdown", async () => {
		const active = session;
		session = undefined;
		initialization = undefined;
		if (!active) return;
		try {
			await active.close();
		} catch (error) {
			const message = error instanceof Error ? error.message : "unknown close failure";
			console.error(`[omk-computeruse-stagehand] ${message}`);
		}
	});
}
