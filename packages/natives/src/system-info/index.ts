/**
 * System information powered by native bindings.
 */

import { native } from "../native";

export interface SystemInfo {
	distro?: string;
	kernel?: string;
	cpu?: string;
	disk?: string;
}

export function getSystemInfo(): SystemInfo {
	return native.getSystemInfo();
}
