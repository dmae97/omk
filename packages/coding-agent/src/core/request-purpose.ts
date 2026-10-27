/**
 * Side-channel purpose label for one logical request (spec 103 §2.2a).
 *
 * The label is attached to the caller's options object in a WeakMap, so it is
 * never serialized into provider options and never changes request bytes. An
 * untagged request keeps today's trace (`purpose: "unknown"`).
 */
import type { RequestPurpose } from "./request-trace-metadata.ts";

const purposes = new WeakMap<object, RequestPurpose>();

export function tagRequestPurpose<T extends object>(options: T, purpose: RequestPurpose): T {
	purposes.set(options, purpose);
	return options;
}

export function requestPurposeOf(options: object | undefined): RequestPurpose | undefined {
	return options ? purposes.get(options) : undefined;
}
