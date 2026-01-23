/**
 * Run modes for the coding agent.
 */
export { InteractiveMode, type InteractiveModeOptions } from "./interactive-mode";
export { type PrintModeOptions, runPrintMode } from "./print-mode";
export { type ModelInfo, RpcClient, type RpcClientOptions, type RpcEventListener } from "./rpc/rpc-client";
export { runRpcMode } from "./rpc/rpc-mode";
export type { RpcCommand, RpcResponse, RpcSessionState } from "./rpc/rpc-types";

import { emergencyTerminalRestore } from "@oh-my-pi/pi-tui";
import { postmortem } from "@oh-my-pi/pi-utils";

postmortem.register("terminal-restore", () => {
	emergencyTerminalRestore();
});
