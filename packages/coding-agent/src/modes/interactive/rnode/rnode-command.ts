import { join, resolve } from "node:path";
import { getAgentDir } from "../../../config.ts";
import { singleLineDisplayText } from "../../../utils/display-text.ts";
import { keyText } from "../components/keybinding-hints.ts";
import type { RNodeController } from "./rnode-controller.ts";

export const RNODE_USAGE = "Usage: /rnode <runId> [--state-dir DIR] | /rnode off | /rnode";

/** Same rule as `stateRunPath`, checked before any read so the message names the input. */
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export type RNodeCommand =
	| { readonly kind: "status" }
	| { readonly kind: "off" }
	| { readonly kind: "bind"; readonly runId: string; readonly stateDir: string | undefined }
	| { readonly kind: "usage"; readonly problem: string };

/** Returns undefined when `text` is not an /rnode command. */
export function parseRNodeCommand(text: string): RNodeCommand | undefined {
	if (text !== "/rnode" && !text.startsWith("/rnode ")) return undefined;
	const args = text.slice("/rnode".length).trim().split(/\s+/).filter(Boolean);
	if (args.length === 0) return { kind: "status" };
	if (args.length === 1 && args[0] === "off") return { kind: "off" };
	const [runId, ...rest] = args;
	if (runId === undefined || !RUN_ID.test(runId)) return { kind: "usage", problem: "invalid run id" };
	if (rest.length === 0) return { kind: "bind", runId, stateDir: undefined };
	if (rest.length === 2 && rest[0] === "--state-dir" && rest[1] !== undefined) {
		return { kind: "bind", runId, stateDir: rest[1] };
	}
	return { kind: "usage", problem: "unexpected arguments" };
}

export interface RNodeCommandHost {
	status(message: string): void;
	error(message: string): void;
}

export interface RNodeCommandContext {
	/** Default state root, the same one `omk run graph` uses without `--state-dir`. */
	readonly agentDir: string;
	readonly cwd: string;
	/** Key text for the expanded control pane, where R·NODE renders while the status sidebar is not pinned. */
	readonly expandKey: string;
}

export function runRNodeCommand(
	command: RNodeCommand,
	controller: RNodeController,
	host: RNodeCommandHost,
	context: RNodeCommandContext,
): void {
	switch (command.kind) {
		case "usage":
			host.error(`/rnode: ${command.problem}. ${RNODE_USAGE}`);
			return;
		case "off":
			controller.clear();
			host.status("R·NODE unbound.");
			return;
		case "status": {
			const target = controller.target;
			if (target === undefined) {
				host.status(`R·NODE is not bound. ${RNODE_USAGE}`);
				return;
			}
			const failure = controller.failure;
			const read = failure === undefined ? "last read ok" : `last read failed: ${failure}`;
			host.status(`R·NODE: ${target.runId} in ${singleLineDisplayText(target.stateRoot)} (${read}).`);
			return;
		}
		case "bind": {
			const stateRoot =
				command.stateDir === undefined
					? join(context.agentDir, "verified-runs")
					: resolve(context.cwd, command.stateDir);
			controller.bind({ runId: command.runId, stateRoot });
			const failure = controller.failure;
			const where = `Observing ${command.runId} read-only; it shows in the pinned status sidebar, or the expanded control pane (${context.expandKey}).`;
			if (failure === undefined) host.status(where);
			else host.error(`${where} First read failed: ${failure}. Polling continues.`);
		}
	}
}

/**
 * Interactive entry point: returns false when `text` is not /rnode, so the caller keeps dispatching.
 * `cwd` is read only for an /rnode command, never for ordinary input.
 */
export function handleRNodeInput(
	text: string,
	controller: RNodeController,
	host: RNodeCommandHost,
	cwd: () => string,
): boolean {
	const command = parseRNodeCommand(text);
	if (command === undefined) return false;
	runRNodeCommand(command, controller, host, {
		agentDir: getAgentDir(),
		cwd: cwd(),
		expandKey: keyText("app.tools.expand"),
	});
	return true;
}
