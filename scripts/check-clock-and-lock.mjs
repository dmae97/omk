#!/usr/bin/env node
/**
 * Wall-clock and proper-lockfile misuse gate for product code (packages/<pkg>/src).
 *
 * clock: `Date.now()` steps when the host resyncs wall time. WSL2 was measured stepping it by about
 * -2.5 s and +8.5 s at a time, so a duration, TTL, throttle or deadline taken from two wall-clock
 * reads can go negative, expire early or never expire. The gate flags `-`, `<`, `<=`, `>` and `>=`
 * with `Date.now()` (or a variable initialized from it) on either side; measure those with
 * `performance.now()`. Comparing with an absolute timestamp made elsewhere (a persisted expiry, a
 * server epoch, a file mtime) is a real wall-clock use: say so with `// wall-clock: <reason>` on
 * the same line or in the comment directly above.
 *
 * lock: proper-lockfile treats a lock as abandoned when its mtime is older than `stale` by
 * `Date.now()`. Its 10 s default let a clock step hand a live lock to another session, and its
 * default `onCompromised` throws from a timer, an uncaught exception that ends the process. Every
 * `lock`/`lockSync` call passes an explicit `stale`, and every async `lock` passes `onCompromised`.
 * `// lock-ok: <reason>` covers options the gate cannot see.
 *
 * Usage: node scripts/check-clock-and-lock.mjs
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLOCK_OPERATORS = new Set([
	ts.SyntaxKind.MinusToken,
	ts.SyntaxKind.LessThanToken,
	ts.SyntaxKind.LessThanEqualsToken,
	ts.SyntaxKind.GreaterThanToken,
	ts.SyntaxKind.GreaterThanEqualsToken,
]);
const MARKERS = { clock: /\bwall-clock:\s*\S.{2,}/, lock: /\block-ok:\s*\S.{2,}/ };
const MESSAGES = {
	clock:
		"duration, TTL or deadline from Date.now(); use performance.now(), or add `// wall-clock: <reason>` when comparing with an absolute timestamp from elsewhere",
	lock: "proper-lockfile lock without an explicit stale window (and onCompromised for async lock); see scripts/check-clock-and-lock.mjs",
};

function unwrap(node) {
	while (ts.isParenthesizedExpression(node)) node = node.expression;
	return node;
}

const SCALING = new Set([ts.SyntaxKind.SlashToken, ts.SyntaxKind.AsteriskToken]);
const ROUNDING = new Set(["floor", "round", "ceil", "trunc"]);

/** `Date.now()`, also scaled to other units (`Date.now() / 1000`) or rounded (`Math.floor(...)`). */
function isDateNow(node) {
	node = unwrap(node);
	if (ts.isBinaryExpression(node) && SCALING.has(node.operatorToken.kind)) {
		return isDateNow(node.left) || isDateNow(node.right);
	}
	if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
	const { expression: object, name } = node.expression;
	if (!ts.isIdentifier(object)) return false;
	if (object.text === "Math" && ROUNDING.has(name.text)) return node.arguments.length === 1 && isDateNow(node.arguments[0]);
	return object.text === "Date" && name.text === "now" && node.arguments.length === 0;
}

function propertyNames(literal) {
	const names = new Set();
	for (const property of literal.properties) {
		if (property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
			names.add(property.name.text);
		}
	}
	return names;
}

function isCommentLine(text) {
	const trimmed = text.trim();
	return trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*");
}

/** True when the marker sits on `line` or in the comment block directly above it (0-based). */
function annotated(lines, line, marker) {
	if (marker.test(lines[line] ?? "")) return true;
	for (let index = line - 1; index >= 0 && isCommentLine(lines[index]); index--) {
		if (marker.test(lines[index])) return true;
	}
	return false;
}

function enclosingStatementLine(node, sourceFile) {
	let current = node;
	while (current.parent && !ts.isSourceFile(current.parent) && !ts.isBlock(current.parent)) current = current.parent;
	return sourceFile.getLineAndCharacterOfPosition(current.getStart(sourceFile)).line;
}

