import * as path from "node:path";
import { Readability } from "@mozilla/readability";
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { StringEnum } from "@oh-my-pi/pi-ai";
import { logger, untilAborted } from "@oh-my-pi/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import { JSDOM, VirtualConsole } from "jsdom";
import type { Browser, CDPSession, ElementHandle, KeyInput, Page, SerializedAXNode } from "puppeteer";
import puppeteer from "puppeteer";
import { renderPromptTemplate } from "../config/prompt-templates";
import browserDescription from "../prompts/tools/browser.md" with { type: "text" };
import type { ToolSession } from "../sdk";
import { htmlToBasicMarkdown } from "../web/scrapers/types";
import type { OutputMeta } from "./output-meta";
import { resolveToCwd } from "./path-utils";
import stealthTamperingScript from "./puppeteer/00_stealth_tampering.js?raw" with { type: "text" };
import stealthActivityScript from "./puppeteer/01_stealth_activity.js?raw" with { type: "text" };
import stealthHairlineScript from "./puppeteer/02_stealth_hairline.js?raw" with { type: "text" };
import stealthBotdScript from "./puppeteer/03_stealth_botd.js?raw" with { type: "text" };
import stealthIframeScript from "./puppeteer/04_stealth_iframe.js?raw" with { type: "text" };
import stealthWebglScript from "./puppeteer/05_stealth_webgl.js?raw" with { type: "text" };
import stealthScreenScript from "./puppeteer/06_stealth_screen.js?raw" with { type: "text" };
import stealthFontsScript from "./puppeteer/07_stealth_fonts.js?raw" with { type: "text" };
import stealthAudioScript from "./puppeteer/08_stealth_audio.js?raw" with { type: "text" };
import stealthLocaleScript from "./puppeteer/09_stealth_locale.js?raw" with { type: "text" };
import stealthPluginsScript from "./puppeteer/10_stealth_plugins.js?raw" with { type: "text" };
import stealthHardwareScript from "./puppeteer/11_stealth_hardware.js?raw" with { type: "text" };
import stealthCodecsScript from "./puppeteer/12_stealth_codecs.js?raw" with { type: "text" };
import stealthWorkerScript from "./puppeteer/13_stealth_worker.js?raw" with { type: "text" };
import { ToolAbortError, ToolError, throwIfAborted } from "./tool-errors";
import { toolResult } from "./tool-result";

const DEFAULT_TIMEOUT_SECONDS = 30;
const MAX_TIMEOUT_SECONDS = 120;
const DEFAULT_VIEWPORT = { width: 1365, height: 768, deviceScaleFactor: 1.25 };
const STEALTH_IGNORE_DEFAULT_ARGS = [
	"--disable-extensions",
	"--disable-default-apps",
	"--disable-component-extensions-with-background-pages",
];
const STEALTH_ACCEPT_LANGUAGE = "en-US,en";
const PUPPETEER_SOURCE_URL_SUFFIX = "//# sourceURL=__puppeteer_evaluation_script__";
const INTERACTIVE_AX_ROLES = new Set([
	"button",
	"link",
	"textbox",
	"combobox",
	"listbox",
	"option",
	"checkbox",
	"radio",
	"switch",
	"tab",
	"menuitem",
	"menuitemcheckbox",
	"menuitemradio",
	"slider",
	"spinbutton",
	"searchbox",
	"treeitem",
]);

/**
 * Stealth init scripts for Puppeteer.
 */

type PuppeteerCdpClient = {
	send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
};

type UserAgentOverride = {
	userAgent: string;
	platform: string;
	acceptLanguage: string;
	userAgentMetadata: {
		brands: Array<{ brand: string; version: string }>;
		fullVersion: string;
		platform: string;
		platformVersion: string;
		architecture: string;
		model: string;
		mobile: boolean;
	};
};

function resolvePageClient(page: Page): PuppeteerCdpClient | null {
	const pageWithClient = page as Page & {
		_client?: (() => PuppeteerCdpClient) | PuppeteerCdpClient;
	};
	if (!pageWithClient._client) return null;
	return typeof pageWithClient._client === "function" ? pageWithClient._client() : pageWithClient._client;
}

const puppeteerGetArgsSchema = Type.Array(
	Type.Object({
		selector: Type.String({ description: "CSS selector for the target element" }),
		attribute: Type.Optional(Type.String({ description: "Attribute name (get_attribute)" })),
	}),
	{ description: "Batch arguments for get_* actions", minItems: 1 },
);

