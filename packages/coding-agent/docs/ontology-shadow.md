# Ontology shadow index

The ontology shadow index is an experimental, default-off comparison lane for Context Budget V2. It indexes approved metadata for context files and skills already admitted by the native resource loader, runs a bounded shadow query, and compares resource IDs with the native plan. It does not scan a second repository, select prompt content, authorize work, or prove a performance improvement.

## Enable

Set both the native Context Budget and the shadow lane:

```bash
export OMK_CONTEXT_GOVERNOR=1
export OMK_ONTOLOGY_SHADOW=1
```

`OMK_ONTOLOGY_SHADOW` is exact-opt-in: only `1` enables it. Context Budget off also disables the shadow completely. Fully disabled operation does not resolve Git scope, compile store schemas, or read/write a store.

## Scope and freshness

The store lives below the real Git common directory in `omk/ontology-shadow/<scope-id>.json`. The opaque scope ID hashes the real common Git directory and real worktree Git directory, so linked worktrees do not share mutable shadow state. HEAD is deliberately excluded from scope identity.

HEAD is instead part of the revision. A query is a stale cache miss when any of these differ:

- HEAD;
- resource content hashes;
- the shadow policy hash, including the native selection policy;
- the shadow producer version;
- the scope ID or validated store schema.

Writes use the existing durable atomic rename path with private file permissions. Reads and writes fail soft: an unavailable, malformed, oversized, or stale store cannot change or reject the native prompt.

## Stored data and bounds

The store contains resource kind, name, approved description, opaque location/content hashes, and optional `contains` or `references` relations. It does not persist raw queries, prompts, commands, file contents, absolute paths, or provider data.

Current bounds are:

- 256 resources and 512 relations per store;
- 1 MiB serialized store;
- 2,048 query UTF-16 code units and 64 relevance tokens;
- 16 query results by default, with a hard maximum of 32;
- 2 seconds for each Git scope/HEAD probe.

The only allowed relation filters are `contains` and `references`. Unknown fields, relation types, and over-limit persisted entries fail schema validation.

## Read-only comparison

`AgentSession.ontologyShadowObservation` exposes the latest comparison, or `null` when no shadow observation ran. It contains status, scope and query hashes, candidate hashes, selected resource IDs, and native-only/shadow-only ID differences. It never supplies replacement prompt items.

SDK consumers can use the same bounded store query directly:

```typescript
import {
  queryOntologyShadowStore,
  resolveOntologyShadowHead,
  resolveOntologyShadowScope,
} from "open-multi-agent-kit";

const scope = resolveOntologyShadowScope(cwd);
const result = queryOntologyShadowStore(scope, {
  head: resolveOntologyShadowHead(cwd),
  resources, // approved OntologyShadowResource metadata
  text: "repository cache audit",
  limit: 16,
});
```

`result.status` is `fresh` only when the persisted revision matches all freshness inputs. `selectedIds` is empty for a stale miss. Store writes are available through `writeOntologyShadowStore` for an explicitly enabled producer; normal AgentSession shadow operation maintains its own store automatically.

## Rollback and evidence boundary

Unset `OMK_ONTOLOGY_SHADOW` to return to the native path. Existing store files are inert while disabled and can be removed separately if no longer needed. Do not treat shadow agreement as correctness proof, shadow disagreement as a native defect, or either as a measured latency/token improvement. Those claims require separate controlled evidence.
