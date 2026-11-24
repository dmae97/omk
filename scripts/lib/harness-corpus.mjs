import { relative } from "node:path";

/** @typedef {{id: string, file: string, name: string}} Case */
/** @typedef {{schemaVersion: number, baseline: string, recovery: Case[], security: {id: string, attack: Case, control: Case}[]}} Corpus */

/** @param {unknown} value @param {string} code @returns {Record<string, unknown>} */
function record(value, code) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(code);
	return Object.fromEntries(Object.entries(value));
}

/** @param {Record<string, unknown>} value @param {string[]} keys */
function exact(value, keys) {
	if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
		throw new Error("invalid_corpus");
	}
}

/** @param {unknown} value @returns {Case} */
function parseCase(value) {
	const row = record(value, "invalid_corpus");
	exact(row, ["id", "file", "name"]);
	if (
		typeof row.id !== "string" || !/^[A-Za-z0-9-]{1,64}$/u.test(row.id) ||
		typeof row.file !== "string" || !/^test\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.test\.ts$/u.test(row.file) ||
		typeof row.name !== "string" || row.name.trim() !== row.name || row.name.length < 1 || row.name.length > 512 ||
		/[\r\n\0]/u.test(row.name)
	) throw new Error("invalid_corpus");
	return { id: row.id, file: row.file, name: row.name };
}

/** Fixed acceptance inventory, not executable commands or configurable test counts.
 * @param {unknown} value @returns {Corpus}
 */
export function parseCorpus(value) {
	const raw = record(value, "invalid_corpus");
	exact(raw, ["schemaVersion", "baseline", "recovery", "security"]);
	if (
		raw.schemaVersion !== 1 || typeof raw.baseline !== "string" || !/^[a-f0-9]{40}$/u.test(raw.baseline) ||
		!Array.isArray(raw.recovery) || raw.recovery.length !== 20 ||
		!Array.isArray(raw.security) || raw.security.length !== 7
	) throw new Error("invalid_corpus");
	const recovery = raw.recovery.map(parseCase);
	const security = raw.security.map((value, index) => {
		const pair = record(value, "invalid_corpus");
		exact(pair, ["id", "attack", "control"]);
		const id = `H7-${String(index + 1).padStart(2, "0")}`;
		if (pair.id !== id) throw new Error("invalid_corpus");
		return { id, attack: parseCase(pair.attack), control: parseCase(pair.control) };
	});
	if (recovery.some((row, index) => row.id !== `H3-${String(index + 1).padStart(2, "0")}`)) {
		throw new Error("invalid_corpus");
	}
	const corpus = { schemaVersion: 1, baseline: raw.baseline, recovery, security };
	const rows = selectCorpus(corpus);
	if (new Set(rows.map((row) => row.id)).size !== rows.length ||
		new Set(rows.map((row) => `${row.file}\0${row.name}`)).size !== rows.length) throw new Error("invalid_corpus");
	return corpus;
}

/** @param {Corpus} corpus */
export function selectCorpus(corpus) {
	return [...corpus.recovery, ...corpus.security.flatMap(({ attack, control }) => [attack, control])];
}

/** Fail closed on filtered-out, renamed, duplicated, skipped or hook-failed evidence.
 * @param {Corpus} corpus @param {unknown} value @param {string} packageRoot
 */
export function verifyCorpusReport(corpus, value, packageRoot) {
	const report = record(value, "invalid_report");
	if (report.success !== true || report.numFailedTestSuites !== 0 || report.numFailedTests !== 0) {
		throw new Error("suite_failed");
	}
	if (!Array.isArray(report.testResults)) throw new Error("invalid_report");
	/** @type {Map<string, string[]>} */
	const observed = new Map();
	for (const item of report.testResults) {
		const suite = record(item, "invalid_report");
		if (typeof suite.name !== "string" || !Array.isArray(suite.assertionResults)) throw new Error("invalid_report");
		const file = relative(packageRoot, suite.name).replaceAll("\\", "/");
		for (const item of suite.assertionResults) {
			const assertion = record(item, "invalid_report");
			if (typeof assertion.fullName !== "string" || typeof assertion.status !== "string") throw new Error("invalid_report");
			const key = `${file}\0${assertion.fullName}`;
			observed.set(key, [...(observed.get(key) ?? []), assertion.status]);
		}
	}
	const rows = selectCorpus(corpus);
	const selected = new Set(rows.map(({ file, name }) => `${file}\0${name}`));
	for (const { id, file, name } of rows) {
		const statuses = observed.get(`${file}\0${name}`);
		if (statuses?.length !== 1) throw new Error(`case_cardinality:${id}`);
		if (statuses[0] !== "passed") throw new Error(`case_not_passed:${id}`);
	}
	for (const [key, statuses] of observed) {
		if (!selected.has(key) && statuses.some((status) => !["pending", "skipped", "todo", "disabled"].includes(status))) {
			throw new Error("unexpected_case");
		}
	}
	return { recovery: corpus.recovery.length, attacks: corpus.security.length, controls: corpus.security.length };
}
