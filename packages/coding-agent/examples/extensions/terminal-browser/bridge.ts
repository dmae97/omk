/**
 * terminal-browser claude-bridge client for OMK.
 *
 * Launches `terminal-browser claude-bridge launch`, then talks to the bridge's
 * loopback HTTP API: GET /state, POST /open, /size, /input, /inbox/take,
 * /browser/close, /close.
 *
 * The bridge child process owns the pixel channel and the chromium lifecycle:
 * it spawns `terminal-browser open` with PIXEL_EMBED/PIXEL_TTY, receives
 * join/placed/title on its own socket, and writes kitty graphics frames to the
 * TTY. This client only polls state and forwards size/input/agent text.
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { type BridgeState, isBridgeState, isLaunchReport, takenTexts } from "./bridge-protocol.ts";

const execFile = promisify(execFileCb);

const INSTALL_URL = "https://terminal-browser.sh";
const REQUIRED_CAPABILITIES = ["embedding"];
const POLL_MS = 250;
const IDLE_POLL_MS = 1200;

export type BridgeHooks = {
	onAgentText: (text: string) => void;
};

export class TerminalBrowserBridge {
	private port: number | null = null;
	private token: string | null = null;
	private last: BridgeState | null = null;
	private pollTimer: ReturnType<typeof setInterval> | null = null;
	private open = false;
	private closing = false;
	private readonly hooks: BridgeHooks;

	constructor(hooks: BridgeHooks) {
		this.hooks = hooks;
	}

	getState(): BridgeState | null {
		return this.last;
	}

	isRunning(): boolean {
		return this.port !== null;
	}

	private terminalBrowserCommand(): string[] {
		const fromEnv = process.env.TERMINAL_BROWSER_COMMAND;
		if (fromEnv) return fromEnv.split(/\s+/);
		return ["terminal-browser"];
	}

	private async checkCapabilities(command: string[]): Promise<{ ok: true } | { ok: false; installed: boolean }> {
		try {
			const { stdout } = await execFile(command[0]!, [...command.slice(1), "capabilities"], { timeout: 10_000 });
			const line = stdout.split("\n").find((text) => text.startsWith("{"));
			const parsed = line ? (JSON.parse(line) as { capabilities?: unknown }) : null;
			const capabilities = Array.isArray(parsed?.capabilities) ? (parsed!.capabilities as string[]) : [];
			const ok = REQUIRED_CAPABILITIES.every((need) => capabilities.includes(need));
			return ok ? { ok: true } : { ok: false, installed: true };
		} catch {
			return { ok: false, installed: false };
		}
	}

	// Loopback-only surface: the bridge is a child process we launched. The path
	// is constrained to the fixed route table below and the port to a valid TCP
	// port, so a malformed report cannot steer this client to an arbitrary origin.
	private static readonly ROUTES = new Set([
		"/state",
		"/open",
		"/size",
		"/input",
		"/inbox/take",
		"/browser/close",
		"/close",
	]);

	private bridgeUrl(pathName: string): string | null {
		if (!TerminalBrowserBridge.ROUTES.has(pathName)) return null;
		const port = this.port;
		if (port === null || !Number.isInteger(port) || port < 1 || port > 65535) return null;
		return `http://127.0.0.1:${port}${pathName}`;
	}

	private authHeaders(): Record<string, string> {
		return { authorization: `Bearer ${this.token}` };
	}

	async post(pathName: string, body: unknown): Promise<unknown> {
		const url = this.bridgeUrl(pathName);
		if (url === null) return null;
		try {
			const response = await fetch(url, {
				method: "POST",
				headers: { "content-type": "application/json", ...this.authHeaders() },
				body: JSON.stringify(body),
			});
			return response.ok ? JSON.parse((await response.text()) || "{}") : null;
		} catch {
			return null;
		}
	}

	private async fetchState(): Promise<BridgeState | null> {
		const url = this.bridgeUrl("/state");
		if (url === null) return null;
		try {
			const response = await fetch(url, { headers: this.authHeaders() });
			const parsed: unknown = response.ok ? JSON.parse(await response.text()) : null;
			return isBridgeState(parsed) ? parsed : null;
		} catch {
			return null;
		}
	}

	async start(): Promise<{ ok: true } | { ok: false; error: string }> {
		if (this.port !== null) return { ok: true };
		this.closing = false;
		const command = this.terminalBrowserCommand();
		const check = await this.checkCapabilities(command);
		if (!check.ok) {
			return {
				ok: false,
				error: check.installed
					? "Newer terminal-browser required — run `terminal-browser upgrade`"
					: `terminal-browser is not installed — ${INSTALL_URL}`,
			};
		}

		let report: unknown = null;
		try {
			const { stdout, stderr } = await execFile(command[0]!, [...command.slice(1), "claude-bridge", "launch"], {
				timeout: 20_000,
			});
			const line = stdout.split("\n").find((text) => text.startsWith("{"));
			report = line ? JSON.parse(line) : { error: stderr.trim() || "no report", code: "start" };
		} catch (error) {
			report = { error: String(error), code: "start" };
		}
		if (!isLaunchReport(report) || !("port" in report)) {
			const detail = isLaunchReport(report) && "error" in report ? report.error : "terminal-browser could not start";
			return { ok: false, error: detail };
		}
		this.port = report.port;
		this.token = report.token;
		this.startPolling();
		return { ok: true };
	}

	private startPolling(): void {
		if (this.pollTimer) clearInterval(this.pollTimer);
		this.pollTimer = setInterval(
			() => {
				void this.poll();
			},
			this.open ? POLL_MS : IDLE_POLL_MS,
		);
		this.pollTimer.unref?.();
	}

	private async poll(): Promise<void> {
		const fresh = await this.fetchState();
		if (!fresh) return;
		const hadInbox = fresh.inbox > 0;
		this.last = { ...fresh, placed: fresh.placed ?? this.last?.placed ?? null };
		if (hadInbox) await this.deliverAgentText();
	}

	private async deliverAgentText(): Promise<void> {
		const texts = takenTexts(await this.post("/inbox/take", {}));
		for (const text of texts) {
			const cleaned = text
				.replace(/[-\u001f\u007f-]/g, " ")
				.replace(/\s+/g, " ")
				.trim();
			if (cleaned) this.hooks.onAgentText(`> ${cleaned}`);
		}
	}

	async openUrl(url: string): Promise<void> {
		this.open = true;
		await this.post("/open", { url });
		this.startPolling();
	}

	async setSize(cols: number, rows: number): Promise<void> {
		await this.post("/size", { cols, rows });
	}

	async sendInput(events: unknown[]): Promise<void> {
		if (events.length === 0) return;
		await this.post("/input", { events });
	}

	async hide(): Promise<void> {
		this.open = false;
		await this.post("/browser/close", {});
		this.startPolling();
	}

	async shutdown(): Promise<void> {
		if (this.closing) return;
		this.closing = true;
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
		if (this.port !== null) {
			await this.post("/close", {});
		}
		this.port = null;
		this.token = null;
		this.open = false;
	}
}
