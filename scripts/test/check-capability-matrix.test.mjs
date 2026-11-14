import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { checkCapabilityMatrix, MATRIX, readInventory } from "../lib/capability-matrix.mjs";

const real = () => JSON.parse(readFileSync(MATRIX, "utf8"));
const inventory = readInventory();
const fails = (mutate, pattern) => {
	const matrix = real();
	mutate(matrix);
	assert.throws(() => checkCapabilityMatrix(matrix, inventory), pattern);
};

test("the committed matrix covers the source inventory with one disposition each", () => {
	const result = checkCapabilityMatrix(real(), inventory);
	assert.equal(result.builtinFiles, 25);
	assert.equal(inventory.builtinFiles.length, 25);
	assert.ok(inventory.tools.includes("bash") && inventory.modes.includes("acp"));
	assert.ok(inventory.slashCommands.length >= 29);
	assert.ok(result.features > inventory.slashCommands.length);
});

test("a missing, duplicate or unknown entry fails", () => {
	fails((m) => (m.builtinExtensions = m.builtinExtensions.slice(1)), /missing built-in extension file/);
	fails((m) => m.builtinExtensions.push(m.builtinExtensions[0]), /duplicate/);
	fails((m) => m.builtinExtensions.push({ ...m.builtinExtensions[0], file: "gone.ts" }), /no such built-in/);
	fails((m) => (m.features = m.features.filter((f) => f.id !== "tool.bash")), /missing feature tool\.bash/);
	fails((m) => (m.features = m.features.filter((f) => f.id !== "slash.compact")), /missing feature slash\.compact/);
	fails((m) => m.features.push({ ...m.features[0] }), /duplicate/);
	fails((m) => m.features.push({ ...m.features[0], id: "tool.teleport" }), /unknown feature tool\.teleport/);
});

test("each entry has exactly one valid disposition and a stage that fits it", () => {
	fails((m) => (m.features[0].disposition = "partial"), /disposition/);
	fails((m) => delete m.features[0].disposition, /disposition/);
	const ported = (m) => m.features.find((f) => f.disposition === "ported");
	fails((m) => (ported(m).stage = "K7"), /stage/);
	const refused = (m) => m.features.find((f) => f.disposition === "refused");
	fails((m) => (refused(m).stage = "K2"), /stage/);
	fails((m) => (m.features[0].description = ""), /description/);
});

test("built-in extensions follow F4: safety gates ported by K3, nothing hosted", () => {
	const gate = (m) => m.builtinExtensions.find((e) => e.file === "command-safety-gate.ts");
	const feature = (m, id) => m.features.find((f) => f.id === id);
	fails((m) => {
		gate(m).disposition = "refused";
		feature(m, gate(m).feature).disposition = "refused";
		feature(m, gate(m).feature).stage = "K7";
	}, /safety gate/);
	fails((m) => {
		const entry = m.builtinExtensions.find((e) => !e.safety);
		entry.disposition = "hosted";
		feature(m, entry.feature).disposition = "hosted";
		feature(m, entry.feature).stage = "K4";
	}, /hosted/);
	fails((m) => (gate(m).feature = "builtin.nowhere"), /unknown feature/);
	fails((m) => (m.builtinExtensions.find((e) => !e.safety).disposition = "ported"), /differs from its feature/);
	fails((m) => m.features.push({ id: "builtin.orphan", disposition: "refused", stage: "K7", description: "x" }), /no file/);
});
