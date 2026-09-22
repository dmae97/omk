/** Fired when a session is started, loaded, or reloaded. */
export interface SessionStartEvent {
	type: "session_start";
	reason: "startup" | "reload" | "new" | "resume" | "fork";
	/** Previously active file for new, resume and fork. */
	previousSessionFile?: string;
}

/** Fired when the current session metadata changes. */
export interface SessionInfoChangedEvent {
	type: "session_info_changed";
	/** Undefined when the normalized name is cleared. */
	name: string | undefined;
}