const browserSchema = Type.Object({
	action: StringEnum(
		[
			"open",
			"goto",
			"observe",
			"click",
			"click_id",
			"type",
			"type_id",
			"fill",
			"fill_id",
			"press",
			"scroll",
			"drag",
			"wait_for_selector",
			"evaluate",
			"get_text",
			"get_html",
			"get_attribute",
			"extract_readable",
			"screenshot",
			"close",
		],
		{ description: "Action to perform" },
	),
	url: Type.Optional(Type.String({ description: "URL to navigate to (goto)" })),
	selector: Type.Optional(Type.String({ description: "CSS selector for the target element" })),
	element_id: Type.Optional(Type.Number({ description: "Element ID from observe" })),
	include_all: Type.Optional(Type.Boolean({ description: "Include non-interactive nodes in observe" })),
	viewport_only: Type.Optional(Type.Boolean({ description: "Limit observe output to elements in the viewport" })),
	args: Type.Optional(puppeteerGetArgsSchema),
	script: Type.Optional(Type.String({ description: "JavaScript to evaluate (evaluate)" })),
	text: Type.Optional(Type.String({ description: "Text to type (type)" })),
	value: Type.Optional(Type.String({ description: "Value to set (fill)" })),
	attribute: Type.Optional(Type.String({ description: "Attribute name to read (get_attribute)" })),
	key: Type.Optional(Type.String({ description: "Keyboard key to press (press)" })),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (default: 30)" })),
	wait_until: Type.Optional(
		StringEnum(["load", "domcontentloaded", "networkidle0", "networkidle2"], {
			description: "Navigation wait condition (goto)",
		}),
	),
	full_page: Type.Optional(Type.Boolean({ description: "Capture full page screenshot (screenshot)" })),
	format: Type.Optional(
		StringEnum(["png", "jpeg", "text", "markdown"], {
			description: "Output format (screenshot: png/jpeg, extract_readable: text/markdown)",
		}),
	),
	quality: Type.Optional(Type.Number({ description: "JPEG quality 0-100 (screenshot)" })),
	path: Type.Optional(Type.String({ description: "Optional path to save screenshot (relative to cwd)" })),
	viewport: Type.Optional(
		Type.Object({
			width: Type.Number({ description: "Viewport width in pixels" }),
			height: Type.Number({ description: "Viewport height in pixels" }),
			deviceScaleFactor: Type.Optional(Type.Number({ description: "Device scale factor" })),
		}),
	),
	delta_x: Type.Optional(Type.Number({ description: "Scroll delta X (scroll)" })),
	delta_y: Type.Optional(Type.Number({ description: "Scroll delta Y (scroll)" })),
	from_selector: Type.Optional(Type.String({ description: "Drag start selector (drag)" })),
	to_selector: Type.Optional(Type.String({ description: "Drag end selector (drag)" })),
});

/** Input schema for the Puppeteer tool. */
export type BrowserParams = Static<typeof browserSchema>;

/** Details describing a Puppeteer tool execution result. */
export interface BrowserToolDetails {
	action: BrowserParams["action"];
	url?: string;
	selector?: string;
	elementId?: number;
	result?: string | string[];
	screenshotPath?: string;
	mimeType?: string;
	bytes?: number;
	viewport?: { width: number; height: number; deviceScaleFactor?: number };
	observation?: Observation;
	readable?: ReadableResult;
	meta?: OutputMeta;
}

export interface ObservationEntry {
	id: number;
	role: string;
	name?: string;
	value?: string | number;
	description?: string;
	keyshortcuts?: string;
	states: string[];
}

export interface Observation {
	url: string;
	title?: string;
	viewport: { width: number; height: number; deviceScaleFactor?: number };
	scroll: {
		x: number;
		y: number;
		width: number;
		height: number;
		scrollWidth: number;
		scrollHeight: number;
	};
	elements: ObservationEntry[];
}

export interface ReadableResult {
	url: string;
	title?: string;
	byline?: string;
	excerpt?: string;
	contentLength: number;
	text?: string;
	markdown?: string;
}

function clampTimeout(timeoutSeconds?: number): number {
	if (timeoutSeconds === undefined) return DEFAULT_TIMEOUT_SECONDS;
	return Math.min(Math.max(timeoutSeconds, 1), MAX_TIMEOUT_SECONDS);
}

function clampQuality(quality?: number): number | undefined {
	if (quality === undefined) return undefined;
	return Math.min(Math.max(quality, 0), 100);
}

function ensureParam<T>(value: T | undefined, name: string, action: string): T {
	if (value === undefined || value === null || value === "") {
		throw new ToolError(`Missing required parameter '${name}' for action '${action}'.`);
	}
	return value;
}

function resolveArtifactsDir(session: ToolSession): string | null {
	return session.getArtifactsDir?.() ?? session.getSessionFile()?.slice(0, -6) ?? null;
}

function formatEvaluateResult(value: unknown): string {
	if (typeof value === "string") return value;
	if (value === undefined) return "undefined";
	try {
		const serialized = JSON.stringify(value, null, 2);
		return serialized ?? "undefined";
	} catch {
		return String(value);
	}
}

/**
 * Puppeteer tool for headless browser automation.
 */
export class BrowserTool implements AgentTool<typeof browserSchema, BrowserToolDetails> {
	public readonly name = "puppeteer";
	public readonly label = "Puppeteer";
	public readonly description: string;
	public readonly parameters = browserSchema;
	private readonly session: ToolSession;
	private browser: Browser | null = null;
	private page: Page | null = null;
	private currentHeadless: boolean | null = null;
	private browserSession: CDPSession | null = null;
	private userAgentOverride: UserAgentOverride | null = null;
	private elementIdCounter = 0;
	private readonly elementCache = new Map<number, ElementHandle>();
	private readonly patchedClients = new WeakSet<object>();

	constructor(session: ToolSession) {
		this.session = session;
		this.description = renderPromptTemplate(browserDescription, {});
	}

