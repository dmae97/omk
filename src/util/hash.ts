import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf-8").digest("hex");
}

export function sha256FileSync(path: string): string | undefined {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return undefined;
  }
}
