import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadMemorySettings } from "../dist/memory/memory-config.js";
import { MemoryStore } from "../dist/memory/memory-store.js";
import {
  ONTOLOGY_NODE_TYPES,
  ONTOLOGY_RELATIONSHIP_TYPES,
  buildKuzuOntologySchema,
} from "../dist/memory/ontology-model.js";

test("local graph memory is the default backend", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-local-graph-default-"));
  try {
    const settings = await loadMemorySettings(projectRoot, { OMK_MEMORY_FORCE: "0" });

    assert.equal(settings.backend, "local_graph");
    assert.equal(settings.localGraph.ontology, "omk-ontology-mindmap-v1");
    assert.match(settings.localGraph.path, /graph-state\.json$/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("stale Neo4j config is ignored without warnings", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-local-graph-legacy-"));
  const warnings = [];
  const previousWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.join(" "));
  };

  try {
    await mkdir(join(projectRoot, ".omk"), { recursive: true });
    await writeFile(
      join(projectRoot, ".omk", "config.toml"),
      '[memory]\nbackend = "neo4j"\n\n[neo4j]\nusername = "legacy-user"\n'
    );

    const settings = await loadMemorySettings(projectRoot, { OMK_MEMORY_FORCE: "0" });
    assert.equal(settings.backend, "local_graph");
    assert.deepEqual(warnings, []);
  } finally {
    console.warn = previousWarn;
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("local graph memory writes ontology mindmaps and GraphQL-lite results", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-local-graph-"));
  const graphPath = join(projectRoot, ".omk", "memory", "graph-state.json");
  const env = {
    OMK_MEMORY_BACKEND: "local_graph",
    OMK_MEMORY_FORCE: "0",
    OMK_MEMORY_STRICT: "true",
    OMK_LOCAL_GRAPH_PATH: graphPath,
  };
  const store = new MemoryStore(join(projectRoot, ".omk", "memory"), {
    projectRoot,
    sessionId: "test-session",
    source: "node-test",
    env,
  });

  try {
    await store.write(
      "project.md",
      `# Goal: local graph memory\n\n- Decision: keep memory in .omk/memory/graph-state.json\n- Task: expose omk_graph_query\n- Run ID: graph-audit-run\n- Audit link: [run report](.omk/runs/graph-audit-run/report.md)\n- Provider attempts: kimi=1, deepseek=1\n- Evidence gate: review-pass\n- Risk: never store secrets\n\n\`\`\`bash\nnpm run check\n\`\`\``
    );

    assert.equal(existsSync(graphPath), true);
    assert.match(await store.read("project.md"), /local graph memory/);

    const ontology = await store.ontology();
    assert.ok(ontology?.classes.includes("Decision"));
    assert.ok(ontology?.classes.includes("ProviderRoute"));
    assert.ok(ontology?.classes.includes("Run"));
    assert.ok(ontology?.classes.includes("AuditLink"));
    assert.ok(ontology?.relationTypes.includes("HAS_PROVIDER_ROUTE"));
    assert.ok(ontology?.relationTypes.includes("HAS_RUN"));
    assert.ok(ontology?.relationTypes.includes("HAS_AUDIT_LINK"));

    const mindmap = await store.mindmap("Decision", 20);
    assert.ok(mindmap?.nodes.some((node) => node.type === "Decision"));
    assert.ok(mindmap?.edges.some((edge) => edge.type === "HAS_DECISION" || edge.type === "HAS_CONCEPT"));

    const auditMindmap = await store.mindmap("graph-audit-run", 30);
    assert.ok(auditMindmap.nodes.some((node) => node.type === "Run"));
    assert.ok(auditMindmap.nodes.some((node) => node.type === "AuditLink"));
    assert.ok(auditMindmap.nodes.some((node) => node.path === ".omk/runs/graph-audit-run/report.md"));
    assert.ok(auditMindmap.edges.some((edge) => edge.type === "HAS_RUN"));
    assert.ok(auditMindmap.edges.some((edge) => edge.type === "HAS_AUDIT_LINK"));

    const graphQuery = await store.graphQuery('query { mindmap(query: "Task", limit: 10) { nodes edges } ontology { classes } }');
    assert.equal(graphQuery.extensions.dialect, "omk-graphql-lite-v1");
    assert.match(JSON.stringify(graphQuery.data), /Task/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("Kuzu ontology schema includes provider routing and fallback tables", () => {
  const schema = buildKuzuOntologySchema();

  assert.ok(ONTOLOGY_NODE_TYPES.includes("Provider"));
  assert.ok(ONTOLOGY_NODE_TYPES.includes("ProviderRoute"));
  assert.ok(ONTOLOGY_NODE_TYPES.includes("ProviderFallback"));
  assert.ok(ONTOLOGY_NODE_TYPES.includes("Run"));
  assert.ok(ONTOLOGY_NODE_TYPES.includes("AuditLink"));
  assert.ok(ONTOLOGY_RELATIONSHIP_TYPES.includes("USES_PROVIDER"));
  assert.ok(ONTOLOGY_RELATIONSHIP_TYPES.includes("HAS_PROVIDER_FALLBACK"));
  assert.ok(ONTOLOGY_RELATIONSHIP_TYPES.includes("HAS_RUN"));
  assert.ok(ONTOLOGY_RELATIONSHIP_TYPES.includes("HAS_AUDIT_LINK"));
  assert.ok(schema.nodeTables.some((ddl) => ddl.includes("CREATE NODE TABLE OmkProviderRoute")));
  assert.ok(schema.nodeTables.some((ddl) => ddl.includes("CREATE NODE TABLE OmkRun")));
  assert.ok(schema.nodeTables.some((ddl) => ddl.includes("CREATE NODE TABLE OmkAuditLink")));
  assert.ok(schema.relTables.some((ddl) => ddl.includes("ROUTES_TO")));
  assert.ok(schema.relTables.some((ddl) => ddl.includes("FALLS_BACK_TO")));
  assert.ok(schema.relTables.some((ddl) => ddl.includes("HAS_AUDIT_LINK")));
});
