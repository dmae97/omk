import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

test("independent openai-responses request oracle stays fresh and immutable", () => {
	const path = "native/omk-providers/tests/fixtures/openai-responses.json";
	const before = readFileSync(path, "utf8");
	const run = spawnSync(process.execPath, ["scripts/record-openai-responses-fixtures.mjs", "--check"], { encoding: "utf8", timeout: 45000 });
	assert.equal(run.error, undefined);
	assert.equal(run.status, 0, run.stderr);
	assert.match(run.stdout, /47 independent Node openai-responses requests/);
	assert.equal(readFileSync(path, "utf8"), before);
	const data = JSON.parse(before);
	assert.equal(data.schema, "omk.openai-responses-request.v1");
	const find = (id) => data.cases.find((c) => c.id === id).request;
	const body = (id) => JSON.parse(find(id).body);
	assert.equal(find("base-root").url, "https://synthetic.invalid/responses");
	assert.equal(body("reasoning-default").input[0].role, "developer");
	assert.deepEqual(body("reasoning-default").reasoning, { effort: "none" });
	assert.equal(body("off-null").reasoning, undefined);
	assert.deepEqual(body("tools").tools.map((t) => t.name), ["Edit", "read", "write"]);
	assert.equal(find("session-no-id-header").headers.session_id, undefined);
	assert.equal(find("session-no-id-header").headers["x-client-request-id"], "sess-1");
	assert.equal(body("retention-long-unsupported").prompt_cache_retention, undefined);
});

test("openai-responses history oracle is fresh without rewriting the fixture", () => {
	const path = "native/omk-providers/tests/fixtures/openai-responses-history.json";
	const before = readFileSync(path, "utf8");
	const run = spawnSync(process.execPath, ["scripts/record-openai-responses-fixtures.mjs", "--history", "--check"], { encoding: "utf8", timeout: 45000 });
	assert.equal(run.error, undefined);
	assert.equal(run.status, 0, run.stderr);
	assert.match(run.stdout, /19 independent Node openai-responses requests/);
	assert.equal(readFileSync(path, "utf8"), before);
	const data = JSON.parse(before);
	assert.equal(data.schema, "omk.openai-responses-history.v1");
	const input = (id) => JSON.parse(data.cases.find((c) => c.id === id).request.body).input;
	assert.deepEqual(input("same-reasoning")[2], { 2: 0, 10: 1.5, type: "reasoning", id: "rs_1", summary: [{ type: "summary_text", text: "s" }], encrypted_content: "enc" });
	assert.equal(input("message-index").at(-1).id, "msg_omk_3");
	assert.deepEqual(input("pairing").filter((i) => i.type === "function_call_output").map((i) => i.output), ["padded", "No result provided", "No result provided", "No result provided"]);
	assert.equal(input("cross-openai-model").find((i) => i.call_id === "raw").id, "fc");
});

test("openai-responses image oracle is fresh without rewriting the fixture", () => {
	const path = "native/omk-providers/tests/fixtures/openai-responses-images.json";
	const before = readFileSync(path, "utf8");
	const run = spawnSync(process.execPath, ["scripts/record-openai-responses-fixtures.mjs", "--images", "--check"], { encoding: "utf8", timeout: 45000 });
	assert.equal(run.error, undefined);
	assert.equal(run.status, 0, run.stderr);
	assert.match(run.stdout, /10 independent Node openai-responses requests/);
	assert.equal(readFileSync(path, "utf8"), before);
	const data = JSON.parse(before);
	assert.equal(data.schema, "omk.openai-responses-images.v1");
	const outputs = (id) => JSON.parse(data.cases.find((c) => c.id === id).request.body).input.filter((i) => i.type === "function_call_output").map((i) => i.output);
	assert.deepEqual(outputs("vision-tool-results")[2], [{ type: "input_image", detail: "auto", image_url: "data:image/png;base64,cG5n" }]);
	assert.equal(outputs("text-tool-results")[1], "a\n(tool image omitted: model does not support images)\nb");
});

test("openai-responses header merge oracle is fresh without rewriting the fixture", () => {
	const path = "native/omk-providers/tests/fixtures/openai-responses-headers.json";
	const before = readFileSync(path, "utf8");
	const run = spawnSync(process.execPath, ["scripts/record-openai-responses-fixtures.mjs", "--headers", "--check"], { encoding: "utf8", timeout: 45000 });
	assert.equal(run.error, undefined);
	assert.equal(run.status, 0, run.stderr);
	assert.match(run.stdout, /16 independent Node openai-responses requests/);
	assert.equal(readFileSync(path, "utf8"), before);
	const data = JSON.parse(before);
	assert.equal(data.schema, "omk.openai-responses-headers.v1");
	const headers = (id) => data.cases.find((c) => c.id === id).request.headers;
	assert.equal(headers("options-override-model")["x-shared"], "option");
	assert.equal(headers("case-collision-position")["x-a"], "2");
	assert.equal(headers("options-override-session").session_id, "opt-session");
	assert.equal(headers("content-type-is-sdk-owned")["content-type"], "application/json");
	assert.equal(headers("override-sdk-defaults").authorization, "Bearer synthetic-override");
});
