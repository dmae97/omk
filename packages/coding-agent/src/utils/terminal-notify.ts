export type NotificationProtocol = "bell" | "osc99" | "osc9";

export function detectNotificationProtocol(): NotificationProtocol {
	const termProgram = process.env.TERM_PROGRAM?.toLowerCase() || "";
	const term = process.env.TERM?.toLowerCase() || "";

	if (process.env.KITTY_WINDOW_ID || termProgram === "kitty") {
		return "osc99";
	}

	if (process.env.GHOSTTY_RESOURCES_DIR || termProgram === "ghostty" || term.includes("ghostty")) {
		return "osc9";
	}

	if (process.env.WEZTERM_PANE || termProgram === "wezterm") {
		return "osc9";
	}

	if (process.env.ITERM_SESSION_ID || termProgram === "iterm.app") {
		return "osc9";
	}

	return "bell";
}

export function sendNotification(protocol: NotificationProtocol, message: string): void {
	const payload =
		protocol === "osc99" ? `\x1b]99;;${message}\x1b\\` : protocol === "osc9" ? `\x1b]9;${message}\x1b\\` : "\x07";

	process.stdout.write(payload);
}

export function isNotificationSuppressed(): boolean {
	const value = process.env.OMP_NOTIFICATIONS?.trim().toLowerCase();
	if (!value) return false;
	return value === "off" || value === "0" || value === "false";
}
