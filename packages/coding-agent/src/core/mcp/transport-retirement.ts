/** These are direct-process/stdio observations, not proofs about remote tool effects. */
interface RetiringClient {
	close(): void;
	waitForTransportClose(): Promise<void>;
}
interface RetirementOwner {
	retiring?: Promise<void>;
	error?: string;
}
const retired = new WeakMap<object, Promise<void>>();

/**
 * Preserve an unresolved physical close across generation changes. A rejected
 * or missing close observation is unknown, never permission to reuse resources.
 * Native clients resolve only after the subprocess stdio `close` event (or a
 * close before any spawn). Injected clients must implement the same contract.
 */
export function retireMcpClient(owner: RetirementOwner, client: RetiringClient): Promise<void> {
	let pending = retired.get(client);
	if (pending === undefined) {
		let confirm: () => void = () => {};
		pending = new Promise<void>((resolve) => {
			confirm = resolve;
		});
		retired.set(client, pending);
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
	const joined = owner.retiring === undefined ? pending : Promise.all([owner.retiring, pending]).then(() => {});
	owner.retiring = joined;
	void joined.then(() => {
		if (owner.retiring === joined) owner.retiring = undefined;
	});
	return joined;
}
