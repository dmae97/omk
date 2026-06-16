import { readFileSync } from "node:fs";
import { ONTOLOGY } from "../memory/local-graph-memory-store.js";

export interface GraphOntologyRelationGateIssue {
  readonly relationType: string;
  readonly file: string;
  readonly line: number;
}

export interface GraphOntologyRelationGateResult {
  readonly pass: boolean;
  readonly missing: readonly GraphOntologyRelationGateIssue[];
}

const RELATION_TYPE_ARG_PATTERN = /upsertEdge\s*\([^)]*,\s*["']([^"']+)["']\s*[,)]/g;
const RELATION_LITERAL_PATTERN = /type\s*:\s*["']([A-Z_]+)["']/g;

export function checkGraphOntologyRelations(sourceFiles: readonly string[]): GraphOntologyRelationGateResult {
  const declared = new Set(ONTOLOGY.relationTypes);
  const missing: GraphOntologyRelationGateIssue[] = [];
  const seen = new Set<string>();

  for (const file of sourceFiles) {
    let content: string;
    try {
      content = readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    const lines = content.split("\n");

    for (const [lineIndex, line] of lines.entries()) {
      const argMatches = Array.from(line.matchAll(RELATION_TYPE_ARG_PATTERN));
      for (const match of argMatches) {
        const relationType = match[1];
        if (!relationType) continue;
        if (seen.has(relationType)) continue;
        seen.add(relationType);
        if (!declared.has(relationType)) {
          missing.push({ relationType, file, line: lineIndex + 1 });
        }
      }

      const literalMatches = Array.from(line.matchAll(RELATION_LITERAL_PATTERN));
      for (const match of literalMatches) {
        const relationType = match[1];
        if (!relationType) continue;
        if (seen.has(relationType)) continue;
        seen.add(relationType);
        if (!declared.has(relationType)) {
          missing.push({ relationType, file, line: lineIndex + 1 });
        }
      }
    }
  }

  return { pass: missing.length === 0, missing };
}