	private async closeBrowser(): Promise<void> {
		await this.clearElementCache();
		if (this.page && !this.page.isClosed()) {
			await this.page.close();
		}
		this.page = null;
		if (this.browser?.connected) {
			await this.browser.close();
		}
		this.browser = null;
		this.browserSession = null;
		this.userAgentOverride = null;
	}

	private async resetBrowser(params?: BrowserParams): Promise<Page> {
		await this.closeBrowser();
		this.currentHeadless = this.session.settings.get("browser.headless");
		this.browser = await puppeteer.launch({
			headless: this.currentHeadless,
			defaultViewport: DEFAULT_VIEWPORT,
			args: [
				"--no-sandbox",
				"--disable-setuid-sandbox",
				"--disable-blink-features=AutomationControlled",
				`--window-size=${DEFAULT_VIEWPORT.width},${DEFAULT_VIEWPORT.height}`,
			],
			ignoreDefaultArgs: [...STEALTH_IGNORE_DEFAULT_ARGS],
		});
		this.page = await this.browser.newPage();
		await this.applyStealthPatches(this.page);
		await this.applyViewport(this.page, params?.viewport);
		return this.page;
	}

	private async ensurePage(params?: BrowserParams): Promise<Page> {
		const desiredHeadless = this.session.settings.get("browser.headless");
		if (this.currentHeadless !== null && this.currentHeadless !== desiredHeadless) {
			return this.resetBrowser(params);
		}
		if (this.page && !this.page.isClosed()) {
			return this.page;
		}
		if (!this.browser || !this.browser.isConnected()) {
			return this.resetBrowser(params);
		}
		this.page = await this.browser.newPage();
		await this.applyStealthPatches(this.page);
		await this.applyViewport(this.page, params?.viewport);
		return this.page;
	}

	private async applyViewport(page: Page, viewport?: BrowserParams["viewport"]): Promise<void> {
		const target = viewport ?? DEFAULT_VIEWPORT;
		await page.setViewport(target);
	}

	private async clearElementCache(): Promise<void> {
		if (this.elementCache.size === 0) {
			this.elementIdCounter = 0;
			return;
		}
		const handles = Array.from(this.elementCache.values());
		this.elementCache.clear();
		this.elementIdCounter = 0;
		await Promise.all(
			handles.map(async handle => {
				try {
					await handle.dispose();
				} catch {
					return;
				}
			}),
		);
	}

	private async resolveCachedHandle(id: number): Promise<ElementHandle> {
		const handle = this.elementCache.get(id);
		if (!handle) {
			throw new ToolError(`Unknown element_id ${id}. Run observe to refresh the element list.`);
		}
		try {
			const isConnected = (await handle.evaluate(el => el.isConnected)) as boolean;
			if (!isConnected) {
				await this.clearElementCache();
				throw new ToolError(`Element_id ${id} is stale. Run observe again.`);
			}
		} catch {
			await this.clearElementCache();
			throw new ToolError(`Element_id ${id} is stale. Run observe again.`);
		}
		return handle;
	}

	private isInteractiveNode(node: SerializedAXNode): boolean {
		if (INTERACTIVE_AX_ROLES.has(node.role)) return true;
		return (
			node.checked !== undefined ||
			node.pressed !== undefined ||
			node.selected !== undefined ||
			node.expanded !== undefined ||
			node.focused === true
		);
	}

	private async collectObservationEntries(
		node: SerializedAXNode,
		entries: ObservationEntry[],
		options: { viewportOnly: boolean; includeAll: boolean },
	): Promise<void> {
		if (options.includeAll || this.isInteractiveNode(node)) {
			const handle = await node.elementHandle();
			if (handle) {
				let inViewport = true;
				if (options.viewportOnly) {
					try {
						inViewport = await handle.isIntersectingViewport();
					} catch {
						inViewport = false;
					}
				}
				if (inViewport) {
					const id = ++this.elementIdCounter;
					const states: string[] = [];
					if (node.disabled) states.push("disabled");
					if (node.checked !== undefined) states.push(`checked=${String(node.checked)}`);
					if (node.pressed !== undefined) states.push(`pressed=${String(node.pressed)}`);
					if (node.selected !== undefined) states.push(`selected=${String(node.selected)}`);
					if (node.expanded !== undefined) states.push(`expanded=${String(node.expanded)}`);
					if (node.required) states.push("required");
					if (node.readonly) states.push("readonly");
					if (node.multiselectable) states.push("multiselectable");
					if (node.multiline) states.push("multiline");
					if (node.modal) states.push("modal");
					if (node.focused) states.push("focused");
					this.elementCache.set(id, handle);
					entries.push({
						id,
						role: node.role,
						name: node.name,
						value: node.value,
						description: node.description,
						keyshortcuts: node.keyshortcuts,
						states,
					});
				} else {
					await handle.dispose();
				}
			}
		}
		for (const child of node.children ?? []) {
			await this.collectObservationEntries(child, entries, options);
		}
	}

