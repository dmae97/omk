import { getCapabilities, hyperlink } from "../terminal-image.ts";

export interface MarkdownLinkTheme {
	link: (text: string) => string;
	linkUrl: (text: string) => string;
	underline: (text: string) => string;
	/** Resolve link and image destinations for the host; undefined leaves plain text. */
	resolveLink?: (href: string) => string | undefined;
	/** Opt in to linking existing inline-code paths without interpreting arbitrary code as a URL. */
	resolveFileLink?: (text: string) => string | undefined;
}

export function renderMarkdownLink(
	token: { text: string; href: string },
	label: string,
	theme: MarkdownLinkTheme,
): string {
	const styled = theme.link(theme.underline(label));
	const href = theme.resolveLink ? theme.resolveLink(token.href) : token.href;
	if (!href || /[\x00-\x1f\x7f]/.test(href)) return styled;
	if (getCapabilities().hyperlinks) return hyperlink(styled, href);
	const comparison = href.startsWith("mailto:") ? href.slice(7) : href;
	return token.text === href || token.text === comparison ? styled : styled + theme.linkUrl(` (${href})`);
}

export function renderMarkdownCodeLink(styled: string, text: string, theme?: MarkdownLinkTheme): string {
	if (!theme) return styled;
	const href = theme.resolveFileLink?.(text);
	if (!href || /[\x00-\x1f\x7f]/.test(href)) return styled;
	return getCapabilities().hyperlinks ? hyperlink(styled, href) : styled + theme.linkUrl(` (${href})`);
}
