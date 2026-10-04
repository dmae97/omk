/** These are direct-process/stdio observations, not proofs about remote tool effects. */
interface RetiringClient {
	close(): void;
	waitForTransportClose(): Promise<void>;
}
interface RetirementOwner {
	retiring?: Promise<void>;
	error?: string;
}
interface RetirementEpoch {
	readonly clients: WeakSet<object>;
	joined?: Promise<void>;
}
const retired = new WeakMap<object, Promise<void>>();
const epochs = new WeakMap<RetirementOwner, RetirementEpoch>();

/**
 * Preserve an unresolved physical close across generation changes. A rejected
 * or missing close observation is unknown, never permission to reuse resources.
 * Native clients resolve only after the subprocess stdio `close` event (or a
 * close before any spawn). Injected clients must implement the same contract.
 */
export function retireMcpClient(owner: RetirementOwner, client: RetiringClient): Promise<void> {
	let epoch = epochs.get(owner);
	if (!epoch || epoch.joined !== owner.retiring) {
		epoch = { clients: new WeakSet(), joined: owner.retiring };
		epochs.set(owner, epoch);
	}
	if (epoch.joined && epoch.clients.has(client)) return epoch.joined;

	let pending = retired.get(client);
	let confirm: (() => void) | undefined;
	if (pending === undefined) {
		pending = new Promise<void>((resolve) => {
			confirm = resolve;
		});
		retired.set(client, pending);
	}
	const joined = epoch.joined === undefined ? pending : Promise.all([epoch.joined, pending]).then(() => {});
	epoch.clients.add(client);
	epoch.joined = joined;
	owner.retiring = joined;
	void joined.then(() => {
		if (epochs.get(owner) === epoch && epoch.joined === joined && owner.retiring === joined) {
			owner.retiring = undefined;
			epochs.delete(owner);
		}
	});
	// Publish both identities before client code can reenter retirement.
	if (confirm) {
		try {
			void client.waitForTransportClose().then(confirm, () => {
				owner.error = "mcp.transport_retirement_unconfirmed";
			});
		} catch {
			owner.error = "mcp.transport_retirement_unconfirmed";
		}
		try {
			client.close();
		} catch {
			// A later physical observation may still resolve the held reservation.
			owner.error = "mcp.transport_retirement_unconfirmed";
		}
	}
	return joined;
}
