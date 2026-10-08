import type { Agent, AgentMessage } from "omk-agent-core";

type Transform = NonNullable<Agent["transformContext"]>;
interface Owner {
	previous: Agent["transformContext"];
	enrich?: (messages: AgentMessage[]) => AgentMessage[];
}
const owners = new WeakMap<Transform, Owner>();

function livePredecessor(callback: Agent["transformContext"]): Agent["transformContext"] {
	while (callback) {
		const owner = owners.get(callback);
		if (!owner || owner.enrich) return callback;
		callback = owner.previous;
	}
	return undefined;
}

/** The retained wrapper holds only this detachable owner, never the controller itself. */
export function memoryContextTransform(previous: Agent["transformContext"], enrich: Owner["enrich"]) {
	const owner: Owner = { previous: livePredecessor(previous), enrich };
	const transform: Transform = async (messages, signal) => {
		owner.previous = livePredecessor(owner.previous);
		const transformed = owner.previous ? await owner.previous(messages, signal) : messages;
		signal?.throwIfAborted();
		return owner.enrich ? owner.enrich(transformed) : transformed;
	};
	owners.set(transform, owner);
	return {
		transform,
		close(): Agent["transformContext"] {
			owner.enrich = undefined;
			owner.previous = livePredecessor(owner.previous);
			return owner.previous;
		},
	};
}
