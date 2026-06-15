#!/usr/bin/env node
/**
 * Theme sync — keep `src/brand/*.theme.json` as copies of `themes/*.theme.json`.
 *
 * Single source of truth: themes/*.theme.json
 * Build/CI step: copy to src/brand so the runtime bundle contains the same theme assets.
 */
import { readdir, copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";

const root = process.cwd();
const sourceDir = join(root, "themes");
const targetDir = join(root, "src/brand");

async function syncThemes() {
  if (!existsSync(sourceDir)) {
    console.error(`Source theme directory not found: ${sourceDir}`);
    process.exit(1);
  }
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile() && e.name.endsWith(".theme.json"));
  if (files.length === 0) {
    console.error(`No .theme.json files found in ${sourceDir}`);
    process.exit(1);
  }
  for (const file of files) {
    const src = join(sourceDir, file.name);
    const dst = join(targetDir, file.name);
    await copyFile(src, dst);
    console.log(`synced ${src} -> ${dst}`);
  }
  console.log(`Synced ${files.length} theme file(s).`);
}

syncThemes().catch((err) => {
  console.error(err);
  process.exit(1);
});
