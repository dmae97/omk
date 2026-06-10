/**
 * CLI Theme — omk.theme.v1 Document Loader
 * Discovers, loads, and structurally validates themes/*.theme.json documents
 * (the executable twin of schemas/omk.theme.v1.schema.json, mirroring
 * scripts/theme-check.mjs validateTheme()). Read-only filesystem access.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { OmkThemeV1 } from "./render-table.js";

export interface ThemeDocumentRef {
  /** Theme name derived from the file name (e.g. "night-city"). */
  readonly name: string;
  /** Absolute path of the .theme.json document. */
  readonly path: string;
}

const ANSI16_NAMES: ReadonlySet<string> = new Set([
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow",
  "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
]);

/** Candidate themes/ directories: project cwd first, then the package root. */
function themesDirCandidates(cwd: string): readonly string[] {
  const moduleRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const candidates = [join(cwd, "themes"), join(moduleRoot, "themes")];
  return [...new Set(candidates)];
}

/** List omk.theme.v1 documents discoverable from cwd (or the package root). */
export function listThemeDocuments(cwd: string = process.cwd()): readonly ThemeDocumentRef[] {
  for (const dir of themesDirCandidates(cwd)) {
    if (!existsSync(dir)) continue;
    const refs = readdirSync(dir)
      .filter((f) => f.endsWith(".theme.json"))
      .map((f) => ({ name: f.replace(/\.theme\.json$/, ""), path: join(dir, f) }));
    if (refs.length > 0) return refs;
  }
  return [];
}

/** Load one theme document by name. Returns undefined when absent/unreadable. */
export function loadThemeDocument(name: string, cwd: string = process.cwd()): OmkThemeV1 | undefined {
  const ref = listThemeDocuments(cwd).find((r) => r.name === name);
  if (ref === undefined) return undefined;
  try {
    return JSON.parse(readFileSync(ref.path, "utf8")) as OmkThemeV1;
  } catch {
    return undefined;
  }
}

/**
 * Structural validation of an omk.theme.v1 document — the same executable
 * rules scripts/theme-check.mjs enforces in CI. Returns [] when valid.
 */
export function validateThemeDocument(theme: OmkThemeV1): readonly string[] {
  const errors: string[] = [];
  const err = (m: string): void => { errors.push(m); };
  if (theme.schemaVersion !== "omk.theme.v1") err(`schemaVersion must be "omk.theme.v1"`);
  if (!/^[a-z][a-z0-9-]*$/.test(theme.name ?? "")) err("invalid theme name");
  if (theme.mode !== "dark" && theme.mode !== "light") err("mode must be dark|light");
  const primitives = theme.primitives ?? {};
  for (const [k, v] of Object.entries(primitives)) {
    if (!/^#[0-9A-Fa-f]{6}$/.test(v)) err(`primitive ${k}: bad hex ${v}`);
  }
  for (const bg of theme.backgrounds ?? []) {
    if (primitives[bg] === undefined) err(`background "${bg}" is not a primitive`);
  }
  const semantics = theme.semantics ?? {};
  for (const [role, spec] of Object.entries(semantics)) {
    if (primitives[spec.color] === undefined) err(`semantic ${role}: color "${spec.color}" is not a primitive`);
    const kind = spec.kind ?? "state";
    if (kind === "state" && (spec.glyph === undefined || spec.glyph === "")) {
      err(`semantic state ${role}: missing mandatory glyph`);
    }
    if (!["text", "indicator", "background"].includes(spec.usage)) err(`semantic ${role}: bad usage`);
  }
  for (const [comp, slots] of Object.entries(theme.components ?? {})) {
    for (const [slot, role] of Object.entries(slots)) {
      if (semantics[role] === undefined) err(`component ${comp}.${slot}: unknown semantic role "${role}"`);
    }
  }
  const fb = theme.fallback16 ?? {};
  for (const role of Object.keys(semantics)) {
    if (fb[role] === undefined) err(`fallback16: missing entry for semantic role "${role}"`);
  }
  for (const [role, name] of Object.entries(fb)) {
    if (!ANSI16_NAMES.has(name)) err(`fallback16 ${role}: unknown ANSI-16 name "${name}"`);
    if (semantics[role] === undefined) err(`fallback16 ${role}: no such semantic role`);
  }
  return errors;
}
