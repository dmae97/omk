/** Install a one-shot input callback only after buffered startup prompts have drained. */
export async function waitForInteractiveInput<T>(
	pending: T[],
	setCallback: (callback: ((payload: T) => void) | undefined) => void,
): Promise<T> {
	const queued = pending.shift();
	if (queued !== undefined) return queued;
	return new Promise((resolve) => {
		setCallback((payload) => {
			setCallback(undefined);
			resolve(payload);
		});
	});
}