	private formatObservation(observation: Observation): string {
		const viewport = `${observation.viewport.width}x${observation.viewport.height}`;
		const scroll = `x=${observation.scroll.x} y=${observation.scroll.y} viewport=${observation.scroll.width}x${observation.scroll.height} doc=${observation.scroll.scrollWidth}x${observation.scroll.scrollHeight}`;
		const lines = [
			`URL: ${observation.url}`,
			observation.title ? `Title: ${observation.title}` : "Title:",
			`Viewport: ${viewport}`,
			`Scroll: ${scroll}`,
			"Elements:",
		];
		for (const entry of observation.elements) {
			const name = entry.name ? ` "${entry.name}"` : "";
			const value = entry.value !== undefined ? ` value=${JSON.stringify(entry.value)}` : "";
			const description = entry.description ? ` desc=${JSON.stringify(entry.description)}` : "";
			const shortcuts = entry.keyshortcuts ? ` shortcuts=${JSON.stringify(entry.keyshortcuts)}` : "";
			const state = entry.states.length ? ` (${entry.states.join(", ")})` : "";
			lines.push(`${entry.id}. ${entry.role}${name}${value}${description}${shortcuts}${state}`);
		}
		return lines.join("\n");
	}

	/**
	 * Restart the browser to apply changes like headless mode.
	 */
	public async restartForModeChange(): Promise<void> {
		await this.resetBrowser();
	}

	private async applyStealthPatches(page: Page): Promise<void> {
		this.patchSourceUrl(page);
		await this.applyUserAgentOverride(page);
		await this.injectStealthScripts(page);
	}

	private async applyUserAgentOverride(page: Page): Promise<void> {
		const client = resolvePageClient(page);
		if (!client) return;
		const override = await this.resolveUserAgentOverride(page);
		await this.sendUserAgentOverride(client, override);
		await this.configureUserAgentTargets(override);
	}

	private async resolveUserAgentOverride(page: Page): Promise<UserAgentOverride> {
		if (this.userAgentOverride) return this.userAgentOverride;
		const rawUserAgent = await page.browser().userAgent();
		let userAgent = rawUserAgent.replace("HeadlessChrome/", "Chrome/");
		if (userAgent.includes("Linux") && !userAgent.includes("Android")) {
			userAgent = userAgent.replace(/\(([^)]+)\)/, "(Windows NT 10.0; Win64; x64)");
		}

