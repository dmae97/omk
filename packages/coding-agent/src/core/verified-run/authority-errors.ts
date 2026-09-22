import type { DurableFileLockObservation } from "../durable-file-identity.ts";

export class AuthorityStoreError extends Error {
	readonly code: string;
	constructor(code: string) {
		super(`authority-store: ${code}`);
		this.name = "AuthorityStoreError";
		this.code = code;
	}
}

export class AuthorityLeaseHeldError extends Error {
	readonly observation: DurableFileLockObservation;
	constructor(observation: DurableFileLockObservation) {
		super("Authority store has a live or indeterminate owner; automatic recovery is refused");
		this.name = "AuthorityLeaseHeldError";
		this.observation = observation;
	}
}
