import { type ChildProcess, fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { type Component, truncateToWidth } from "omk-tui";
import type { StatusPanelModel } from "./status-panel-model.ts";

export class HybridStatusPanel implements Component {
	private child: ChildProcess | undefined;
	private closed: Promise<void> = Promise.resolve();
	private frame: { width: number; height: number; lines: string[] } | undefined;
	private previous = "";
	private pendingFrame: { width: number; height: number } | undefined;
	private revision = 0;
	private inFlight = false;
	private failed = false;
	private disposed = false;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private expanded = false;
	private readonly readModel: (expanded: boolean) => StatusPanelModel;
	private readonly fallback: Component;
	private readonly getRows: () => number;
	private readonly requestRender: () => void;

	constructor(
		readModel: (expanded: boolean) => StatusPanelModel,
		fallback: Component,
		getRows: () => number,
		requestRender: () => void,
	) {
		this.readModel = readModel;
		this.fallback = fallback;
		this.getRows = getRows;
		this.requestRender = requestRender;
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.invalidate();
	}
	invalidate(): void {
		this.previous = "";
		this.fallback.invalidate();
	}

	render(width: number): string[] {
		if (this.disposed || this.failed) return this.fallback.render(width);
		const height = Math.max(8, Math.min(200, this.getRows()));
		try {
			const request = { width, height, model: this.readModel(this.expanded) };
			const signature = JSON.stringify(request);
			if (signature !== this.previous && !this.inFlight) {
				this.start();
				if (!this.failed && this.child?.connected) {
					this.previous = signature;
					this.inFlight = true;
					this.pendingFrame = { width, height };
					this.child.send({ id: ++this.revision, ...request }, (error) => {
						if (error) this.fail();
					});
					this.timer ??= setTimeout(() => this.fail(), 5000).unref();
				}
			}
		} catch {
			this.fail();
		}
		return this.frame?.width === width && this.frame.height === height
			? this.frame.lines
			: this.fallback.render(width);
	}

	private start(): void {
		if (this.child || this.failed) return;
		const [major, minor] = process.versions.node.split(".").map(Number);
		if (major < 26 || (major === 26 && minor < 4)) {
			this.failed = true;
			return;
		}
		const suffix = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
		const entry = fileURLToPath(new URL(`./opentui-status-worker${suffix}`, import.meta.url));
		const env = Object.fromEntries(
			["PATH", "HOME", "TMPDIR", "TERM", "COLORTERM"].flatMap((key) =>
				process.env[key] === undefined ? [] : [[key, process.env[key]]],
			),
		);
		const child = fork(entry, [], {
			execArgv: ["--experimental-ffi"],
			stdio: ["ignore", "ignore", "ignore", "ipc"],
			env,
		});
		this.child = child;
		this.closed = new Promise((resolve) =>
			child.once("close", () => {
				this.child = undefined;
				if (this.timer) clearTimeout(this.timer);
				this.timer = undefined;
				resolve();
			}),
		);
		child.on("error", () => this.fail());
		child.on("exit", () => {
			if (!this.disposed) this.fail();
		});
		child.on("message", (message: unknown) => {
			if (this.disposed || this.failed || !message || typeof message !== "object") return;
			const reply = message as Record<string, unknown>;
			if (
				reply.id !== this.revision ||
				!Array.isArray(reply.lines) ||
				!reply.lines.every((line) => typeof line === "string")
			)
				return;
			const request = this.pendingFrame;
			if (!request) return;
			this.pendingFrame = undefined;
			this.frame = {
				...request,
				lines: reply.lines.slice(0, request.height).map((line) => truncateToWidth(line, request.width, "")),
			};
			if (this.timer) clearTimeout(this.timer);
			this.timer = undefined;
			this.inFlight = false;
			this.requestRender();
		});
	}

	private fail(): void {
		if (this.failed || this.disposed) return;
		this.failed = true;
		this.frame = undefined;
		this.stopChild();
		this.requestRender();
	}
	private stopChild(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
		const child = this.child;
		if (!child || child.exitCode !== null || child.signalCode !== null) return;
		child.kill("SIGTERM");
		const timer = setTimeout(() => child.kill("SIGKILL"), 2000).unref();
		child.once("close", () => clearTimeout(timer));
	}
	dispose(): void {
		this.disposed = true;
		this.frame = undefined;
		this.stopChild();
	}
	waitForClose(): Promise<void> {
		return this.closed;
	}
}
