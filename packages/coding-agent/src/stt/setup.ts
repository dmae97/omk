import { detectRecordingTools } from "./recorder";
import { resolvePython } from "./transcriber";

const isWindows = process.platform === "win32";

export interface STTDependencyStatus {
	recorder: { available: boolean; tool: string | null; installHint: string };
	python: { available: boolean; path: string | null; installHint: string };
	whisper: { available: boolean; installHint: string };
}

export async function checkDependencies(): Promise<STTDependencyStatus> {
	const recorderTools = detectRecordingTools();
	const recorderHint = isWindows
		? "PowerShell fallback available. For better quality: install SoX or FFmpeg."
		: "Install SoX: sudo apt install sox, or FFmpeg: sudo apt install ffmpeg";

	const pythonCmd = resolvePython();
	const pythonHint = "Install Python 3.8+ from https://python.org";

	let whisperAvailable = false;
	if (pythonCmd) {
		const check = Bun.spawnSync([pythonCmd, "-c", "import whisper"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		whisperAvailable = check.exitCode === 0;
	}
	const whisperHint = "Run /stt setup to auto-install, or: pip install openai-whisper";

	return {
		recorder: { available: recorderTools.length > 0, tool: recorderTools[0] ?? null, installHint: recorderHint },
		python: { available: pythonCmd !== null, path: pythonCmd, installHint: pythonHint },
		whisper: { available: whisperAvailable, installHint: whisperHint },
	};
}

export function formatDependencyStatus(status: STTDependencyStatus): string {
	const lines: string[] = ["STT Dependencies:"];
	const check = (ok: boolean) => (ok ? "[ok]" : "[missing]");

	lines.push(`  Recorder: ${check(status.recorder.available)} ${status.recorder.tool ?? "none"}`);
	if (!status.recorder.available) lines.push(`    -> ${status.recorder.installHint}`);

	lines.push(`  Python:   ${check(status.python.available)} ${status.python.path ?? "none"}`);
	if (!status.python.available) lines.push(`    -> ${status.python.installHint}`);

	lines.push(`  Whisper:  ${check(status.whisper.available)}`);
	if (!status.whisper.available) lines.push(`    -> ${status.whisper.installHint}`);

	return lines.join("\n");
}
