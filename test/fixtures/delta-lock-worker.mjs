import { appendDelta, loadStateViaDelta, setupDeltaMode, withDeltaLock } from "../../dist/memory/graph-delta-log.js";

const graphPath = process.argv[2];
const workerId = process.argv[3];
const N = Number.parseInt(process.argv[4] ?? "5", 10);

const emptyState = {
  version: 1,
  ontology: { version: "", classes: [], relationTypes: [], description: "" },
  project: { key: "test", name: "Test", root: "/tmp" },
  updatedAt: new Date().toISOString(),
  nodes: [],
  edges: [],
};

async function main() {
  await setupDeltaMode(graphPath, emptyState);

  for (let i = 0; i < N; i++) {
    await withDeltaLock(
      graphPath,
      async () => {
        const result = await loadStateViaDelta(graphPath, false, emptyState);
        const seq = result.lastSeq + 1;
        const now = new Date().toISOString();
        await appendDelta(
          graphPath,
          result.epoch,
          seq,
          now,
          { updatedAt: now, project: emptyState.project, ontology: "" },
          {
            del: [],
            put: [
              {
                id: `node-${workerId}-${i}`,
                type: "Topic",
                labels: [],
                label: `w${workerId}-n${i}`,
                tags: [],
                properties: {},
                createdAt: now,
                updatedAt: now,
              },
            ],
          },
          { del: [], put: [] }
        );
      },
      process.env
    );
  }

  console.log(JSON.stringify({ workerId, done: true }));
}

main().catch((e) => {
  console.error(JSON.stringify({ workerId: process.argv[3], error: e.message }));
  process.exit(1);
});
