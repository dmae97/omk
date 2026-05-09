/**
 * Screenshot store — cross-platform clipboard image reader with safe project-relative paths.
 *
 * All images are saved under .omk/screenshots/YYYY-MM-DD/ so they stay
 * gitignored and organized by date.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync, readdirSync, statSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { getProjectRoot } from "./fs.js";

export const SCREENSHOT_DIR = ".omk/screenshots";
export const MAX_SIZE_BYTES = 20 * 1024 * 1024;
const CLIPBOARD_TIMEOUT_MS = 5000;
const CLIPBOARD_MAX_BUFFER_BYTES = MAX_SIZE_BYTES * 2;

export interface ScreenshotResult {
  ok: boolean;
  path?: string;
  relativePath?: string;
  error?: string;
}

export interface PasteScreenshotOptions {
  platform?: NodeJS.Platform | string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  procVersion?: string;
}

const IMAGE_MAGIC = new Map<string, number[]>([
  ["png", [0x89, 0x50, 0x4e, 0x47]],
  ["jpg", [0xff, 0xd8, 0xff]],
  ["webp", [0x52, 0x49, 0x46, 0x46]], // RIFF
  ["gif", [0x47, 0x49, 0x46, 0x38]], // GIF8
]);

export function validateMagicBytes(buf: Buffer): { ok: boolean; ext: string } {
  for (const [ext, magic] of IMAGE_MAGIC) {
    if (buf.length >= magic.length && magic.every((b, i) => buf[i] === b)) {
      return { ok: true, ext };
    }
  }
  return { ok: false, ext: "" };
}

function generateScreenshotPath(projectRoot: string, ext: string): { fullPath: string; relativePath: string } {
  const now = new Date();
  const dateDir = now.toISOString().slice(0, 10);
  const timestamp = now.toISOString().replace(/[:.]/g, "").slice(0, 15);
  const hash = createHash("sha256").update(`${Date.now()}-${Math.random()}`).digest("hex").slice(0, 8);
  const fileName = `screenshot-${timestamp}-${hash}.${ext}`;
  const dir = join(projectRoot, SCREENSHOT_DIR, dateDir);
  mkdirSync(dir, { recursive: true });
  const fullPath = join(dir, fileName);
  const relativePath = relative(projectRoot, fullPath).replace(/\\/g, "/");
  return { fullPath, relativePath };
}

function saveScreenshot(data: Buffer, ext: string, projectRoot: string): ScreenshotResult {
  if (data.length > MAX_SIZE_BYTES) {
    return { ok: false, error: `Image exceeds ${MAX_SIZE_BYTES / (1024 * 1024)} MB limit` };
  }
  const magic = validateMagicBytes(data);
  if (!magic.ok) {
    return { ok: false, error: "Clipboard does not contain a valid image (PNG/JPG/WebP/GIF)" };
  }
  const { fullPath, relativePath } = generateScreenshotPath(projectRoot, magic.ext);
  writeFileSync(fullPath, data);
  return { ok: true, path: fullPath, relativePath: `./${relativePath}` };
}

// ---------------------------------------------------------------------------
// Windows provider
// ---------------------------------------------------------------------------

export function buildWindowsClipboardImageScript(): string {
  return `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Emit-Bytes([byte[]]$Bytes) {
  if ($null -eq $Bytes -or $Bytes.Length -eq 0) { exit 1 }
  [Console]::Out.Write([Convert]::ToBase64String($Bytes))
  exit 0
}

$data = [System.Windows.Forms.Clipboard]::GetDataObject()
if ($null -ne $data) {
  foreach ($format in @('PNG', 'image/png')) {
    if ($data.GetDataPresent($format)) {
      $raw = $data.GetData($format)
      if ($raw -is [System.IO.MemoryStream]) { Emit-Bytes $raw.ToArray() }
      if ($raw -is [byte[]]) { Emit-Bytes $raw }
    }
  }

  if ($data.GetDataPresent([System.Windows.Forms.DataFormats]::FileDrop)) {
    $files = [string[]]$data.GetData([System.Windows.Forms.DataFormats]::FileDrop)
    foreach ($file in $files) {
      if ($file -match '[.](png|jpg|jpeg|webp|gif)$' -and [System.IO.File]::Exists($file)) {
        Emit-Bytes ([System.IO.File]::ReadAllBytes($file))
      }
    }
  }
}

if ([System.Windows.Forms.Clipboard]::ContainsImage()) {
  $img = [System.Windows.Forms.Clipboard]::GetImage()
  if ($null -ne $img) {
    $ms = New-Object System.IO.MemoryStream
    try {
      $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
      Emit-Bytes $ms.ToArray()
    } finally {
      $ms.Dispose()
      $img.Dispose()
    }
  }
}

exit 1
`;
}

export function getWindowsClipboardImageCommands(env: NodeJS.ProcessEnv = process.env): string[] {
  const explicit = env.OMK_WINDOWS_POWERSHELL_PATH?.trim();
  const candidates = explicit
    ? [explicit]
    : [
        "powershell.exe",
        "pwsh.exe",
        "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
      ];
  return [...new Set(candidates.filter((cmd) => cmd.length > 0))];
}

function execWindowsClipboardScript(command: string, options: PasteScreenshotOptions = {}): string {
  const encoded = Buffer.from(buildWindowsClipboardImageScript(), "utf16le").toString("base64");
  return execFileSync(command, ["-NoProfile", "-STA", "-EncodedCommand", encoded], {
    encoding: "utf-8",
    timeout: options.timeoutMs ?? CLIPBOARD_TIMEOUT_MS,
    maxBuffer: CLIPBOARD_MAX_BUFFER_BYTES,
    windowsHide: true,
    env: options.env ? { ...process.env, ...options.env } : process.env,
  }).trim();
}

function readWindowsClipboard(projectRoot: string, options: PasteScreenshotOptions = {}): ScreenshotResult {
  let lastError = "No image in clipboard";
  for (const command of getWindowsClipboardImageCommands(options.env)) {
    try {
      const b64 = execWindowsClipboardScript(command, options);
      const buf = Buffer.from(b64, "base64");
      if (buf.length === 0) {
        lastError = "No image in clipboard";
        continue;
      }
      return saveScreenshot(buf, "png", projectRoot);
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  return { ok: false, error: lastError };
}

// ---------------------------------------------------------------------------
// macOS provider
// ---------------------------------------------------------------------------

function readMacOSClipboard(projectRoot: string, options: PasteScreenshotOptions = {}): ScreenshotResult {
  // Try pngpaste first (more reliable)
  try {
    const tmpPath = join(tmpdir(), `omk-screenshot-${Date.now()}.png`);
    execFileSync("pngpaste", [tmpPath], { timeout: options.timeoutMs ?? CLIPBOARD_TIMEOUT_MS });
    const buf = readFileSync(tmpPath);
    if (buf.length === 0) {
      return { ok: false, error: "No image in clipboard" };
    }
    return saveScreenshot(buf, "png", projectRoot);
  } catch {
    // Fallback to osascript
    try {
      const tmpPath = join(tmpdir(), `omk-screenshot-${Date.now()}.png`);
      const script = `
        set pngData to the clipboard as «class PNGf»
        set f to open for access POSIX file "${tmpPath}" with write permission
        write pngData to f
        close access f
      `;
      execFileSync("osascript", ["-e", script], { encoding: "utf-8", timeout: options.timeoutMs ?? CLIPBOARD_TIMEOUT_MS });
      const buf = readFileSync(tmpPath);
      if (buf.length === 0) {
        return { ok: false, error: "No image in clipboard" };
      }
      return saveScreenshot(buf, "png", projectRoot);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}

// ---------------------------------------------------------------------------
// Linux / WSL provider
// ---------------------------------------------------------------------------

export function isWslEnvironment(env: NodeJS.ProcessEnv = process.env, procVersion?: string): boolean {
  if (env.WSL_DISTRO_NAME || env.WSLENV || env.WSL_INTEROP) return true;
  const version = procVersion ?? (() => {
    try {
      return readFileSync("/proc/version", "utf-8");
    } catch {
      return "";
    }
  })();
  return /microsoft|wsl/i.test(version);
}

function readLinuxClipboard(projectRoot: string, options: PasteScreenshotOptions = {}): ScreenshotResult {
  let wslError: string | undefined;
  if (isWslEnvironment(options.env, options.procVersion)) {
    const windowsResult = readWindowsClipboard(projectRoot, options);
    if (windowsResult.ok) return windowsResult;
    wslError = windowsResult.error;
  }

  try {
    let buf: Buffer;
    try {
      buf = execFileSync("wl-paste", ["--type", "image/png"], {
        timeout: options.timeoutMs ?? CLIPBOARD_TIMEOUT_MS,
        encoding: "buffer",
        maxBuffer: CLIPBOARD_MAX_BUFFER_BYTES,
      });
    } catch {
      buf = execFileSync("xclip", ["-selection", "clipboard", "-t", "image/png", "-o"], {
        timeout: options.timeoutMs ?? CLIPBOARD_TIMEOUT_MS,
        encoding: "buffer",
        maxBuffer: CLIPBOARD_MAX_BUFFER_BYTES,
      });
    }
    if (buf.length === 0) {
      return { ok: false, error: "No image in clipboard" };
    }
    return saveScreenshot(buf, "png", projectRoot);
  } catch (e) {
    const linuxError = e instanceof Error ? e.message : String(e);
    const error = wslError ? `Windows clipboard unavailable (${wslError}); Linux clipboard unavailable (${linuxError})` : linuxError;
    return { ok: false, error };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function pasteScreenshot(projectRoot?: string, options: PasteScreenshotOptions = {}): ScreenshotResult {
  const root = projectRoot ?? getProjectRoot();
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    return readWindowsClipboard(root, options);
  }
  if (platform === "darwin") {
    return readMacOSClipboard(root, options);
  }
  return readLinuxClipboard(root, options);
}

export function getScreenshotDir(projectRoot?: string): string {
  const root = projectRoot ?? getProjectRoot();
  return join(root, SCREENSHOT_DIR);
}

export interface ScreenshotEntry {
  relativePath: string;
  fullPath: string;
  size: number;
  mtimeMs: number;
}

export function listScreenshots(projectRoot?: string): ScreenshotEntry[] {
  const root = projectRoot ?? getProjectRoot();
  const base = join(root, SCREENSHOT_DIR);
  if (!existsSync(base)) return [];

  const entries: ScreenshotEntry[] = [];
  for (const dateDir of readdirSync(base)) {
    const datePath = join(base, dateDir);
    const stat = statSync(datePath, { throwIfNoEntry: false });
    if (!stat || !stat.isDirectory()) continue;
    for (const file of readdirSync(datePath)) {
      const fullPath = join(datePath, file);
      const s = statSync(fullPath, { throwIfNoEntry: false });
      if (!s || !s.isFile()) continue;
      entries.push({
        relativePath: relative(root, fullPath).replace(/\\/g, "/"),
        fullPath,
        size: s.size,
        mtimeMs: s.mtimeMs,
      });
    }
  }
  return entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export interface CleanResult {
  deleted: string[];
  skipped: string[];
}

export function cleanScreenshots(days: number, dryRun: boolean, projectRoot?: string): CleanResult {
  const root = projectRoot ?? getProjectRoot();
  const base = join(root, SCREENSHOT_DIR);
  if (!existsSync(base)) return { deleted: [], skipped: [] };

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const result: CleanResult = { deleted: [], skipped: [] };

  for (const dateDir of readdirSync(base)) {
    const datePath = join(base, dateDir);
    const stat = statSync(datePath, { throwIfNoEntry: false });
    if (!stat || !stat.isDirectory()) continue;

    for (const file of readdirSync(datePath)) {
      const fullPath = join(datePath, file);
      const s = statSync(fullPath, { throwIfNoEntry: false });
      if (!s || !s.isFile()) continue;

      if (s.mtimeMs < cutoff) {
        if (!dryRun) {
          rmSync(fullPath);
        }
        result.deleted.push(relative(root, fullPath).replace(/\\/g, "/"));
      } else {
        result.skipped.push(relative(root, fullPath).replace(/\\/g, "/"));
      }
    }

    // Remove empty date directories
    if (!dryRun && readdirSync(datePath).length === 0) {
      rmSync(datePath, { recursive: true });
    }
  }

  return result;
}
