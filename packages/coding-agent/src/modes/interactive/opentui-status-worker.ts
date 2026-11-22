import { loadOpenTui, type OpenTui, type OpenTuiTestSetup } from "./opentui-core.ts";
import type { FooterPanelModel } from "./opentui-footer-model.ts";
import { buildFooterScene } from "./opentui-footer-render.ts";
import { buildStatusScene, statusSpansToAnsi } from "./opentui-status-render.ts";
import type { StatusPanelModel } from "./status-panel-model.ts";

type RenderRequest = { id: number; width: number; height: number } & (
	| { kind: "status"; model: StatusPanelModel }
	| { kind: "footer"; model: FooterPanelModel }
);

// Each worker serves one hybrid surface, so one pending slot is enough.
let openTui: OpenTui | undefined;
let setup: OpenTuiTestSetup | undefined;
let root: ReturnType<typeof buildStatusScene> | undefined;
let closing = false;
let pending: RenderRequest | undefined;
let active: Promise<void> | undefined;

async function renderPending(): Promise<void> {
	while (pending && !closing) {
		const request = pending;
		pending = undefined;
		openTui ??= await loadOpenTui();
		setup ??= await openTui.createTestRenderer({
			width: request.width,
			height: request.height,
			exitOnCtrlC: false,
			exitSignals: [],
			useMouse: false,
			autoFocus: false,
		});
		setup.resize(request.width, request.height);
		root?.destroyRecursively();
		root =
			request.kind === "footer"
				? buildFooterScene(openTui, setup.renderer, request.model, request.width, request.height)
				: buildStatusScene(openTui, setup.renderer, request.model, request.width, request.height);
		setup.renderer.root.add(root);
		await setup.renderOnce();
		if (!closing && process.connected)
			process.send?.({
				id: request.id,
				lines: statusSpansToAnsi(setup.captureSpans().lines, openTui.boldAttribute),
			});
	}
}

process.on("message", (message: unknown) => {
	if (closing || !message || typeof message !== "object") return;
	const request = message as Record<string, unknown>;
	// Requests without a kind come from status-only hosts.
	const kind = request.kind ?? "status";
	const [minWidth, maxWidth, minHeight, maxHeight] = kind === "footer" ? [1, 1000, 1, 8] : [20, 100, 8, 200];
	if (
		(kind !== "status" && kind !== "footer") ||
		!Number.isSafeInteger(request.id) ||
		!Number.isSafeInteger(request.width) ||
		!Number.isSafeInteger(request.height) ||
		typeof request.width !== "number" ||
		request.width < minWidth ||
		request.width > maxWidth ||
		typeof request.height !== "number" ||
		request.height < minHeight ||
		request.height > maxHeight ||
		!request.model ||
		typeof request.model !== "object" ||
		(kind === "footer" && !Array.isArray((request.model as Record<string, unknown>).lines))
	)
		return;
	pending = { ...request, kind } as RenderRequest;
	if (!active)
		active = renderPending()
			.catch(() => {
				if (!openTui && process.connected) process.send?.({ id: request.id, error: "dependency-error" });
				void close();
			})
			.finally(() => {
				active = undefined;
			});
});

async function close(): Promise<void> {
	if (closing) return;
	closing = true;
	pending = undefined;
	await active;
	await setup?.dispose();
	process.exit(0);
}
process.on("disconnect", () => {
	void close();
});
process.on("SIGTERM", () => {
	void close();
});
process.on("SIGINT", () => {
	void close();
});
