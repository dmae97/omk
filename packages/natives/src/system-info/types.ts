/**
 * Types for system information.
 */

/** Snapshot of system details reported by native probes. */
export interface SystemInfo {
	/** Operating system name (e.g. Linux, macOS, Windows). */
	os: string;
	/** CPU architecture (e.g. x64, arm64). */
	arch: string;
	/** Linux distro or detailed OS name when available. */
	distro?: string;
	/** Kernel version string, if the OS reports one. */
	kernel?: string;
	/** Hostname of the current machine. */
	hostname?: string;
	/** Active login shell, when detected. */
	shell?: string;
	/** Terminal program identifier, when available. */
	terminal?: string;
	/** Desktop environment name, if reported. */
	de?: string;
	/** Window manager name, if reported. */
	wm?: string;
	/** Primary CPU brand/model string. */
	cpu?: string;
	/** Primary GPU identifier, when available. */
	gpu?: string;
	/** System memory summary (used/total). */
	memory?: string;
	/** Disk usage summary (used/total) for primary mount. */
	disk?: string;
}

declare module "../bindings" {
	/** Native bindings that expose system info collection. */
	interface NativeBindings {
		/** Get system information (OS, CPU, memory, and disk summaries). */
		getSystemInfo(): SystemInfo;
	}
}
