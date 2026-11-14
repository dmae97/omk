import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { rustHostBinding } from "../src/core/verified-run/rust-host-binding.ts";

it("requires explicit owner-controlled ELF bytes and refuses drift rather than falling back", () => {
	const root = mkdtempSync(join(tmpdir(), "rust-binding-"));
	try {
		vi.stubEnv("OMK_RUST_EXECUTION_HOST", undefined);
		expect(rustHostBinding()).toBeUndefined();
		vi.stubEnv("OMK_RUST_EXECUTION_HOST", "relative");
		expect(() => rustHostBinding()).toThrow(/unsupported_boundary/);
		const path = join(root, "fixture");
		const bytes = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0]);
		writeFileSync(path, bytes);
		vi.stubEnv("OMK_RUST_EXECUTION_HOST", path);
		chmodSync(path, 0o777);
		expect(() => rustHostBinding()).toThrow(/unsupported_boundary/);
		chmodSync(path, 0o700);
		const binding = rustHostBinding();
		expect(binding).toMatchObject({ path, protocol: "omk.execution-host.v1" });
		writeFileSync(path, Buffer.concat([bytes, Buffer.from([1])]));
		expect(() => rustHostBinding()).toThrow(/native_host_changed/);
		writeFileSync(path, bytes);
		expect(rustHostBinding()).toEqual(binding);
		vi.stubEnv("OMK_RUST_EXECUTION_HOST", undefined);
		expect(() => rustHostBinding()).toThrow(/native_host_changed/);
	} finally {
		vi.unstubAllEnvs();
		rmSync(root, { recursive: true, force: true });
	}
});
