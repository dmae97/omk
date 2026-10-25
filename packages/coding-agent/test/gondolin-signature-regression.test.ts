import {
	constants,
	createHash,
	generateKeyPairSync,
	type KeyObject,
	privateEncrypt,
	publicDecrypt,
	X509Certificate,
} from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { VM } from "@earendil-works/gondolin";
import type { ExtensionAPI, ExtensionContext } from "open-multi-agent-kit";
import { beforeAll, describe, expect, it, vi } from "vitest";
import gondolinExtension from "../examples/extensions/gondolin/index.ts";

// CVE-2026-85393 / GHSA-86w9-cpqp-85rv was a node-forge DigestInfo parser flaw.
// Gondolin 0.14.0 dropped node-forge: certificates are built by its own DER
// encoder and verified by Node's X509Certificate (OpenSSL). These tests replay
// the malformed fixtures that the former runtime guard blocked against the real
// cached-leaf verification function, without a guard installed.

type DerElement = { tag: number; content: Buffer; raw: Buffer };
type X509Module = {
	createCertificate: (options: {
		publicKey: KeyObject;
		signingKey: KeyObject;
		serialNumber: Buffer;
		notBefore: Date;
		notAfter: Date;
		subject: Buffer;
		issuer: Buffer;
		extensions: Array<{ oid: string; critical?: boolean; value: Buffer }>;
	}) => Buffer;
	encodeCommonNameName: (name: string) => Buffer;
	basicConstraintsExtension: (options: { ca: boolean; critical?: boolean }) => {
		oid: string;
		critical?: boolean;
		value: Buffer;
	};
	readDer: (buffer: Buffer, offset?: number) => DerElement;
	readDerChildren: (element: DerElement) => DerElement[];
};
type MitmModule = { caCertVerifiesLeaf: (ca: X509Certificate, leaf: X509Certificate) => boolean };

const requireHere = createRequire(import.meta.url);
const gondolinManifest = requireHere.resolve("@earendil-works/gondolin/package.json");
const gondolinDist = path.join(path.dirname(gondolinManifest), "dist/src");
const requireGondolin = createRequire(gondolinManifest);
const loadInternal = async <T>(file: string) => (await import(pathToFileURL(path.join(gondolinDist, file)).href)) as T;

const hashes = {
	sha256: "608648016503040201",
	sha384: "608648016503040202",
};
// Exponent 3 keeps the low-exponent case from the advisory; 1024 bits keeps the
// encoded message short. Both are test-owned and generated in memory.
const keys = generateKeyPairSync("rsa", { modulusLength: 1024, publicExponent: 3 });
const MODULUS_BYTES = 128;

function der(tag: number, bytes: Buffer): Buffer {
	const length = bytes.length;
	const header =
		length < 0x80
			? Buffer.from([tag, length])
			: length < 0x100
				? Buffer.from([tag, 0x81, length])
				: Buffer.from([tag, 0x82, length >> 8, length & 0xff]);
	return Buffer.concat([header, bytes]);
}
const sequence = (...items: Buffer[]) => der(0x30, Buffer.concat(items));
const oid = (hash: keyof typeof hashes) => der(0x06, Buffer.from(hashes[hash], "hex"));
const nullParameter = Buffer.from([0x05, 0]);
const garbage = der(0x04, Buffer.from("unconsumed nested element"));

function encodedMessage(info: Buffer): Buffer {
	return Buffer.concat([
		Buffer.from([0, 1]),
		Buffer.alloc(MODULUS_BYTES - 3 - info.length, 0xff),
		Buffer.from([0]),
		info,
	]);
}

function rawSignature(info: Buffer): Buffer {
	// A test-owned private key produces malformed encoded messages
	// deterministically. This exercises the verifier's parser, not an attack.
	return privateEncrypt({ key: keys.privateKey, padding: constants.RSA_NO_PADDING }, encodedMessage(info));
}

