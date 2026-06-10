import { lstat, readFile } from "fs/promises";
import { extname, isAbsolute, relative, resolve } from "path";
import { readTextFile } from "./core.js";
import { getOmkPath, getProjectRootAsync } from "./paths.js";

const MAX_LOGO_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_LOGO_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

/** .omk/config.toml 에서 안전한 logo_image 경로 읽기 (상대경로는 프로젝트 루트 기준) */
export async function getOmkLogoImagePath(): Promise<string | null> {
  const configPath = getOmkPath("config.toml");
  try {
    const content = await readTextFile(configPath, "");
    const match = content.match(/^\s*logo_image\s*=\s*["']([^"']+)["']/m);
    if (!match) return null;
    const p = match[1].trim();
    const root = await getProjectRootAsync();
    const absoluteInput = isAbsolute(p) || p.startsWith("\\") || /^[A-Za-z]:/.test(p);
    if (absoluteInput && !isTrustedLocalFlag(process.env.OMK_TRUST_ABSOLUTE_LOGO_PATH)) {
      return null;
    }
    const candidate = absoluteInput ? resolve(p) : resolve(root, p);
    if (!absoluteInput && isOutsideRoot(root, candidate)) {
      return null;
    }
    return await isSafeLogoImage(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function isTrustedLocalFlag(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

function isOutsideRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === ".." || rel.startsWith(`..${"/"}`) || rel.startsWith(`..${"\\"}`) || isAbsolute(rel);
}

async function isSafeLogoImage(path: string): Promise<boolean> {
  const ext = extname(path).toLowerCase();
  if (!ALLOWED_LOGO_EXTENSIONS.has(ext)) return false;

  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > MAX_LOGO_IMAGE_BYTES) {
    return false;
  }

  const bytes = await readFile(path);
  return hasAllowedImageMagic(bytes);
}

function hasAllowedImageMagic(bytes: Uint8Array): boolean {
  return isPng(bytes) || isJpeg(bytes) || isGif(bytes) || isWebp(bytes);
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a;
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isGif(bytes: Uint8Array): boolean {
  if (bytes.length < 6) return false;
  const header = String.fromCharCode(...bytes.slice(0, 6));
  return header === "GIF87a" || header === "GIF89a";
}

function isWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const riff = String.fromCharCode(...bytes.slice(0, 4));
  const webp = String.fromCharCode(...bytes.slice(8, 12));
  return riff === "RIFF" && webp === "WEBP";
}