export function findClockAndLockIssues(source, fileName = "file.ts") {
	const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const lines = source.split(/\r?\n/);
	const nowNames = new Set();
	const lockModules = new Set();
	const lockFunctions = new Map();

	const collect = (node) => {
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isDateNow(node.initializer)) {
			nowNames.add(node.name.text);
		}
		if (
			ts.isImportDeclaration(node) &&
			ts.isStringLiteral(node.moduleSpecifier) &&
			node.moduleSpecifier.text === "proper-lockfile" &&
			node.importClause
		) {
			const clause = node.importClause;
			if (clause.name) {
				lockModules.add(clause.name.text);
				lockFunctions.set(clause.name.text, "lock");
			}
			const bindings = clause.namedBindings;
			if (bindings && ts.isNamespaceImport(bindings)) lockModules.add(bindings.name.text);
			if (bindings && ts.isNamedImports(bindings)) {
				for (const element of bindings.elements) {
					const imported = (element.propertyName ?? element.name).text;
					if (imported === "lock" || imported === "lockSync") lockFunctions.set(element.name.text, imported);
				}
			}
		}
		ts.forEachChild(node, collect);
	};
	collect(sourceFile);

	const isNow = (node) => {
		node = unwrap(node);
		return isDateNow(node) || (ts.isIdentifier(node) && nowNames.has(node.text));
	};
	const lockKind = (call) => {
		const callee = call.expression;
		if (ts.isIdentifier(callee)) return lockFunctions.get(callee.text);
		if (
			ts.isPropertyAccessExpression(callee) &&
			ts.isIdentifier(callee.expression) &&
			lockModules.has(callee.expression.text) &&
			(callee.name.text === "lock" || callee.name.text === "lockSync")
		) {
			return callee.name.text;
		}
		return undefined;
	};

	const issues = [];
	const seen = new Set();
	const report = (node, rule) => {
		const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
		const statementLine = enclosingStatementLine(node, sourceFile);
		if (annotated(lines, line, MARKERS[rule]) || annotated(lines, statementLine, MARKERS[rule])) return;
		const key = `${line}:${rule}`;
		if (seen.has(key)) return;
		seen.add(key);
		issues.push({ line: line + 1, rule, message: MESSAGES[rule] });
	};

	const check = (node) => {
		if (
			ts.isBinaryExpression(node) &&
			CLOCK_OPERATORS.has(node.operatorToken.kind) &&
			(isNow(node.left) || isNow(node.right))
		) {
			report(node, "clock");
		}
		if (ts.isCallExpression(node)) {
			const kind = lockKind(node);
			if (kind) {
				const options = node.arguments[1];
				const names = options && ts.isObjectLiteralExpression(options) ? propertyNames(options) : new Set();
				if (!names.has("stale") || (kind === "lock" && !names.has("onCompromised"))) report(node, "lock");
			}
		}
		ts.forEachChild(node, check);
	};
	check(sourceFile);
	return issues.sort((a, b) => a.line - b.line);
}

function* sourceFiles(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) yield* sourceFiles(path);
		else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") && !entry.name.endsWith(".test.ts")) yield path;
	}
}

export function scan(root = repoRoot) {
	const found = [];
	let files = 0;
	const packages = join(root, "packages");
	for (const pkg of readdirSync(packages, { withFileTypes: true })) {
		const src = join(packages, pkg.name, "src");
		if (!pkg.isDirectory() || !existsSync(src)) continue;
		for (const file of sourceFiles(src)) {
			files++;
			const path = relative(root, file).split("\\").join("/");
			for (const issue of findClockAndLockIssues(readFileSync(file, "utf8"), path)) found.push({ path, ...issue });
		}
	}
	return { files, issues: found };
}

function main() {
	const { files, issues } = scan();
	if (issues.length > 0) {
		for (const rule of ["clock", "lock"]) {
			const ruleIssues = issues.filter((issue) => issue.rule === rule);
			if (ruleIssues.length === 0) continue;
			console.error(`${MESSAGES[rule]}:`);
			for (const issue of ruleIssues) console.error(`  ${issue.path}:${issue.line}`);
		}
		process.exit(1);
	}
	console.log(`Clock and lock usage OK: ${files} product source file(s) checked.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
