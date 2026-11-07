import { lstatSync } from "node:fs";
import { resolve } from "node:path";
import { parseRunStartCommand, type RunStartCommand } from "omk-protocol";
import type { SessionOwnerLease } from "../session-owner-lease.ts";
import { createAuthorityClock } from "./authority-clock.ts";
import { authorityPendingReconcile } from "./authority-events.ts";
import type { RunAuthority } from "./authority-runtime.ts";
import { AuthorityStore, authorityStorePath } from "./authority-store.ts";
import { journalPath } from "./journal.ts";
import { digestObject, stateRunPath, VerifiedRunError } from "./storage.ts";
import { validateWorkbenchControlFrame, type WorkbenchControlHostContext } from "./workbench-control.ts";

export interface WorkbenchControlConnectionOptions {
	readonly stateRoot: string;
	readonly owner: SessionOwnerLease;
	readonly authority: RunAuthority;
	readonly hostId: string;
	readonly hostSignal: AbortSignal;
	readonly peer: WorkbenchControlHostContext["peer"];
	readonly expectedCommand: RunStartCommand;
	readonly clock?: () => number;
}
export interface WorkbenchControlConnection {
	readonly identity: {
		readonly hostId: string;
		readonly hostEpoch: string;
		readonly actorId: string;
		readonly connectionId: string;
		readonly runId: string;
		readonly commandId: string;
	};
	validate(frame: Uint8Array): ReturnType<typeof validateWorkbenchControlFrame>;
}

/** Caller-owned resources; this factory acquires/releases nothing and never admits execution. */
export function createWorkbenchControlConnection(
	options: WorkbenchControlConnectionOptions,
): WorkbenchControlConnection {
	const hostId = options.hostId;
	const hostSignal = options.hostSignal;
	const suppliedPeer = options.peer;
	if (
		!suppliedPeer ||
		!(hostSignal instanceof AbortSignal) ||
		!(suppliedPeer.signal instanceof AbortSignal) ||
		hostSignal.aborted ||
		suppliedPeer.signal.aborted
	)
		throw new VerifiedRunError("workbench_unauthenticated");
	const peer = Object.freeze({
		actorId: suppliedPeer.actorId,
		connectionId: suppliedPeer.connectionId,
		signal: suppliedPeer.signal,
		authorizationDeadline: suppliedPeer.authorizationDeadline,
	});
	const owner = options.owner;
	const ownerIdentity = owner.identity;
	const { store, sessionId, incarnation } = options.authority;
	const command = parseRunStartCommand(options.expectedCommand);
	const root = resolve(options.stateRoot);
	if (
		!(store instanceof AuthorityStore) ||
		resolve(store.path) !== authorityStorePath(root) ||
		sessionId !== command.runId
	)
		throw new VerifiedRunError("command_conflict");
	const runJournal = journalPath(stateRunPath(root, command.runId));
	const clock = createAuthorityClock(options.clock);

	function inspectOwned(expectedEpoch?: string) {
		if (hostSignal.aborted || peer.signal.aborted) throw new VerifiedRunError("workbench_unauthenticated");
		if (store.isReleased || owner.identity !== ownerIdentity || !owner.owns(runJournal))
			throw new VerifiedRunError("stale_owner");
		const inspection = AuthorityStore.inspectJournal(store.path);
		if (store.isReleased || owner.identity !== ownerIdentity || !owner.owns(runJournal))
			throw new VerifiedRunError("stale_owner");
		if (digestObject(inspection.head) !== digestObject(store.head)) throw new VerifiedRunError("stale_head");
		const state = inspection.state;
		if (state.epoch === null || authorityPendingReconcile(state)) throw new VerifiedRunError("reconcile_pending");
		if (expectedEpoch !== undefined && state.epoch !== expectedEpoch) throw new VerifiedRunError("stale_epoch");
		if (state.incarnations.get(sessionId) !== incarnation) throw new VerifiedRunError("stale_incarnation");
		try {
			lstatSync(runJournal);
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") return state.epoch;
			throw error;
		}
		throw new VerifiedRunError("precondition");
	}

	const hostEpoch = inspectOwned();
	const context: WorkbenchControlHostContext = Object.freeze({
		hostId,
		hostEpoch,
		hostSignal,
		peer,
		graphRevision: 0,
		runState: "absent",
		expectedCommand: command,
		clock: () => {
			const now = clock();
			inspectOwned(hostEpoch);
			return now;
		},
	});
	return Object.freeze({
		identity: Object.freeze({
			hostId,
			hostEpoch,
			actorId: peer.actorId,
			connectionId: peer.connectionId,
			runId: command.runId,
			commandId: command.commandId,
		}),
		validate(frame: Uint8Array) {
			inspectOwned(hostEpoch);
			return validateWorkbenchControlFrame(frame, context);
		},
	});
}
