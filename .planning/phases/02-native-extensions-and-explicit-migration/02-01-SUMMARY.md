---
phase: 02-native-extensions-and-explicit-migration
plan: "01"
subsystem: extensions
tags: [native-loader, discovery, resolution, services]
status: complete
completion-scope: plan must-haves observed on the 2026-11-08 candidate; written retroactively
completed: 2026-11-08
requirements-completed: []
---

# Phase 2 Plan 1: Native loader, discovery and resolution summary

**Retroactive summary.** The 02-01 work was integrated before 02-02 (`02-02-SUMMARY.md` lists it as a requirement), but the plan's required summary was never written. This file maps the plan's must-haves to observed results on the final 2026-11-08 candidate. It does not reconstruct the original RED/GREEN history. The planning RED baseline is in [02-VALIDATION.md](02-VALIDATION.md): five intended failures, three passes, zero harness errors.

## Evidence

Candidate `2962df3dd7df590254d4ef2067daa8c0ea80c7d746e9f221cfb10b262177b17c`. Work root: `/mnt/omkdata/tmp/opencode/omk-v2-sdk092-20261108-115739/`. Receipts: `source/native-loader.json` and `source/phase1.json`. Both groups exited 0 and had unchanged inputs before and after.

| Must-have | Observed tests |
|---|---|
| Explicit native services load an OMK factory and run its tool without implicit aliases, in Node and the source virtual-module path | `native-extension-services` (3): dialect through `createAgentSessionServices`/`DefaultResourceLoader`; source virtual-module factory via actual services. `extensions-native-import-boundary`: native OMK imports in `omk` mode across Node and Bun virtual modules |
| Installed user dependencies keep their own identity; absent packages fail ordinary resolution | `extensions-native-import-boundary`: installed local Pi dependency resolves to its own identity (Boundary A); every uninstalled legacy specifier fails in `omk` mode and loads under `omk+pi`. `extensions-native-resolution-routes` (7): installed ESM/CJS identities through helpers and subpaths, virtual and non-virtual. Artifact `installed`/`missing` cases passed under packaged Node and compiled Bun |
| Omitted and explicit compatibility keep direct-discovery behavior | `extensions-native-discovery` (10); `extensions-native-import-boundary`: dialect enforced in `discoverAndLoadExtensions` without `index.ts` fallback for Pi-only directories; artifact `compat-omitted` and `compat-explicit` cases |
| Loader construction captures dialect independently of caller mutation and reloads; default stays compatibility at 1.5.10 | `native-extension-services`: constructor policy captured independently of mutation and reloads. `extensions-native-import-boundary`: invalid untyped dialect values rejected. `extensions-native-resolution-routes`: interleaved `omk`/`omk+pi` maps isolated. Versions remain 1.5.10 and the omitted dialect remains `omk+pi` |

Group totals: native-loader 33 passed, which includes 8 `extensions-memory-lifecycle` tests from the 2026-11-06 continuation. The unchanged phase-1 ten-file group had 266 passed.

## Limits

This is plan completion only. V2-CORE-01 requires the final default to drop implicit Pi compatibility, and that remains blocked on the separate activation decision recorded in [02-06-SUMMARY.md](02-06-SUMMARY.md).
