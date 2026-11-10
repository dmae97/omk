export function parseSse(text: string): { chunks: any[]; done: boolean; comments: number; lines: string[] } {
	const lines = text.split("\n");
	const chunks: any[] = [];
	let done = false;
	let comments = 0;
	for (const l of lines) {
		if (l.startsWith("data:")) {
			const p = l.slice(5).trim();
			if (p === "[DONE]") done = true;
			else chunks.push(JSON.parse(p));
		} else if (l.startsWith(":")) comments++;
	}
	return { chunks, done, comments, lines };
}

export function usageOf(chunks: any[]): any {
	return chunks.map((c) => c.usage).filter(Boolean).at(-1);
}
