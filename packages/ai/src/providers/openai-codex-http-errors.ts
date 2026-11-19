export function isRetryableCodexHttpError(status: number, errorText: string): boolean {
	if (
		status === 429 &&
		/GoUsageLimitError|FreeUsageLimitError|Monthly usage limit reached|available balance|insufficient_quota|out of budget|quota exceeded|quota\s+(?:has been\s+|was\s+|is\s+)?exhaust|billing/i.test(
			errorText,
		)
	) {
		return false;
	}
	if ([429, 500, 502, 503, 504].includes(status) || (status >= 520 && status <= 527)) {
		return true;
	}
	return /rate.?limit|overloaded|service.?unavailable|upstream.?connect|connection.?refused/i.test(errorText);
}

/** HTML is a gateway response, not a provider message; never reflect its content into the transcript. */
export function parseCodexHttpError(
	raw: string,
	response: Pick<Response, "status" | "statusText" | "headers">,
): { message: string; friendlyMessage?: string } {
	const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
	if (
		contentType === "text/html" ||
		contentType === "application/xhtml+xml" ||
		/^\s*(?:<!doctype\s+html\b|<html\b)/i.test(raw)
	) {
		const ray = response.headers.get("cf-ray");
		const rayInfo = ray && /^[a-f0-9]{16,32}(?:-[a-z]{3})?$/i.test(ray) ? ` (Cloudflare Ray ID: ${ray})` : "";
		return { message: `Codex request failed (HTTP ${response.status}): received an HTML error page${rayInfo}.` };
	}

	let message = raw || response.statusText || "Request failed";
	let friendlyMessage: string | undefined;
	try {
		const parsed = JSON.parse(raw) as {
			error?: { code?: string; type?: string; message?: string; plan_type?: string; resets_at?: number };
		};
		const err = parsed?.error;
		if (err) {
			const code = err.code || err.type || "";
			if (/usage_limit_reached|usage_not_included|rate_limit_exceeded/i.test(code) || response.status === 429) {
				const plan = err.plan_type ? ` (${err.plan_type.toLowerCase()} plan)` : "";
				// wall-clock: resets_at is a Unix timestamp set by the server
				const mins = err.resets_at
					? Math.max(0, Math.round((err.resets_at * 1000 - Date.now()) / 60000))
					: undefined;
				const when = mins !== undefined ? ` Try again in ~${mins} min.` : "";
				friendlyMessage = `You have hit your ChatGPT usage limit${plan}.${when}`.trim();
			}
			message = err.message || friendlyMessage || message;
		}
	} catch {
		// Preserve non-HTML plain text errors for compatibility.
	}
	return { message, friendlyMessage };
}
