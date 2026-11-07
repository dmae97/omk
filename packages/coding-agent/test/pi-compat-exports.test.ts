import { describe, expect, it } from "vitest";
import { CONFIG_DIR_NAME } from "../src/config.ts";
import * as publicIndex from "../src/index.ts";

// Upstream Pi extensions import these from "@earendil-works/pi-coding-agent", which OMK aliases
// to this index. A missing export arrives as `undefined`: SuPi then reads "~/undefined/agent/supi".
describe("public index upstream-Pi parity", () => {
	it("exports CONFIG_DIR_NAME", () => {
		expect(publicIndex.CONFIG_DIR_NAME).toBe(CONFIG_DIR_NAME);
	});
});
