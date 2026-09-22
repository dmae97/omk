import { formatSessionTermination, type SessionTermination } from "../../core/session-termination.ts";
import type { RpcCommand, RpcResponse } from "./rpc-types.ts";

export function success<T extends RpcCommand["type"]>(
	id: string | undefined,
	command: T,
	data?: object | null,
): RpcResponse {
	if (data === undefined) return { id, type: "response", command, success: true } as RpcResponse;
	return { id, type: "response", command, success: true, data } as RpcResponse;
}

export function error(
	id: string | undefined,
	command: string,
	message: string,
	termination?: SessionTermination,
): RpcResponse {
	return {
		id,
		type: "response",
		command,
		success: false,
		error: termination ? formatSessionTermination(termination) : message,
		...(termination ? { termination } : {}),
	};
}
