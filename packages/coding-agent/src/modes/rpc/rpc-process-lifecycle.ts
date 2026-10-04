import type { ChildProcess } from "node:child_process";

/** Final stdout gets a short drain window even if a descendant holds inherited pipes. */
export const RPC_POST_EXIT_DRAIN_MS = 100;

export class RpcTerminationUncertainError extends Error {
	readonly code = "rpc.termination_uncertain";

	constructor(signal: NodeJS.Signals, cause?: unknown) {
		super(`RPC child termination uncertain: ${signal} signalling failed`, { cause });
		this.name = "RpcTerminationUncertainError";
	}
}

/** Direct-process termination and bounded post-exit stdio draining are separate boundaries. */
export class RpcProcessLifecycle {
	private readonly child: ChildProcess;
	private drainTimer: ReturnType<typeof setTimeout> | undefined;
	private drainFinished = false;
	private drainCancelled = false;
	private stopCompletion: Promise<void> | undefined;
	private detachDrain: () => void = () => {};

	constructor(child: ChildProcess, drained: (code: number | null, signal: NodeJS.Signals | null) => void) {
		this.child = child;
		const finishDrain = (code: number | null, signal: NodeJS.Signals | null): void => {
			this.detachDrain();
			if (this.drainTimer !== undefined) clearTimeout(this.drainTimer);
			this.drainTimer = undefined;
			if (this.drainFinished || this.drainCancelled) return;
			this.drainFinished = true;
			drained(code, signal);
		};
		const onExited = (code: number | null, signal: NodeJS.Signals | null): void => {
			if (!this.drainFinished && !this.drainCancelled) {
				this.drainTimer = setTimeout(() => finishDrain(code, signal), RPC_POST_EXIT_DRAIN_MS);
			}
		};
		this.detachDrain = () => {
			child.off("exit", onExited);
			child.off("close", finishDrain);
		};
		child.once("exit", onExited);
		child.once("close", finishDrain);
	}

	cancelDrain(): void {
		this.detachDrain();
		this.drainCancelled = true;
		if (this.drainTimer !== undefined) clearTimeout(this.drainTimer);
		this.drainTimer = undefined;
	}

	stop(): Promise<void> {
		this.cancelDrain();
		const child = this.child;
		if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
		if (this.stopCompletion) return this.stopCompletion;
		const completion = new Promise<void>((resolve, reject) => {
			const finish = (error?: Error): void => {
				clearTimeout(timer);
				child.off("exit", onStopped);
				child.off("close", onStopped);
				if (error) reject(error);
				else resolve();
			};
			const onStopped = (): void => finish();
			const signal = (name: NodeJS.Signals): void => {
				try {
					if (!child.kill(name)) {
						if (child.exitCode !== null || child.signalCode !== null) finish();
						else finish(new RpcTerminationUncertainError(name));
					}
				} catch (error: unknown) {
					finish(new RpcTerminationUncertainError(name, error));
				}
			};
			const timer = setTimeout(() => signal("SIGKILL"), 1000);
			child.once("exit", onStopped);
			child.once("close", onStopped);
			signal("SIGTERM");
		});
		this.stopCompletion = completion;
		void completion.catch(() => {
			if (this.stopCompletion === completion) this.stopCompletion = undefined;
		});
		return completion;
	}
}
