/**
 * Types for process management.
 */

export {};

declare module "../bindings" {
	/** Native process-management bindings implemented in pi-natives. */
	interface NativeBindings {
		/**
		 * Kill a process and all its descendants using platform-native APIs.
		 * @param pid Root process id.
		 * @param signal Signal number (ignored on Windows).
		 * @returns Number of processes successfully killed.
		 */
		killTree(pid: number, signal: number): number;
		/**
		 * List all descendant PIDs of a process (children, grandchildren, etc.).
		 * @param pid Root process id.
		 * @returns Empty array when the process has no children or doesn't exist.
		 */
		listDescendants(pid: number): number[];
	}
}
