/**
 * Per-packet repair attempt state under .omk/wall-cache/repair-budget.json.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RepairBudgetState, UserVerdict } from "../../../../adaptorch-wpl/src/index.ts";

const REPAIR_STATE_REL = join(".omk", "wall-cache", "repair-budget.json");

type RepairBudgetFile = {
	schemaVersion: 1;
	packets: Record<string, RepairBudgetState>;
};

function emptyFile(): RepairBudgetFile {
	return { schemaVersion: 1, packets: {} };
}

export function repairPacketKey(options: { packetId?: string; kind: string; scopeKey: string }): string {
	if (options.packetId !== undefined && options.packetId.length > 0) {
		return options.packetId;
	}
	const material = `${options.kind}\0${options.scopeKey}`;
	return createHash("sha256").update(material, "utf8").digest("hex");
}

export function scopeKeyFromApprovedWriteScope(approvedWriteScope: string[]): string {
	if (approvedWriteScope.length === 0) return "";
	return [...approvedWriteScope].sort().join(",");
}

async function readRepairStateFile(cwd: string): Promise<RepairBudgetFile> {
	const path = join(cwd, REPAIR_STATE_REL);
	try {
		const raw = await readFile(path, "utf-8");
		const parsed = JSON.parse(raw) as Partial<RepairBudgetFile>;
		if (parsed.schemaVersion !== 1 || typeof parsed.packets !== "object" || parsed.packets === null) {
			return emptyFile();
		}
		return { schemaVersion: 1, packets: parsed.packets };
	} catch (err) {
		if (err && typeof err === "object" && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
			return emptyFile();
		}
		return emptyFile();
	}
}

async function writeRepairStateFile(cwd: string, file: RepairBudgetFile): Promise<void> {
	const dir = join(cwd, ".omk", "wall-cache");
	await mkdir(dir, { recursive: true });
	await writeFile(join(cwd, REPAIR_STATE_REL), `${JSON.stringify(file, null, 2)}\n`, "utf-8");
}

export async function readRepairBudgetState(cwd: string, packetKey: string): Promise<RepairBudgetState | undefined> {
	const file = await readRepairStateFile(cwd);
	return file.packets[packetKey];
}

export async function recordBlockedRepairAttempt(
	cwd: string,
	packetKey: string,
	verdict: UserVerdict,
): Promise<RepairBudgetState> {
	const file = await readRepairStateFile(cwd);
	const prev = file.packets[packetKey];
	const next: RepairBudgetState = {
		packetKey,
		attempts: (prev?.attempts ?? 0) + 1,
		lastVerdict: verdict,
	};
	file.packets[packetKey] = next;
	await writeRepairStateFile(cwd, file);
	return next;
}
