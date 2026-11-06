import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing";
import { buildStatusScene, statusSpansToAnsi } from "./opentui-status-render.ts";
import type { StatusPanelModel } from "./status-panel-model.ts";

let setup: TestRendererSetup | undefined;
let root: ReturnType<typeof buildStatusScene> | undefined;
let closing = false;
let pending: { id: number; width: number; height: number; model: StatusPanelModel } | undefined;
let active: Promise<void> | undefined;

async function renderPending(): Promise<void> {
	while (pending && !closing) {
		const request = pending;
		pending = undefined;
		setup ??= await createTestRenderer({
			width: request.width,
			height: request.height,
			exitOnCtrlC: false,
			exitSignals: [],
			useMouse: false,
			autoFocus: false,
		});
		setup.resize(request.width, request.height);
		root?.destroyRecursively();
		root = buildStatusScene(setup.renderer, request.model, request.width, request.height);
		setup.renderer.root.add(root);
		await setup.renderOnce();
		if (!closing && process.connected)
			process.send?.({ id: request.id, lines: statusSpansToAnsi(setup.captureSpans().lines) });
	}
}

process.on("message", (message: unknown) => {
	if (closing || !message || typeof message !== "object") return;
	const request = message as Record<string, unknown>;
	if (
		!Number.isSafeInteger(request.id) ||
		!Number.isSafeInteger(request.width) ||
		!Number.isSafeInteger(request.height) ||
		typeof request.width !== "number" ||
		request.width < 20 ||
		request.width > 100 ||
		typeof request.height !== "number" ||
		request.height < 8 ||
		request.height > 200 ||
		!request.model ||
		typeof request.model !== "object"
	)
		return;
	pending = request as typeof pending;
	if (!active)
		active = renderPending()
			.catch(() => {
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
