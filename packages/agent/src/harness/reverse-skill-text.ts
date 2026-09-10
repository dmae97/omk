export function normalizeReverseSkillText(text: string | undefined): string {
	return (text ?? "")
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[\u2018\u2019]/g, "'")
		.replace(/[\u201c\u201d]/g, '"')
		.replace(/[_./\\:-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function normalizeReverseSkillName(name: string): string {
	const normalized = normalizeReverseSkillText(name)
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 64)
		.replace(/-$/g, "");
	return normalized || "reverse-skill";
}
