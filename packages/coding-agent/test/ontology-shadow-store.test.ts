import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	type OntologyShadowResource,
	queryOntologyShadowStore,
	resolveOntologyShadowScope,
	writeOntologyShadowStore,
} from "../src/core/ontology-shadow-store.ts";

function git(cwd: string, ...args: string[]): string {
	const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
	expect(result.status, result.stderr).toBe(0);
	return result.stdout.trim();
}

function resource(name: string, content = name): OntologyShadowResource {
	return {
		id: `skill:${name}`,
		kind: "skill",
		name,
		description: `${name} repository cache audit specialist`,
		contentHash: content,
		locationHash: `location-${name}`,
	};
}

describe("ontology shadow scope and store", () => {
	it("derives stable repository/worktree scopes without putting HEAD in identity", () => {
		const root = mkdtempSync(join(tmpdir(), "omk-ontology-scope-"));
		git(root, "init", "--quiet");
		git(root, "config", "user.email", "ontology@example.invalid");
		git(root, "config", "user.name", "Ontology Test");
		writeFileSync(join(root, "README.md"), "scope\n");
		git(root, "add", "README.md");
		git(root, "commit", "--quiet", "-m", "initial");
		const linked = join(root, "linked");
		git(root, "worktree", "add", "--quiet", "-b", "linked", linked);

		const main = resolveOntologyShadowScope(root);
		const other = resolveOntologyShadowScope(linked);
		expect(main.scopeId).not.toBe(other.scopeId);
		expect(main.storePath).not.toBe(other.storePath);
		expect(main.commonDir).toBe(other.commonDir);
		expect(main.worktreeDir).not.toBe(other.worktreeDir);

		git(root, "commit", "--quiet", "--allow-empty", "-m", "advance");
		expect(resolveOntologyShadowScope(root).scopeId).toBe(main.scopeId);
	});

	it("persists only bounded approved metadata and rejects stale revisions or content", () => {
		const root = mkdtempSync(join(tmpdir(), "omk-ontology-store-"));
		const scope = { scopeId: "scope-123456789012", storePath: join(root, "store.json") };
		const resources = [resource("alpha"), resource("beta")];
		writeOntologyShadowStore(scope, { head: "head-a", resources });

		const hit = queryOntologyShadowStore(scope, {
			head: "head-a",
			resources,
			text: "cache audit alpha",
			limit: 999,
		});
		expect(hit.status).toBe("fresh");
		expect(hit.selectedIds[0]).toBe("skill:alpha");
		expect(hit.selectedIds.length).toBeLessThanOrEqual(32);

		expect(queryOntologyShadowStore(scope, { head: "head-b", resources, text: "alpha" }).status).toBe("stale");
		expect(
			queryOntologyShadowStore(scope, {
				head: "head-a",
				resources: [resource("alpha", "changed"), resource("beta")],
				text: "alpha",
			}).status,
		).toBe("stale");
		expect(
			queryOntologyShadowStore(scope, {
				head: "head-a",
				resources,
				text: "alpha",
				producerVersion: "different-producer",
			}).status,
		).toBe("stale");
		expect(
			queryOntologyShadowStore(scope, {
				head: "head-a",
				resources,
				text: "alpha",
				policyHash: "0".repeat(64),
			}).status,
		).toBe("stale");

		const persisted = readFileSync(scope.storePath, "utf8");
		expect(persisted).not.toContain("cache audit alpha");
		expect(persisted).not.toContain(root);
	});

	it("bounds result fan-out and filters only approved relation types", () => {
		const root = mkdtempSync(join(tmpdir(), "omk-ontology-query-"));
		const scope = { scopeId: "scope-123456789012", storePath: join(root, "store.json") };
		const resources = Array.from({ length: 40 }, (_, index) => resource(`skill-${index}`));
		writeOntologyShadowStore(scope, {
			head: "head-a",
			resources,
			relations: [{ from: "catalog", to: "skill:skill-0", type: "contains" }],
		});
		const bounded = queryOntologyShadowStore(scope, {
			head: "head-a",
			resources,
			relations: [{ from: "catalog", to: "skill:skill-0", type: "contains" }],
			text: "cache audit",
			limit: 999,
		});
		expect(bounded.status).toBe("fresh");
		expect(bounded.selectedIds).toHaveLength(32);
		const related = queryOntologyShadowStore(scope, {
			head: "head-a",
			resources,
			relations: [{ from: "catalog", to: "skill:skill-0", type: "contains" }],
			text: "cache audit",
			relation: "contains",
		});
		expect(related.selectedIds).toEqual(["skill:skill-0"]);
	});

	it("fails closed on malformed stores and unapproved relations", () => {
		const root = mkdtempSync(join(tmpdir(), "omk-ontology-invalid-"));
		const scope = { scopeId: "scope-123456789012", storePath: join(root, "store.json") };
		writeFileSync(scope.storePath, JSON.stringify({ schemaVersion: 1, relations: [{ type: "executes" }] }));
		expect(queryOntologyShadowStore(scope, { head: "h", resources: [], text: "x" }).status).toBe("stale");
		expect(() =>
			writeOntologyShadowStore(scope, {
				head: "h",
				resources: [],
				relations: [{ from: "a", to: "b", type: "executes" as "contains" }],
			}),
		).toThrow();
	});
});