describe("Gondolin CVE-2026-85393 regression without the former runtime guard", () => {
	let x509: X509Module;
	let caCertVerifiesLeaf: MitmModule["caCertVerifiesLeaf"];
	let ca: X509Certificate;
	let leafDer: Buffer;

	function withSignature(certificate: Buffer, signature: Buffer): X509Certificate {
		const [tbs, algorithm] = x509.readDerChildren(x509.readDer(certificate));
		return new X509Certificate(
			sequence(tbs.raw, algorithm.raw, der(0x03, Buffer.concat([Buffer.from([0]), signature]))),
		);
	}

	function resigned(algorithm: Buffer): X509Certificate {
		const [tbs] = x509.readDerChildren(x509.readDer(leafDer));
		const digest = createHash("sha256").update(tbs.raw).digest();
		return withSignature(leafDer, rawSignature(sequence(algorithm, der(0x04, digest))));
	}

	beforeAll(async () => {
		x509 = await loadInternal<X509Module>("x509.js");
		({ caCertVerifiesLeaf } = await loadInternal<MitmModule>("mitm.js"));
		const caName = x509.encodeCommonNameName("OMK synthetic CA");
		const validity = { notBefore: new Date("2026-01-01T00:00:00Z"), notAfter: new Date("2030-01-01T00:00:00Z") };
		ca = new X509Certificate(
			x509.createCertificate({
				publicKey: keys.publicKey,
				signingKey: keys.privateKey,
				serialNumber: Buffer.from([1]),
				...validity,
				subject: caName,
				issuer: caName,
				extensions: [x509.basicConstraintsExtension({ ca: true, critical: true })],
			}),
		);
		const leafKeys = generateKeyPairSync("rsa", { modulusLength: 1024 });
		leafDer = x509.createCertificate({
			publicKey: leafKeys.publicKey,
			signingKey: keys.privateKey,
			serialNumber: Buffer.from([2]),
			...validity,
			subject: x509.encodeCommonNameName("fixture.invalid"),
			issuer: caName,
			extensions: [x509.basicConstraintsExtension({ ca: false })],
		});
	});

	it("no longer depends on or imports node-forge, so a reintroduction needs a new review", () => {
		// Checked against Gondolin's own manifest and shipped sources rather than module
		// resolution, which can walk up into an unrelated parent node_modules.
		const manifest = requireGondolin("./package.json") as Record<string, Record<string, string> | undefined>;
		for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
			expect(Object.keys(manifest[field] ?? {}), field).not.toContain("node-forge");
		}
		const sources = readdirSync(gondolinDist, { recursive: true, encoding: "utf8" }).filter((file) =>
			file.endsWith(".js"),
		);
		expect(sources.length).toBeGreaterThan(0);
		const importers = sources.filter((file) =>
			readFileSync(path.join(gondolinDist, file), "utf8").includes("node-forge"),
		);
		expect(importers).toEqual([]);
	});

	it("accepts normally issued leaves and a well-formed raw DigestInfo, rejecting a foreign issuer", () => {
		expect(caCertVerifiesLeaf(ca, new X509Certificate(leafDer))).toBe(true);
		// Positive control: the splicing path itself produces verifiable certificates,
		// so the rejections below come from the DigestInfo structure alone.
		expect(caCertVerifiesLeaf(ca, resigned(sequence(oid("sha256"), nullParameter)))).toBe(true);
		const otherKeys = generateKeyPairSync("rsa", { modulusLength: 1024 });
		const otherName = x509.encodeCommonNameName("Different issuer");
		const other = new X509Certificate(
			x509.createCertificate({
				publicKey: otherKeys.publicKey,
				signingKey: otherKeys.privateKey,
				serialNumber: Buffer.from([3]),
				notBefore: new Date("2026-01-01T00:00:00Z"),
				notAfter: new Date("2030-01-01T00:00:00Z"),
				subject: otherName,
				issuer: otherName,
				extensions: [x509.basicConstraintsExtension({ ca: true })],
			}),
		);
		expect(caCertVerifiesLeaf(other, new X509Certificate(leafDer))).toBe(false);
	});

	const malformed: Array<[string, () => Buffer]> = [
		["a nested extra element with NULL", () => sequence(oid("sha256"), nullParameter, garbage)],
		["a nested extra element without NULL", () => sequence(oid("sha256"), garbage)],
		["a nested extra sequence", () => sequence(oid("sha256"), nullParameter, sequence(garbage))],
		["a nonempty NULL", () => sequence(oid("sha256"), der(0x05, Buffer.from("garbage")))],
		["an unterminated OID", () => sequence(der(0x06, Buffer.from("60864801650304020180", "hex")), nullParameter)],
		["a nonminimal OID", () => sequence(der(0x06, Buffer.from("60808648016503040201", "hex")), nullParameter)],
		["a mismatched digest OID", () => sequence(oid("sha384"), nullParameter)],
	];
	for (const [name, algorithm] of malformed) {
		it(`rejects a cached leaf whose DigestInfo carries ${name}`, () => {
			const leaf = resigned(algorithm());
			// The fixture really carries the malformed structure under the CA key.
			const signature = Buffer.from(leaf.raw.subarray(leaf.raw.length - MODULUS_BYTES));
			const [tbs] = x509.readDerChildren(x509.readDer(leafDer));
			const digest = createHash("sha256").update(tbs.raw).digest();
			expect(publicDecrypt({ key: keys.publicKey, padding: constants.RSA_NO_PADDING }, signature)).toEqual(
				encodedMessage(sequence(algorithm(), der(0x04, digest))),
			);
			expect(caCertVerifiesLeaf(ca, leaf)).toBe(false);
		});
	}

	it("rejects outer DigestInfo garbage and a corrupted signature", () => {
		const [tbs] = x509.readDerChildren(x509.readDer(leafDer));
		const digest = createHash("sha256").update(tbs.raw).digest();
		const outer = sequence(sequence(oid("sha256"), nullParameter), der(0x04, digest), garbage);
		expect(caCertVerifiesLeaf(ca, withSignature(leafDer, rawSignature(outer)))).toBe(false);
		expect(caCertVerifiesLeaf(ca, withSignature(leafDer, Buffer.alloc(MODULUS_BYTES, 1)))).toBe(false);
	});

	it("starts the real extension through VM.create without a forge guard", async () => {
		const callbacks = new Map<string, (event: unknown, context: ExtensionContext) => Promise<void>>();
		gondolinExtension({
			on: (event: string, callback: unknown) =>
				callbacks.set(event, callback as (event: unknown, context: ExtensionContext) => Promise<void>),
			registerTool: () => {},
			registerCommand: () => {},
		} as unknown as ExtensionAPI);
		const context = {
			ui: { setStatus: () => {}, theme: { fg: (_color: string, text: string) => text } },
		} as unknown as ExtensionContext;
		const create = vi.spyOn(VM, "create").mockImplementation(async () => {
			throw new Error("Synthetic VM stop: no hypervisor or network started");
		});
		try {
			await expect(callbacks.get("session_start")?.({}, context)).rejects.toThrow("Synthetic VM stop");
			expect(create).toHaveBeenCalledOnce();
		} finally {
			create.mockRestore();
		}
	});
});
