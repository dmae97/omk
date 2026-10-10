import { describe, expect, it } from "vitest";
import { rtkFilterForCommand } from "../src/core/tools/rtk-output.ts";

describe("RTK narrow command selection", () => {
	it.each([
		["vitest run test/x.test.ts", "vitest"],
		["node ../../node_modules/vitest/dist/cli.js --run test/x.test.ts", "vitest"],
		["tsc --noEmit", "tsc"],
		["tsgo --noEmit", "tsc"],
		["node node_modules/@typescript/native-preview/bin/tsgo.js --noEmit", "tsc"],
	])("selects %s", (command, expected) => expect(rtkFilterForCommand(command)).toBe(expected));
	it.each([
		"echo vitest --run",
		"npm test",
		"npx vitest run",
		"node -e vitest --run",
		"vitest --watch",
		"vitest --help",
		"vitest run -h",
		"vitest run -v",
		"vitest run --watch=true",
		"vitest run --help=true",
		"tsc --noEmit -h",
		"tsc --noEmit -v",
		"tsc --noEmit -w",
		"tsc --noEmit --watch=false",
		"tsc --noEmit --all",
		"tsc --noEmit --showConfig",
		"tsc --noEmit --HELP",
		"vitest run -V",
		"node node_modules/typescript/bin/tsc --noEmit -h",
		"tsc --version",
		"vitest run | cat",
		"vitest run && echo ok",
		"vitest run > result",
		"vitest run $(echo x)",
		"vitest run 'test/foo.test.ts'",
		"tsc",
		"node scripts/custom.js --noEmit",
	])("leaves %s raw", (command) => expect(rtkFilterForCommand(command)).toBeUndefined());
});
