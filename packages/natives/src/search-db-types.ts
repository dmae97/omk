import type { NativeBindings } from "./bindings";

/** Shared native search database instance. */
export interface SearchDb {}

/** Native SearchDb constructor. */
export interface SearchDbConstructor {
	new (path: string): SearchDb;
}

declare module "./bindings" {
	interface NativeBindings {
		/** Stateful shared search DB constructor. */
		SearchDb: SearchDbConstructor;
	}
}

export type NativeBindingsWithSearchDb = NativeBindings & {
	SearchDb: SearchDbConstructor;
};
