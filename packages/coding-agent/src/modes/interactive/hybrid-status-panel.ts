import { type ChildProcess, fork, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { type Component, truncateToWidth } from "omk-tui";
import { isBunBinary } from "../../config.ts";
import { OPENTUI_STATUS_WORKER_ARG } from "./opentui-status-worker-protocol.ts";
import type { StatusPanelModel } from "./status-panel-model.ts";

type Failure = "unsupported-runtime" | "dependency-error" | "render-error" | "worker-error" | "worker-timeout";
/** Which offscreen scene the worker builds, and how many rows it gets for a model. */
export type HybridSurface<M> = { kind: "status" | "footer"; height: (model: M, rows: number) => number };

const STATUS_SURFACE: HybridSurface<unknown> = {
	kind: "status",
	height: (_model, rows) => Math.max(8, Math.min(200, rows)),
};

export class HybridStatusPanel<M = StatusPanelModel> implements Component {
	private child: ChildProcess | undefined;
	private closed: Promise<void> = Promise.resolve();
	private frame: { width: number; height: number; lines: string[] } | undefined;
	private previous = "";
	private pendingFrame: { width: number; height: number } | undefined;
	private revision = 0;
	private inFlight = false;
	private failed?: Failure;
	private rendered: "not-rendered" | "native-fallback" | "opentui-frame" = "not-rendered";
	get renderState() {
		return this.failed ?? this.rendered;
	}
	private disposed = false;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private expanded = false;
	private readonly readModel: (expanded: boolean, width: number) => M;
	private readonly fallback: Component;
	private readonly getRows: () => number;
	private readonly requestRender: () => void;
	private readonly surface: HybridSurface<M>;

	constructor(
		readModel: (expanded: boolean, width: number) => M,
		fallback: Component,
		getRows: () => number,
		requestRender: () => void,
		surface: HybridSurface<M> = STATUS_SURFACE,
	) {
		this.readModel = readModel;
		this.fallback = fallback;
		this.getRows = getRows;
		this.requestRender = requestRender;
		this.surface = surface;
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
		let height = 0;
		try {
			const model = this.readModel(this.expanded, width);
			height = this.surface.height(model, this.getRows());
			const request = { kind: this.surface.kind, width, height, model };
			const signature = JSON.stringify(request);
			if (signature !== this.previous && !this.inFlight) {
				this.start();
				if (!this.failed && this.child?.connected) {
					this.previous = signature;
					this.inFlight = true;
					this.pendingFrame = { width, height };
					this.child.send({ id: ++this.revision, ...request }, (error) => {
						if (error) this.fail("worker-error");
					});
					this.timer ??= setTimeout(() => this.fail("worker-timeout"), 5000).unref();
				}
			}
		} catch {
			this.fail("render-error");
		}
		if (this.frame?.width === width && this.frame.height === height) {
			this.rendered = "opentui-frame";
			return this.frame.lines;
		}
		this.rendered = "native-fallback";
		return this.fallback.render(width);
	}

	private start(): void {
		if (this.child || this.failed) return;
		const runtime = isBunBinary ? process.versions.bun : process.versions.node;
		const [major, minor, patch] = (runtime ?? "").split(".").map(Number);
		const supported = isBunBinary
			? major > 1 || (major === 1 && (minor > 3 || (minor === 3 && patch >= 14)))
			: major > 26 || (major === 26 && minor >= 4);
		if (!supported) {
			this.failed = "unsupported-runtime";
			return;
		}
		const env = Object.fromEntries(
			["PATH", "HOME", "TMPDIR", "TERM", "COLORTERM"].flatMap((key) =>
				process.env[key] === undefined ? [] : [[key, process.env[key]]],
			),
		);
		const stdio: ["ignore", "ignore", "ignore", "ipc"] = ["ignore", "ignore", "ignore", "ipc"];
		const suffix = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
		const child = isBunBinary
			? spawn(process.execPath, [OPENTUI_STATUS_WORKER_ARG], { stdio, env, serialization: "json" })
			: fork(fileURLToPath(new URL(`./opentui-status-worker${suffix}`, import.meta.url)), [], {
					execArgv: ["--experimental-ffi"],
					stdio,
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
		child.on("error", () => this.fail("worker-error"));
		child.on("exit", () => {
			if (!this.disposed) this.fail("worker-error");
		});
		child.on("message", (message: unknown) => {
			if (this.disposed || this.failed || !message || typeof message !== "object") return;
			const reply = message as Record<string, unknown>;
			if (reply.id === this.revision && reply.error === "dependency-error") {
				this.fail("dependency-error");
				return;
			}
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

	private fail(reason: Failure): void {
		if (this.failed || this.disposed) return;
		this.failed = reason;
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
