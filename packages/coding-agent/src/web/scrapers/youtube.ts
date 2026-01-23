import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cspawn } from "@oh-my-pi/pi-utils";
import { nanoid } from "nanoid";
import { throwIfAborted } from "$c/tools/tool-errors";
import { ensureTool } from "$c/utils/tools-manager";
import type { RenderResult, SpecialHandler } from "./types";
import { finalizeOutput } from "./types";

/**
 * Execute a command and return stdout
 */
async function exec(
	cmd: string,
	args: string[],
	options?: { timeout?: number; input?: string | Buffer; signal?: AbortSignal },
): Promise<{ stdout: string; stderr: string; ok: boolean; exitCode: number | null }> {
	const proc = cspawn([cmd, ...args], {
		signal: options?.signal,
		timeout: options?.timeout,
		stdin: options?.input ? Buffer.from(options.input) : undefined,
	});

	const [stdout, stderr, exitResult] = await Promise.all([
		proc.stdout.text(),
		proc.stderr.text(),
		proc.exited.then(() => proc.exitCode ?? 0),
	]);

	return {
		stdout,
		stderr,
		ok: exitResult === 0,
		exitCode: exitResult,
	};
}

interface YouTubeUrl {
	videoId: string;
	playlistId?: string;
}

/**
 * Parse YouTube URL into components
 */
function parseYouTubeUrl(url: string): YouTubeUrl | null {
	try {
		const parsed = new URL(url);
		const hostname = parsed.hostname.replace(/^www\./, "");

		// youtube.com/watch?v=VIDEO_ID
		if ((hostname === "youtube.com" || hostname === "m.youtube.com") && parsed.pathname === "/watch") {
			const videoId = parsed.searchParams.get("v");
			const playlistId = parsed.searchParams.get("list") || undefined;
			if (videoId) return { videoId, playlistId };
		}

		// youtube.com/v/VIDEO_ID or youtube.com/embed/VIDEO_ID
		if (hostname === "youtube.com" || hostname === "m.youtube.com") {
			const match = parsed.pathname.match(/^\/(v|embed)\/([a-zA-Z0-9_-]{11})/);
			if (match) return { videoId: match[2] };
		}

		// youtu.be/VIDEO_ID
		if (hostname === "youtu.be") {
			const videoId = parsed.pathname.slice(1).split("/")[0];
			if (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
				return { videoId };
			}
		}

		// youtube.com/shorts/VIDEO_ID
		if (hostname === "youtube.com" && parsed.pathname.startsWith("/shorts/")) {
			const videoId = parsed.pathname.replace("/shorts/", "").split("/")[0];
			if (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
				return { videoId };
			}
		}
	} catch {}

	return null;
}

/**
 * Clean VTT subtitle content to plain text
 */
function cleanVttToText(vtt: string): string {
	const lines = vtt.split("\n");
	const textLines: string[] = [];
	let lastLine = "";

	for (const line of lines) {
		// Skip WEBVTT header, timestamps, and metadata
		if (
			line.startsWith("WEBVTT") ||
			line.startsWith("Kind:") ||
			line.startsWith("Language:") ||
			line.match(/^\d{2}:\d{2}/) || // Timestamp lines
			line.match(/^[a-f0-9-]{36}$/) || // UUID cue identifiers
			line.match(/^\d+$/) || // Numeric cue identifiers
			line.includes("-->") ||
			line.trim() === ""
		) {
			continue;
		}

		// Remove inline timestamp tags like <00:00:01.520>
		let cleaned = line.replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, "");
		// Remove other VTT tags like <c> </c>
		cleaned = cleaned.replace(/<\/?[^>]+>/g, "");
		cleaned = cleaned.trim();

		// Skip duplicates (auto-generated captions often repeat)
		if (cleaned && cleaned !== lastLine) {
			textLines.push(cleaned);
			lastLine = cleaned;
		}
	}

	return textLines.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Format duration from seconds to human readable
 */
