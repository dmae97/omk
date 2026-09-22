import { describe, expect, it, vi } from "vitest";
import type { SessionInfo, SessionMetadata } from "../src/core/session-listing.ts";
import {
	SessionSearchController,
	type SessionSearchReader,
	searchSessionEntries,
} from "../src/modes/interactive/components/session-selector-async-search.ts";
import { filterAndSortSessions } from "../src/modes/interactive/components/session-selector-search.ts";

const full = (id: string, text: string, time = 1): SessionInfo => ({
	id,
	path: `/fixture/${id}.jsonl`,
	cwd: "/project",
	name: `name-${id}`,
	created: new Date(0),
	modified: new Date(time),
	messageCount: 2,
	firstMessage: "first",
	allMessagesText: text,
});
const metadata = ({ allMessagesText: _text, ...entry }: SessionInfo): SessionMetadata => entry;
const flush = async () => {
	for (let i = 0; i < 12; i++) await Promise.resolve();
};

describe("bounded full-history search", () => {
	it("preserves fuzzy, phrase, regex, ordering and relevance semantics without hydrating returned rows", async () => {
		const records = [
			full("a", "node\n\n cve old", 1),
			full("b", "brave node cve", 2),
			full("c", "something else", 3),
		];
		const entries = records.map(metadata);
		const read: SessionSearchReader = async (path) => records.find((record) => record.path === path) ?? null;
		for (const sort of ["threaded", "recent", "relevance"] as const) {
			for (const query of ["", "nc", '"node cve"', "re:BRAVE", "re:[", "project", "name-c"]) {
				const result = await searchSessionEntries(entries, query, sort, new AbortController().signal, read);
				expect(result.sessions).toEqual(filterAndSortSessions(records, query, sort).map(metadata));
				expect(result.unreadable).toBe(0);
				expect(result.sessions.every((entry) => !("allMessagesText" in entry))).toBe(true);
			}
		}
	});

	it("does not present missing, unreadable or replaced session identities as complete search results", async () => {
		const entries = ["missing", "denied", "replaced", "ok"].map((id) => metadata(full(id, "match")));
		const read: SessionSearchReader = async (path) => {
			if (path.includes("missing")) return null;
			if (path.includes("denied")) throw new Error("permission denied");
			if (path.includes("replaced")) return full("different-session", "match");
			return full("ok", "match");
		};
		const result = await searchSessionEntries(entries, "match", "recent", new AbortController().signal, read);
		expect(result.unreadable).toBe(3);
		expect(result.sessions.map((entry) => entry.id)).toEqual(["ok"]);
	});

	it("keeps two active reads across rapid query changes, publishes only the latest and retains ownership until settlement", async () => {
		const entries = ["a", "b", "c"].map((id) => metadata(full(id, "old latest")));
		const pending: { signal: AbortSignal; finish: () => void }[] = [];
		let active = 0;
		let peak = 0;
		const read: SessionSearchReader = (path, signal) =>
			new Promise((resolve) => {
				active++;
				peak = Math.max(peak, active);
				pending.push({
					signal,
					finish: () => {
						active--;
						const entry = entries.find((item) => item.path === path);
						resolve(entry ? { ...entry, allMessagesText: "old latest" } : null);
					},
				});
			});
		const controller = new SessionSearchController(read);
		const published: string[] = [];
		controller.update(entries, "old", "recent", () => published.push("old"));
		for (let i = 0; i < 20; i++)
			controller.update(entries, `latest ${" ".repeat(i)}`, "recent", () => published.push(`latest-${i}`));
		expect(pending).toHaveLength(2);
		expect(pending.every((item) => item.signal.aborted)).toBe(true);
		pending[0].finish();
		pending[1].finish();
		await flush();
		for (let i = 2; i < 5; i++) {
			pending[i].finish();
			await flush();
		}
		await controller.whenSettled();
		expect(peak).toBe(2);
		expect(active).toBe(0);
		expect(published).toEqual(["latest-19"]);
		controller.dispose();
	});

	it("cancels pending search on dispose without releasing still-active reads or repainting", async () => {
		let finish!: (value: SessionInfo | null) => void;
		const read = vi.fn<SessionSearchReader>(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const controller = new SessionSearchController(read);
		const publish = vi.fn();
		controller.update([metadata(full("a", "match"))], "match", "recent", publish);
		controller.dispose();
		let settled = false;
		const closing = controller.whenSettled().then(() => {
			settled = true;
		});
		await flush();
		expect(settled).toBe(false);
		finish(full("a", "match"));
		await closing;
		expect(publish).not.toHaveBeenCalled();
		controller.update([metadata(full("a", "match"))], "match", "recent", publish);
		expect(read).toHaveBeenCalledTimes(1);
	});
});
