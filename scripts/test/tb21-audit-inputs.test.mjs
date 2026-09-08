import assert from "node:assert/strict";
import { mkdirSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { change, checksum, digest, evidence, invoke, rejected, run } from "./fixtures/tb21-evidence.mjs";

const invalidManifests = [
	[
		"empty tasks",
		(m) => {
			m.tasks = [];
		},
	],
	[
		"duplicate tasks",
		(m) => {
			m.tasks.push(m.tasks[0]);
		},
	],
	[
		"short revision",
		(m) => {
			m.datasetRevision = "123abcd";
		},
	],
	[
		"path escape",
		(m) => {
			m.arms.A.job = "../outside";
		},
	],
	[
		"absolute job",
		(m) => {
			m.arms.A.job = "/private";
		},
	],
	[
		"windows path escape",
		(m) => {
			m.arms.A.job = "..\\outside";
		},
	],
	[
		"same jobs",
		(m) => {
			m.arms.B.job = m.arms.A.job;
		},
	],
	[
		"extra private metadata",
		(m) => {
			m.credential = "DO_NOT_PRINT";
		},
	],
	[
		"invalid task checksum",
		(m) => {
			m.tasks[0].checksum = "invalid";
		},
	],
	[
		"missing provenance",
		(m) => {
			delete m.arms.A.harnessSha256;
		},
	],
];
for (const [name, mutate] of invalidManifests) {
	test(`rejects a manifest with ${name}`, (t) => {
		const fixture = evidence(t);
		change(fixture.manifestPath, mutate);
		rejected(run(fixture), "invalid_manifest");
	});
}

test("refuses a modified manifest when the caller pinned its previous digest", (t) => {
	const fixture = evidence(t);
	const pinned = digest(fixture.manifestPath);
	change(fixture.manifestPath, (m) => {
		m.runId = "modified";
	});
	rejected(
		invoke(["--manifest", fixture.manifestPath, "--expect-manifest-sha256", pinned]),
		"manifest_digest_mismatch",
	);
});

test("does not select an unrelated newer job", (t) => {
	const fixture = evidence(t);
	const unrelated = join(fixture.root, "2099-newer-job");
	mkdirSync(unrelated);
	writeFileSync(join(unrelated, "result.json"), "DO_NOT_PRINT");
	assert.equal(run(fixture).status, 0);
});

for (const type of ["job", "result"]) {
	test(`rejects a symlinked ${type} before reading it`, (t) => {
		const fixture = evidence(t);
		const target = type === "job" ? join(fixture.root, "arm-a") : fixture.result;
		const moved = `${target}-original`;
		renameSync(target, moved);
		symlinkSync(moved, target, type === "job" ? "junction" : "file");
		rejected(run(fixture), type === "job" ? "unsafe_job_path" : "invalid_result_file");
	});
}

test("bounds result size and never echoes malformed private JSON", (t) => {
	const fixture = evidence(t);
	writeFileSync(fixture.result, 'DO_NOT_PRINT {"apiKey":');
	rejected(run(fixture), "invalid_result_json");
	writeFileSync(fixture.result, " ".repeat(8 * 1024 * 1024 + 1));
	rejected(run(fixture), "invalid_result_file");
});

test("rejects duplicate CLI options rather than silently choosing the last manifest", (t) => {
	const fixture = evidence(t);
	rejected(run(fixture, ["--manifest", fixture.manifestPath]), "invalid_options");
});

for (const args of [[], ["--manifest"], ["--unknown", "DO_NOT_PRINT"], ["--expect-manifest-sha256", checksum]]) {
	test(`rejects incomplete CLI options ${args[0] ?? "empty"}`, () => {
		const result = invoke(args);
		rejected(result, "invalid_options");
		assert.equal(result.status, 2);
	});
}