function formatDuration(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
	return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Handle YouTube URLs - fetch metadata and transcript
 */
export const handleYouTube: SpecialHandler = async (
	url: string,
	timeout: number,
	signal?: AbortSignal,
): Promise<RenderResult | null> => {
	throwIfAborted(signal);
	const yt = parseYouTubeUrl(url);
	if (!yt) return null;

	// Ensure yt-dlp is available (auto-download if missing)
	const ytdlp = await ensureTool("yt-dlp", true);
	throwIfAborted(signal);
	if (!ytdlp) {
		return {
			url,
			finalUrl: url,
			contentType: "text/plain",
			method: "youtube-no-ytdlp",
			content: "YouTube video detected but yt-dlp could not be installed.",
			fetchedAt: new Date().toISOString(),
			truncated: false,
			notes: ["yt-dlp installation failed"],
		};
	}

	const fetchedAt = new Date().toISOString();
	const notes: string[] = [];
	const videoUrl = `https://www.youtube.com/watch?v=${yt.videoId}`;

	// Fetch video metadata
	throwIfAborted(signal);
	const metaResult = await exec(
		ytdlp,
		["--dump-json", "--no-warnings", "--no-playlist", "--skip-download", videoUrl],
		{
			timeout: timeout * 1000,
			signal,
		},
	);
	throwIfAborted(signal);

	let title = "YouTube Video";
	let channel = "";
	let description = "";
	let duration = 0;
	let uploadDate = "";
	let viewCount = 0;

	if (metaResult.ok && metaResult.stdout.trim()) {
		try {
			const meta = JSON.parse(metaResult.stdout) as {
				title?: string;
				channel?: string;
				uploader?: string;
				description?: string;
				duration?: number;
				upload_date?: string;
				view_count?: number;
			};
			title = meta.title || title;
			channel = meta.channel || meta.uploader || "";
			description = meta.description || "";
			duration = meta.duration || 0;
			uploadDate = meta.upload_date || "";
			viewCount = meta.view_count || 0;
		} catch {}
	}

	// Format upload date
	let formattedDate = "";
	if (uploadDate && uploadDate.length === 8) {
		formattedDate = `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(6, 8)}`;
	}

	// Try to fetch subtitles
	let transcript = "";
	let transcriptSource = "";

	// First, list available subtitles
	throwIfAborted(signal);
	const listResult = await exec(
		ytdlp,
		["--list-subs", "--no-warnings", "--no-playlist", "--skip-download", videoUrl],
		{
			timeout: timeout * 1000,
			signal,
		},
	);
	throwIfAborted(signal);

	const hasManualSubs = listResult.stdout.includes("[info] Available subtitles");
	const hasAutoSubs = listResult.stdout.includes("[info] Available automatic captions");

	// Create temp directory for subtitle download
	const tmpDir = tmpdir();
	const tmpBase = path.join(tmpDir, `yt-${yt.videoId}-${nanoid()}`);

	try {
		// Try manual subtitles first (English preferred)
		if (hasManualSubs) {
			throwIfAborted(signal);
			const subResult = await exec(
				ytdlp,
				[
					"--write-sub",
					"--sub-lang",
					"en,en-US,en-GB",
					"--sub-format",
					"vtt",
					"--skip-download",
					"--no-warnings",
					"--no-playlist",
					"-o",
					tmpBase,
					videoUrl,
				],
				{ timeout: timeout * 1000, signal },
			);

			if (subResult.ok) {
				// Find the downloaded subtitle file using glob
				throwIfAborted(signal);
				const subFiles = await Array.fromAsync(new Bun.Glob(`${tmpBase}*.vtt`).scan({ absolute: true }));
				if (subFiles.length > 0) {
					throwIfAborted(signal);
					const vttContent = await Bun.file(subFiles[0]).text();
					transcript = cleanVttToText(vttContent);
					transcriptSource = "manual";
					notes.push("Using manual subtitles");
				}
			}
		}

		// Fall back to auto-generated captions
		if (!transcript && hasAutoSubs) {
			throwIfAborted(signal);
			const autoResult = await exec(
				ytdlp,
				[
					"--write-auto-sub",
					"--sub-lang",
					"en,en-US,en-GB",
					"--sub-format",
					"vtt",
					"--skip-download",
					"--no-warnings",
					"--no-playlist",
					"-o",
					tmpBase,
					videoUrl,
				],
				{ timeout: timeout * 1000, signal },
			);

			if (autoResult.ok) {
				throwIfAborted(signal);
				const subFiles = await Array.fromAsync(new Bun.Glob(`${tmpBase}*.vtt`).scan({ absolute: true }));
				if (subFiles.length > 0) {
					throwIfAborted(signal);
					const vttContent = await Bun.file(subFiles[0]).text();
					transcript = cleanVttToText(vttContent);
					transcriptSource = "auto-generated";
					notes.push("Using auto-generated captions");
				}
			}
		}
	} finally {
		// Cleanup temp files using sync unlink to avoid leaving handles open
		try {
			const tmpFiles = await Array.fromAsync(new Bun.Glob(`${tmpBase}*`).scan({ absolute: true }));
			for (const f of tmpFiles) {
				try {
					unlinkSync(f);
				} catch {}
			}
		} catch {}
	}

	// Build markdown output
	let md = `# ${title}\n\n`;
	if (channel) md += `**Channel:** ${channel}\n`;
	if (formattedDate) md += `**Uploaded:** ${formattedDate}\n`;
	if (duration > 0) md += `**Duration:** ${formatDuration(duration)}\n`;
	if (viewCount > 0) {
		const formatted =
			viewCount >= 1_000_000
				? `${(viewCount / 1_000_000).toFixed(1)}M`
				: viewCount >= 1_000
					? `${(viewCount / 1_000).toFixed(1)}K`
					: String(viewCount);
		md += `**Views:** ${formatted}\n`;
	}
	md += `**Video ID:** ${yt.videoId}\n\n`;

	if (description) {
		// Truncate long descriptions
		const descPreview = description.length > 1000 ? `${description.slice(0, 1000)}...` : description;
		md += `---\n\n## Description\n\n${descPreview}\n\n`;
	}

	if (transcript) {
		md += `---\n\n## Transcript (${transcriptSource})\n\n${transcript}\n`;
	} else {
		notes.push("No subtitles/captions available");
		md += `---\n\n*No transcript available for this video.*\n`;
	}

	const output = finalizeOutput(md);
	return {
		url,
		finalUrl: videoUrl,
		contentType: "text/markdown",
		method: "youtube",
		content: output.content,
		fetchedAt,
		truncated: output.truncated,
		notes,
	};
};