		const uaVersionMatch = userAgent.match(/Chrome\/([\d|.]+)/);
		const fallbackVersionMatch = uaVersionMatch ?? (await page.browser().version()).match(/\/([\d|.]+)/);
		const uaVersion = fallbackVersionMatch?.[1] ?? "0";
		const majorVersion = Number.parseInt(uaVersion.split(".")[0] ?? "0", 10) || 0;
		const isAndroid = userAgent.includes("Android");
		const platform = userAgent.includes("Mac OS X")
			? "MacIntel"
			: isAndroid
				? "Android"
				: userAgent.includes("Linux")
					? "Linux"
					: "Win32";
		const platformFull = userAgent.includes("Mac OS X")
			? "Mac OS X"
			: isAndroid
				? "Android"
				: userAgent.includes("Linux")
					? "Linux"
					: "Windows";
		const platformVersion = userAgent.includes("Mac OS X ")
			? (userAgent.match(/Mac OS X ([^)]+)/)?.[1] ?? "")
			: userAgent.includes("Android ")
				? (userAgent.match(/Android ([^;]+)/)?.[1] ?? "")
				: userAgent.includes("Windows ")
					? (userAgent.match(/Windows .*?([\d|.]+);?/)?.[1] ?? "")
					: "";
		const architecture = isAndroid ? "" : "x86";
		const model = isAndroid ? (userAgent.match(/Android.*?;\s([^)]+)/)?.[1] ?? "") : "";

		const brandOrders = [
			[0, 1, 2],
			[0, 2, 1],
			[1, 0, 2],
			[1, 2, 0],
			[2, 0, 1],
			[2, 1, 0],
		];
		const order = brandOrders[majorVersion % brandOrders.length] ?? brandOrders[0];
		const escapedChars = [" ", " ", ";"];
		const greaseyBrand = `${escapedChars[order[0]]}Not${escapedChars[order[1]]}A${escapedChars[order[2]]}Brand`;
		const brands: { brand: string; version: string }[] = [];
		brands[order[0]] = { brand: greaseyBrand, version: "99" };
		brands[order[1]] = { brand: "Chromium", version: String(majorVersion) };
		brands[order[2]] = { brand: "Google Chrome", version: String(majorVersion) };

		this.userAgentOverride = {
			userAgent,
			platform,
			acceptLanguage: STEALTH_ACCEPT_LANGUAGE,
			userAgentMetadata: {
				brands,
				fullVersion: uaVersion,
				platform: platformFull,
				platformVersion,
				architecture,
				model,
				mobile: isAndroid,
			},
		};
		return this.userAgentOverride;
	}

	private async configureUserAgentTargets(override: UserAgentOverride): Promise<void> {
		if (!this.browser) return;
		if (!this.browserSession) {
			this.browserSession = await this.browser.target().createCDPSession();
			await this.browserSession.send("Target.setAutoAttach", {
				autoAttach: true,
				waitForDebuggerOnStart: false,
				flatten: true,
			});
			this.browserSession.on("Target.attachedToTarget", async (event: { sessionId: string }) => {
				const connection = this.browserSession?.connection();
				const session = connection?.session(event.sessionId);
				if (!session || !this.userAgentOverride) return;
				await this.sendUserAgentOverride(this.wrapSession(session), this.userAgentOverride);
			});
		}

		const targets = this.browser.targets();
		await Promise.all(
			targets.map(async target => {
				const session = await target.createCDPSession();
				await this.sendUserAgentOverride(this.wrapSession(session), override);
			}),
		);
	}

	private wrapSession(session: CDPSession): PuppeteerCdpClient {
		return {
			send: async (method, params) => session.send(method as never, params as never),
		};
	}

	private async sendUserAgentOverride(client: PuppeteerCdpClient, override: UserAgentOverride): Promise<void> {
		try {
			await client.send("Network.enable");
		} catch {}
		try {
			await client.send("Network.setUserAgentOverride", override);
		} catch (error) {
			logger.debug("Failed to apply Network user agent override", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
		try {
			await client.send("Emulation.setUserAgentOverride", override);
		} catch (error) {
			logger.debug("Failed to apply Emulation user agent override", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	private patchSourceUrl(page: Page): void {
		const client = resolvePageClient(page);
		if (!client) return;
		const clientKey = client as object;
		if (this.patchedClients.has(clientKey)) return;
		this.patchedClients.add(clientKey);
		const originalSend = client.send.bind(client);
		client.send = async (method: string, params?: Record<string, unknown>) => {
			const next = async (payload?: Record<string, unknown>) => {
				try {
					return await originalSend(method, payload);
				} catch (error) {
					if (
						error instanceof Error &&
						error.message.includes(
							"Protocol error (Network.getResponseBody): No resource with given identifier found",
						)
					) {
						return undefined;
					}
					throw error;
				}
			};
			if (!method || !params) {
				return next(params);
			}
			const key =
				method === "Runtime.evaluate"
					? "expression"
					: method === "Runtime.callFunctionOn"
						? "functionDeclaration"
						: null;
			if (!key) {
				return next(params);
			}
			const value = params[key];
			if (typeof value !== "string" || !value.includes(PUPPETEER_SOURCE_URL_SUFFIX)) {
				return next(params);
			}
			const patchedParams = { ...params, [key]: value.replace(PUPPETEER_SOURCE_URL_SUFFIX, "") };
			return next(patchedParams);
		};
	}

	/** Injects stealth scripts that cover common puppeteer detection surfaces. */
	private async injectStealthScripts(page: Page): Promise<void> {
		const scripts = [
			stealthTamperingScript,
			stealthActivityScript,
			stealthHairlineScript,
			stealthBotdScript,
			stealthIframeScript,
			stealthWebglScript,
			stealthScreenScript,
			stealthFontsScript,
			stealthAudioScript,
			stealthLocaleScript,
			stealthPluginsScript,
			stealthHardwareScript,
			stealthCodecsScript,
			stealthWorkerScript,
		];

		const joint = scripts
			.map(
				script => `
		try {
			${script};
		} catch (e) {}
	`,
			)
			.join(";\n");

		await page.evaluateOnNewDocument(`(() => {
				// Native function cache - captured before any tampering
				const iframe = document.createElement("iframe");
				iframe.style.display = "none";
				document.head.appendChild(iframe);
				const nativeWindow = iframe.contentWindow;
				if (!nativeWindow) return;

				// Cache pristine native functions
				const Function_toString = nativeWindow.Function.prototype.toString;
				const Object_getOwnPropertyDescriptor = nativeWindow.Object.getOwnPropertyDescriptor;
				const Object_getOwnPropertyDescriptors = nativeWindow.Object.getOwnPropertyDescriptors;
				const Object_getPrototypeOf = nativeWindow.Object.getPrototypeOf;
				const Object_defineProperty = nativeWindow.Object.defineProperty;
				const Object_getOwnPropertyDescriptorOriginal = nativeWindow.Object.getOwnPropertyDescriptor;
				const Object_create = nativeWindow.Object.create;
				const Object_keys = nativeWindow.Object.keys;
				const Object_getOwnPropertyNames = nativeWindow.Object.getOwnPropertyNames;
				const Object_entries = nativeWindow.Object.entries;
				const Object_setPrototypeOf = nativeWindow.Object.setPrototypeOf;
				const Object_assign = nativeWindow.Object.assign;
				const Window_setTimeout = nativeWindow.setTimeout;
				const Math_random = nativeWindow.Math.random;
				const Math_floor = nativeWindow.Math.floor;
				const Math_max = nativeWindow.Math.max;
				const Math_min = nativeWindow.Math.min;
				const Window_Event = nativeWindow.Event;
				const Promise_resolve = nativeWindow.Promise.resolve.bind(nativeWindow.Promise);
				const Window_Blob = nativeWindow.Blob;
				const Window_Proxy = nativeWindow.Proxy;
				const Intl_DateTimeFormat = nativeWindow.Intl.DateTimeFormat;
				const Date_constructor = nativeWindow.Date;

				
				${joint}

				document.head.removeChild(iframe);})();`);
	}

	public async execute(
		_toolCallId: string,
		params: BrowserParams,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<BrowserToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<BrowserToolDetails>> {
		try {
			throwIfAborted(signal);
			const timeoutSeconds = clampTimeout(params.timeout);
			const timeoutMs = timeoutSeconds * 1000;
			const details: BrowserToolDetails = { action: params.action };

			switch (params.action) {
				case "open": {
					const page = await untilAborted(signal, () => this.resetBrowser(params));
					const viewport = page.viewport();
					details.viewport = viewport ?? DEFAULT_VIEWPORT;
					return toolResult(details).text("Opened headless browser session").done();
				}
				case "close": {
					await untilAborted(signal, () => this.closeBrowser());
					return toolResult(details).text("Closed headless browser session").done();
				}
				case "goto": {
					const url = ensureParam(params.url, "url", params.action);
					details.url = url;
					const page = await this.ensurePage(params);
					const waitUntil = params.wait_until ?? "networkidle2";
					await this.clearElementCache();
					await untilAborted(signal, () => page.goto(url, { waitUntil, timeout: timeoutMs }));
					const finalUrl = page.url();
					const title = (await untilAborted(signal, () => page.title())) as string;
					details.url = finalUrl;
					details.result = title;
					return toolResult(details)
						.text(`Navigated to ${finalUrl}${title ? `\nTitle: ${title}` : ""}`)
						.done();
				}
				case "observe": {
					const page = await this.ensurePage(params);
					const timeoutSignal = AbortSignal.timeout(timeoutMs);
					const observeSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
					await this.clearElementCache();
					const snapshot = (await untilAborted(observeSignal, () =>
						page.accessibility.snapshot({ interestingOnly: !(params.include_all ?? false) }),
					)) as SerializedAXNode | null;
					if (!snapshot) {
						throw new ToolError("Accessibility snapshot unavailable");
					}
					const entries: ObservationEntry[] = [];
					await this.collectObservationEntries(snapshot, entries, {
						viewportOnly: params.viewport_only ?? false,
						includeAll: params.include_all ?? false,
					});
					const scroll = (await untilAborted(observeSignal, () =>
						page.evaluate(() => {
							const win = globalThis as unknown as {
								scrollX: number;
								scrollY: number;
								innerWidth: number;
								innerHeight: number;
								document: { documentElement: { scrollWidth: number; scrollHeight: number } };
							};
							const doc = win.document.documentElement;
							return {
								x: win.scrollX,
								y: win.scrollY,
								width: win.innerWidth,
								height: win.innerHeight,
								scrollWidth: doc.scrollWidth,
								scrollHeight: doc.scrollHeight,
							};
						}),
					)) as Observation["scroll"];
					const url = page.url();
					const title = (await untilAborted(observeSignal, () => page.title())) as string;
					const viewport = page.viewport() ?? DEFAULT_VIEWPORT;
					const observation: Observation = {
						url,
						title,
						viewport,
						scroll,
						elements: entries,
					};
					details.url = url;
					details.viewport = viewport;
					details.observation = observation;
					details.result = `${entries.length} elements`;
					return toolResult(details).text(this.formatObservation(observation)).done();
				}
				case "click": {
					const selector = ensureParam(params.selector, "selector", params.action);
					details.selector = selector;
					const page = await this.ensurePage(params);
					const locator = page.locator(selector).setTimeout(timeoutMs);
					await untilAborted(signal, () => locator.click());
					return toolResult(details).text(`Clicked ${selector}`).done();
				}
				case "click_id": {
					const elementId = ensureParam(params.element_id, "element_id", params.action);
					details.elementId = elementId;
					const handle = await this.resolveCachedHandle(elementId);
					try {
						await untilAborted(signal, () => handle.click());
					} catch {
						await this.clearElementCache();
						throw new ToolError(`Element_id ${elementId} is stale. Run observe again.`);
					}
					return toolResult(details).text(`Clicked element ${elementId}`).done();
				}
				case "type": {
					const selector = ensureParam(params.selector, "selector", params.action);
					const text = ensureParam(params.text, "text", params.action);
					details.selector = selector;
					const page = await this.ensurePage(params);
					const locator = page.locator(selector).setTimeout(timeoutMs);
					const handle = (await untilAborted(signal, () => locator.waitHandle())) as ElementHandle;
					await untilAborted(signal, () => handle.type(text, { delay: 0 }));
					await handle.dispose();
					return toolResult(details).text(`Typed into ${selector}`).done();
				}
				case "type_id": {
					const elementId = ensureParam(params.element_id, "element_id", params.action);
					const text = ensureParam(params.text, "text", params.action);
					details.elementId = elementId;
					const page = await this.ensurePage(params);
					const handle = await this.resolveCachedHandle(elementId);
					try {
						await untilAborted(signal, () => handle.focus());
						await untilAborted(signal, () => page.keyboard.type(text, { delay: 0 }));
					} catch {
						await this.clearElementCache();
						throw new ToolError(`Element_id ${elementId} is stale. Run observe again.`);
					}
					return toolResult(details).text(`Typed into element ${elementId}`).done();
				}
				case "fill": {
					const selector = ensureParam(params.selector, "selector", params.action);
					const value = ensureParam(params.value, "value", params.action);
					details.selector = selector;
					const page = await this.ensurePage(params);
					const locator = page.locator(selector).setTimeout(timeoutMs);
					await untilAborted(signal, () => locator.fill(value));
					return toolResult(details).text(`Filled ${selector}`).done();
				}
				case "fill_id": {
					const elementId = ensureParam(params.element_id, "element_id", params.action);
					const value = ensureParam(params.value, "value", params.action);
					details.elementId = elementId;
					const handle = await this.resolveCachedHandle(elementId);
					try {
						await untilAborted(signal, () =>
							handle.evaluate((el, inputValue) => {
								const element = el as { value?: string; dispatchEvent: (event: Event) => boolean };
								if (!("value" in element)) {
									throw new Error("Target element is not a form input");
								}
								element.value = String(inputValue);
								element.dispatchEvent(new Event("input", { bubbles: true }));
								element.dispatchEvent(new Event("change", { bubbles: true }));
							}, value),
						);
					} catch {
						await this.clearElementCache();
						throw new ToolError(`Element_id ${elementId} is stale. Run observe again.`);
					}
					return toolResult(details).text(`Filled element ${elementId}`).done();
				}
				case "press": {
					const key = ensureParam(params.key, "key", params.action) as KeyInput;
					const page = await this.ensurePage(params);
					if (params.selector) {
						await untilAborted(signal, () => page.focus(params.selector as string));
					}
					await untilAborted(signal, () => page.keyboard.press(key));
					return toolResult(details).text(`Pressed ${key}`).done();
				}
				case "scroll": {
					const deltaY = ensureParam(params.delta_y, "delta_y", params.action);
					const deltaX = params.delta_x ?? 0;
					const page = await this.ensurePage(params);
					await untilAborted(signal, () => page.mouse.wheel({ deltaX, deltaY }));
					return toolResult(details).text(`Scrolled by ${deltaX}, ${deltaY}`).done();
				}
				case "drag": {
					const fromSelector = ensureParam(params.from_selector, "from_selector", params.action);
					const toSelector = ensureParam(params.to_selector, "to_selector", params.action);
					const page = await this.ensurePage(params);
					const fromHandle = (await untilAborted(signal, () => page.$(fromSelector))) as ElementHandle | null;
					const toHandle = (await untilAborted(signal, () => page.$(toSelector))) as ElementHandle | null;
					if (!fromHandle || !toHandle) {
						throw new ToolError("Drag selectors did not resolve to elements");
					}
					const fromBox = (await untilAborted(signal, () => fromHandle.boundingBox())) as {
						x: number;
						y: number;
						width: number;
						height: number;
					} | null;
					const toBox = (await untilAborted(signal, () => toHandle.boundingBox())) as {
						x: number;
						y: number;
						width: number;
						height: number;
					} | null;
					await fromHandle.dispose();
					await toHandle.dispose();
					if (!fromBox || !toBox) {
						throw new ToolError("Drag elements are not visible");
					}
					const startX = fromBox.x + fromBox.width / 2;
					const startY = fromBox.y + fromBox.height / 2;
					const endX = toBox.x + toBox.width / 2;
					const endY = toBox.y + toBox.height / 2;
					await untilAborted(signal, () => page.mouse.move(startX, startY));
					await untilAborted(signal, () => page.mouse.down());
					await untilAborted(signal, () => page.mouse.move(endX, endY, { steps: 12 }));
					await untilAborted(signal, () => page.mouse.up());
					return toolResult(details).text(`Dragged from ${fromSelector} to ${toSelector}`).done();
				}
				case "wait_for_selector": {
					const selector = ensureParam(params.selector, "selector", params.action);
					details.selector = selector;
					const page = await this.ensurePage(params);
					const locator = page.locator(selector).setTimeout(timeoutMs);
					await untilAborted(signal, () => locator.wait());
					return toolResult(details).text(`Selector ready: ${selector}`).done();
				}
				case "evaluate": {
					const script = ensureParam(params.script, "script", params.action);
					const page = await this.ensurePage(params);
					const value = (await untilAborted(signal, () =>
						page.evaluate((source: string) => {
							const evaluator = new Function(`return (${source});`);
							return evaluator();
						}, script),
					)) as unknown;
					const output = formatEvaluateResult(value);
					details.result = output;
					return toolResult(details).text(output).done();
				}
				case "get_text": {
					const page = await this.ensurePage(params);
					if (params.args?.length) {
						const values = (await Promise.all(
							params.args.map((arg, index) => {
								const selector = ensureParam(arg.selector, `args[${index}].selector`, params.action);
								return untilAborted(signal, () =>
									page.$eval(selector, (el: Element) => (el as HTMLElement).innerText),
								);
							}),
						)) as string[];
						details.result = values;
						return toolResult(details)
							.text(JSON.stringify(values, null, 2))
							.done();
					}
					const selector = ensureParam(params.selector, "selector", params.action);
					details.selector = selector;
					const value = (await untilAborted(signal, () =>
						page.$eval(selector, (el: Element) => (el as HTMLElement).innerText),
					)) as string;
					details.result = value;
					return toolResult(details).text(value).done();
				}
				case "get_html": {
					const page = await this.ensurePage(params);
					if (params.args?.length) {
						const values = (await Promise.all(
							params.args.map((arg, index) => {
								const selector = ensureParam(arg.selector, `args[${index}].selector`, params.action);
								return untilAborted(signal, () =>
									page.$eval(selector, (el: Element) => (el as HTMLElement).innerHTML),
								);
							}),
						)) as string[];
						details.result = values;
						return toolResult(details)
							.text(JSON.stringify(values, null, 2))
							.done();
					}
					const selector = ensureParam(params.selector, "selector", params.action);
					details.selector = selector;
					const value = (await untilAborted(signal, () =>
						page.$eval(selector, (el: Element) => (el as HTMLElement).innerHTML),
					)) as string;
					details.result = value;
					return toolResult(details).text(value).done();
				}
				case "get_attribute": {
					const page = await this.ensurePage(params);
					if (params.args?.length) {
						const values = (await Promise.all(
							params.args.map((arg, index) => {
								const selector = ensureParam(arg.selector, `args[${index}].selector`, params.action);
								const attribute = ensureParam(arg.attribute, `args[${index}].attribute`, params.action);
								return untilAborted(signal, () =>
									page.$eval(selector, (el: Element) => (el as HTMLElement).getAttribute(String(attribute))),
								);
							}),
						)) as string[];
						details.result = values;
						return toolResult(details)
							.text(JSON.stringify(values, null, 2))
							.done();
					}
					const selector = ensureParam(params.selector, "selector", params.action);
					const attribute = ensureParam(params.attribute, "attribute", params.action);
					details.selector = selector;
					const value = (await untilAborted(signal, () =>
						page.$eval(
							selector,
							(el: { getAttribute: (name: string) => string | null }, attr: string) =>
								el.getAttribute(String(attr)),
							attribute,
						),
					)) as string | null;
					const output = value ?? "";
					details.result = output;
					return toolResult(details).text(output).done();
				}
				case "extract_readable": {
					const page = await this.ensurePage(params);
					const format = params.format ?? "text";
					if (format !== "text" && format !== "markdown") {
						throw new ToolError("extract_readable format must be text or markdown");
					}
					const html = (await untilAborted(signal, () => page.content())) as string;
					const url = page.url();
					const virtualConsole = new VirtualConsole();
					virtualConsole.on("jsdomError", error => {
						if (error?.message?.includes("Could not parse CSS stylesheet")) return;
						logger.debug("JSDOM error during readable extraction", {
							error: error instanceof Error ? error.message : String(error),
						});
					});
					const dom = new JSDOM(html, { url, virtualConsole });
					const reader = new Readability(dom.window.document);
					const article = reader.parse();
					dom.window.close();
					if (!article) {
						throw new ToolError("Readable content not found");
					}
					const markdown = format === "markdown" ? htmlToBasicMarkdown(article.content ?? "") : undefined;
					const text = format === "text" ? (article.textContent ?? "") : undefined;
					const readable: ReadableResult = {
						url,
						title: article.title ?? undefined,
						byline: article.byline ?? undefined,
						excerpt: article.excerpt ?? undefined,
						contentLength: article.length ?? article.textContent?.length ?? 0,
						text,
						markdown,
					};
					details.url = url;
					details.readable = readable;
					details.result = format === "markdown" ? (markdown ?? "") : (text ?? "");
					return toolResult(details)
						.text(JSON.stringify(readable, null, 2))
						.done();
				}
				case "screenshot": {
					const page = await this.ensurePage(params);
					const format = params.format ?? "png";
					if (format !== "png" && format !== "jpeg") {
						throw new ToolError("Screenshot format must be png or jpeg");
					}
					const imageFormat = format;
					const fullPage = params.selector ? false : (params.full_page ?? false);
					const quality = imageFormat === "jpeg" ? clampQuality(params.quality ?? 80) : undefined;
					let buffer: Buffer;

					if (params.selector) {
						const handle = (await untilAborted(signal, () =>
							page.$(params.selector as string),
						)) as ElementHandle | null;
						if (!handle) {
							throw new ToolError("Screenshot selector did not resolve to an element");
						}
						buffer = (await untilAborted(signal, () =>
							handle.screenshot({ type: imageFormat, quality }),
						)) as Buffer;
						await handle.dispose();
						details.selector = params.selector;
					} else {
						buffer = (await untilAborted(signal, () =>
							page.screenshot({ type: imageFormat, quality, fullPage }),
						)) as Buffer;
					}

					const mimeType = imageFormat === "png" ? "image/png" : "image/jpeg";
					const base64 = buffer.toString("base64");
					let savedPath: string | undefined;
					if (params.path) {
						const resolved = resolveToCwd(params.path, this.session.cwd);
						const ext = path.extname(resolved);
						savedPath = ext ? resolved : `${resolved}.${imageFormat}`;
						await Bun.write(savedPath, buffer);
					} else {
						const artifactsDir = resolveArtifactsDir(this.session);
						if (artifactsDir) {
							savedPath = path.join(artifactsDir, `puppeteer-${Date.now()}.${imageFormat}`);
							await Bun.write(savedPath, buffer);
						}
					}
					details.screenshotPath = savedPath;
					details.mimeType = mimeType;
					details.bytes = buffer.length;

					const lines = ["Screenshot captured", `Format: ${format}`, `Bytes: ${buffer.length}`];
					if (savedPath) {
						lines.push(`Saved: ${savedPath}`);
					}

					return toolResult(details)
						.content([
							{ type: "text", text: lines.join("\n") },
							{ type: "image", data: base64, mimeType },
						])
						.done();
				}
				default:
					throw new ToolError(`Unsupported action: ${params.action}`);
			}
		} catch (error) {
			if (error instanceof ToolAbortError) throw error;
			if (error instanceof Error && error.name === "AbortError") {
				throw new ToolAbortError();
			}
			throw error;
		}
	}
}
