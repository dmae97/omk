const CANCEL_MESSAGE = "Login cancelled";
const TIMEOUT_MESSAGE = "Device flow timed out";
const SLOW_DOWN_TIMEOUT_MESSAGE =
	"Device flow timed out after one or more slow_down responses. This is often caused by clock drift in WSL or VM environments. Please sync or restart the VM clock and try again.";
const MINIMUM_INTERVAL_MS = 1000;
// RFC 8628 section 3.2: if the authorization server omits `interval`, the client must use 5 seconds.
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
// RFC 8628 section 3.5: `slow_down` means the polling interval must increase by 5 seconds.
const SLOW_DOWN_INTERVAL_INCREMENT_MS = 5000;

export type OAuthDeviceCodePollResult =
	| { status: "pending" }
	| { status: "slow_down" }
	| { status: "complete"; accessToken: string }
	| { status: "failed"; message: string };

export type OAuthDeviceCodePollOptions = {
	intervalSeconds?: number;
	expiresInSeconds?: number;
	poll: () => Promise<OAuthDeviceCodePollResult>;
	signal?: AbortSignal;
};

function abortableSleep(ms: number, signal: AbortSignal | undefined, cancelMessage: string): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error(cancelMessage));
			return;
		}

		const onAbort = () => {
			clearTimeout(timeout);
			reject(new Error(cancelMessage));
		};
		const timeout = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);

		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

export async function pollOAuthDeviceCodeFlow(options: OAuthDeviceCodePollOptions): Promise<string> {
	const deadline =
		typeof options.expiresInSeconds === "number"
			? Date.now() + options.expiresInSeconds * 1000
			: Number.POSITIVE_INFINITY;
	let intervalMs = Math.max(
		MINIMUM_INTERVAL_MS,
		Math.floor((options.intervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS) * 1000),
	);

	let slowDownResponses = 0;
	while (Date.now() < deadline) {
		if (options.signal?.aborted) {
			throw new Error(CANCEL_MESSAGE);
		}

		const remainingMs = deadline - Date.now();
		await abortableSleep(Math.min(intervalMs, remainingMs), options.signal, CANCEL_MESSAGE);

		const result = await options.poll();
		if (result.status === "complete") {
			return result.accessToken;
		}
		if (result.status === "pending") {
			continue;
		}
		if (result.status === "slow_down") {
			slowDownResponses += 1;
			// RFC 8628 section 3.5: apply this increase to this and all subsequent requests.
			intervalMs = Math.max(MINIMUM_INTERVAL_MS, intervalMs + SLOW_DOWN_INTERVAL_INCREMENT_MS);
			continue;
		}
		throw new Error(result.message);
	}

	throw new Error(slowDownResponses > 0 ? SLOW_DOWN_TIMEOUT_MESSAGE : TIMEOUT_MESSAGE);
}
