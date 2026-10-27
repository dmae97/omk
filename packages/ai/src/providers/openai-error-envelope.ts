/**
 * Normalize WorkBuddy's `{ code, msg, requestId }` refusals for the OpenAI SDK,
 * which otherwise reports "<status> status code (no body)". Used only by WorkBuddy;
 * status and headers survive, and successful or unrecognized responses pass through.
 */
export async function fetchWithProviderErrorEnvelope(
	input: string | URL | Request,
	init?: RequestInit,
): Promise<Response> {
	const response = await globalThis.fetch(input, init);
	if (response.ok) return response;
	let text: string;
	try {
		text = await response.clone().text();
	} catch {
		return response; // unreadable body: the SDK reports it as before
	}
	const message = providerEnvelopeMessage(text);
	if (message === undefined) return response;
	await response.body?.cancel();
	return new Response(JSON.stringify({ error: { message } }), {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
}

function providerEnvelopeMessage(text: string): string | undefined {
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (typeof body !== "object" || body === null || "error" in body) return undefined;
	const { msg, code, requestId } = body as Record<string, unknown>;
	if (typeof msg !== "string" || msg.trim() === "") return undefined;
	const details: string[] = [];
	if (typeof code === "number" || (typeof code === "string" && code !== "")) details.push(`code ${code}`);
	if (typeof requestId === "string" && requestId !== "") details.push(`request ${requestId}`);
	return details.length > 0 ? `${msg} (${details.join(", ")})` : msg;
}
