import { join, resolve } from "path";
import { getProjectRoot } from "../util/fs.js";
import { createGraphView } from "../memory/graph-viewer.js";
import { header, label, status } from "../util/theme.js";

export interface GraphViewCommandOptions {
  input?: string;
  output?: string;
  limit?: string;
  type?: string;
  includeMemoryVersions?: boolean;
  open?: boolean;
}

export async function graphViewCommand(options: GraphViewCommandOptions = {}): Promise<void> {
  const root = getProjectRoot();
  const inputPath = options.input ? resolve(root, options.input) : join(root, ".omk", "memory", "graph-state.json");
  const outputPath = options.output ? resolve(root, options.output) : join(root, ".omk", "memory", "graph-view.html");
  const typeFilter = options.type
    ? options.type.split(",").map((item) => item.trim()).filter(Boolean)
    : undefined;

  const result = await createGraphView({
    inputPath,
    outputPath,
    maxNodes: options.limit ? Number.parseInt(options.limit, 10) : undefined,
    includeMemoryVersions: Boolean(options.includeMemoryVersions),
    typeFilter,
    open: Boolean(options.open),
  });

  console.log(header("OMK Graph View"));
  console.log(label("Input", inputPath));
  console.log(label("Output", result.outputPath));
  console.log(label("Nodes", String(result.nodeCount)));
  console.log(label("Edges", String(result.edgeCount)));
  console.log(status.ok("Graph HTML generated"));
}
