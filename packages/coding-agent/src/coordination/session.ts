/**
 * Generation-tagged browser session lifecycle (Jev audit F03, algorithm A6 §12.5).
 *
 *   idle → initializing(g) → ready(g) → draining(g) → closed(g)
 *                        ↘ init failure → idle
 *        ready | draining → close failure → close-failed(g)
 *
 * Two reproduced defects motivate every rule here:
 *   R09 — shutdown read an empty session slot while init was in flight, then
 *         the init completed and assigned it, resurrecting a closed session.
 *   R10 — close cleared the handle before the driver call resolved, so a close
 *         that threw left no handle and the next call claimed success.
 *
 * The invariant is that a handle is never dropped on the floor: a late init
 * from a superseded generation is moved to `discardedHandles` for the caller
 * to clean up, and a failed close keeps its handle in `close-failed`.
 */

import type { Sequence } from "./types.ts";
import { nextSequence, sequence } from "./types.ts";

export type SessionState = "idle" | "initializing" | "ready" | "draining" | "closed" | "close-failed";

export class SessionLifecycle<THandle = unknown> {
	private currentState: SessionState = "idle";
	private generation: Sequence = sequence("0");
	private currentHandle: THandle | undefined;
	private failure: Error | undefined;
	private shutdownRequested = false;
	private readonly discarded: THandle[] = [];

	get state(): SessionState {
		return this.currentState;
	}

	get currentGeneration(): Sequence {
		return this.generation;
	}

	get handle(): THandle | undefined {
		return this.currentHandle;
	}

	/** Handles from superseded or unknown generations; the caller must close them. */
	get discardedHandles(): readonly THandle[] {
		return [...this.discarded];
	}

	get closeFailure(): Error | undefined {
		return this.failure;
	}

	/** Only a completed close counts. A close failure is not closed. */
	get isClosed(): boolean {
		return this.currentState === "closed";
	}

	/**
	 * Open a new generation.
	 *
	 * Refused while a close failure is unresolved: launching a second browser
	 * on top of one that may still be running is how orphan processes and
	 * duplicate effects start.
	 */
	beginInit(): Sequence {
		if (this.currentState === "close-failed") {
			throw new Error("cannot initialize while a close-failed session is unresolved");
		}
		if (this.currentState === "initializing" || this.currentState === "ready" || this.currentState === "draining") {
			throw new Error(`cannot initialize from state ${this.currentState}`);
		}
		this.generation = nextSequence(this.generation);
		this.shutdownRequested = false;
		this.currentState = "initializing";
		return this.generation;
	}

	/**
	 * Adopt an initialized handle.
	 *
	 * Returns false when this generation is no longer the one being awaited —
	 * the handle is retained for cleanup rather than installed, because the
	 * session it belonged to is already gone.
	 */
	completeInit(generation: Sequence, handle: THandle): boolean {
		if (generation !== this.generation || this.currentState !== "initializing") {
			this.discarded.push(handle);
			return false;
		}
		this.currentHandle = handle;
		this.currentState = "ready";
		return true;
	}

	failInit(generation: Sequence, error: Error): boolean {
		if (generation !== this.generation || this.currentState !== "initializing") return false;
		this.failure = undefined;
		this.currentHandle = undefined;
		this.currentState = "idle";
		void error;
		return true;
	}

	/**
	 * Ask the session to stop.
	 *
	 * With no handle yet there is nothing to drain, so this closes immediately
	 * and any in-flight init will be discarded on arrival. With a live handle
	 * the session must drain: the caller still has to close the driver.
	 */
	requestShutdown(): void {
		this.shutdownRequested = true;
		if (this.currentState === "initializing" || this.currentState === "idle") {
			this.currentState = "closed";
			return;
		}
		if (this.currentState === "ready") this.currentState = "draining";
	}

	beginClose(): void {
		if (this.currentState !== "ready" && this.currentState !== "close-failed") {
			throw new Error(`cannot close from state ${this.currentState}`);
		}
		this.failure = undefined;
		this.currentState = "draining";
	}

	/** The driver confirmed the session is gone; only now is the handle released. */
	completeClose(): void {
		if (this.currentState !== "draining") {
			throw new Error(`cannot complete close from state ${this.currentState}`);
		}
		this.currentHandle = undefined;
		this.failure = undefined;
		this.currentState = "closed";
	}

	/** The close attempt threw. Keep the handle so a retry can still reach it. */
	failClose(error: Error): void {
		if (this.currentState !== "draining") {
			throw new Error(`cannot fail close from state ${this.currentState}`);
		}
		this.failure = error;
		this.currentState = "close-failed";
	}

	/**
	 * Fencing gate: accept a command only from the current generation of a
	 * ready session. A generation number in a log proves nothing; the gate that
	 * hands commands to the driver has to be the one refusing stale ones.
	 */
	accepts(generation: Sequence): boolean {
		return this.currentState === "ready" && generation === this.generation;
	}

	/** True once a shutdown was asked for, regardless of how far draining got. */
	get shutdownPending(): boolean {
		return this.shutdownRequested;
	}
}
