/** Keep decorative imported harness markers out of OMK display; source metadata stays unchanged. */
export function formatResourceDescription(description: string | undefined, sourceTag?: string): string | undefined {
	let text = description;
	if (description) {
		const marker = /^\[(OMX|OMO)\]\s*/.exec(description);
		if (marker) {
			const body = description.slice(marker[0].length);
			text = body || "OMK resource";
		}
	}
	if (!sourceTag) return text;
	return text ? `[${sourceTag}] ${text}` : `[${sourceTag}]`;
}
