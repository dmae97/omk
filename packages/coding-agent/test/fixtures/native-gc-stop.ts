import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

// Preload only in the test child, before the real source CLI imports node:fs.
const target = process.env.OMK_TEST_GC_HEAD;
const checkpoint = process.env.OMK_TEST_GC_CHECKPOINT;
if (!target || !checkpoint) throw new Error("GC fixture arguments");
const unlink = fs.unlinkSync;
fs.unlinkSync = (path) => {
	if (String(path) === target) {
		fs.writeFileSync(checkpoint, "retired");
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
	}
	unlink(path);
};
syncBuiltinESMExports();
