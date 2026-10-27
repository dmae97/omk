/**
 * Default-on env flags: unset or any other value = on; only an explicit opt-out
 * (`0`, `false`, `off`, case-insensitive, trimmed) turns the flag off.
 */
export function isEnvFlagOptOut(raw: string | undefined): boolean {
	if (raw === undefined) return false;
	const v = raw.trim().toLowerCase();
	return v === "0" || v === "false" || v === "off";
}

export function isDefaultOnEnvFlag(raw: string | undefined): boolean {
	return !isEnvFlagOptOut(raw);
}
