import { resolveDurableFileIdentity } from "../durable-file-identity.ts";
import { getAuthenticatedSessionControlPeer } from "../session-control-peer.ts";
import { createAuthorityClock } from "./authority-clock.ts";
import { VerifiedRunError } from "./storage.ts";
import {
	createWorkbenchControlConnection,
	type WorkbenchControlConnection,
	type WorkbenchControlConnectionOptions,
} from "./workbench-connection.ts";

export interface LocalWorkbenchControlOptions extends Omit<WorkbenchControlConnectionOptions, "peer"> {
	readonly controlSessionId: string;
	readonly controlSessionPath: string;
	readonly actorId: string;
	readonly authorizationDeadline: number;
}
export interface LocalWorkbenchControlConnection extends WorkbenchControlConnection {
	dispose(): void;
}

export function bindAuthenticatedWorkbenchControlConnection(
	peer: unknown,
	options: LocalWorkbenchControlOptions,
): LocalWorkbenchControlConnection {
	const authenticated = getAuthenticatedSessionControlPeer(peer);
	if (!authenticated) throw new VerifiedRunError("workbench_unauthenticated");
	if (
		authenticated.sessionId !== options.controlSessionId ||
		authenticated.sessionPath !== resolveDurableFileIdentity(options.controlSessionPath).canonicalPath
	)
		throw new VerifiedRunError("workbench_identity");
	const clock = options.clock ?? createAuthorityClock();
	function assertPeer() {
		if (getAuthenticatedSessionControlPeer(authenticated) !== authenticated)
			throw new VerifiedRunError("workbench_unauthenticated");
	}
	const connection = createWorkbenchControlConnection({
		...options,
		peer: {
			actorId: options.actorId,
			connectionId: authenticated.connectionId,
			signal: authenticated.signal,
			authorizationDeadline: options.authorizationDeadline,
		},
		clock: () => {
			const now = clock();
			assertPeer();
			return now;
		},
	});
	return Object.freeze({
		identity: connection.identity,
		validate(frame: Uint8Array) {
			assertPeer();
			return connection.validate(frame);
		},
		dispose: authenticated.dispose,
	});
}
