import { truncateToWidth } from "./utils.ts";

export const OMK_BRAND_LABEL = "OMK://CONTROL";

export type OmkStatusKind = "route" | "verify" | "loop" | "control";

export interface OmkStatusSnapshot {
	route: string;
	verify: string;
	loop: string;
	control: string;
}

export interface OmkStatusSegment {
	kind: OmkStatusKind;
	label: string;
	value: string;
}

export function getOmkStatusSegments(snapshot: Partial<OmkStatusSnapshot> = {}): OmkStatusSegment[] {
	return [
		{ kind: "route", label: "ROUTE", value: snapshot.route ?? "ready" },
		{ kind: "verify", label: "VERIFY", value: snapshot.verify ?? "evidence" },
		{ kind: "loop", label: "LOOP", value: snapshot.loop ?? "stable" },
		{ kind: "control", label: "CONTROL", value: snapshot.control ?? "operator" },
	];
}

export function formatOmkStatusLine(
	snapshot: Partial<OmkStatusSnapshot> = {},
	width = Number.POSITIVE_INFINITY,
): string {
	const body = getOmkStatusSegments(snapshot)
		.map((segment) => `${segment.label}:${segment.value}`)
		.join(" · ");
	const line = `${OMK_BRAND_LABEL} ${body}`;
	return Number.isFinite(width) ? truncateToWidth(line, Math.max(0, width), "…") : line;
}
