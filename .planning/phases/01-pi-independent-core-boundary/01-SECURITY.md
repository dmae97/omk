---
phase: "01"
slug: pi-independent-core-boundary
status: verified
threats_open: 0
threats_open_total: 0
asvs_level: 1
register_authored_at_plan_time: false
created: 2026-11-05
---

# Phase 1 managed-package selection security review

Final independent security closure verifies all six threats closed, including
B01-D01 after the directory/branch correction. Final code review also resolves
CR-01, CR-02 and CR-03. The register is retrospective because the
plan did not contain a formal threat model. Review depth is ASVS L1 with blocking
severity `high`, not a certification of extension isolation.

## Trust boundaries

| Boundary | Data crossing | Scope |
|---|---|---|
| Constructor caller to package manager | Optional manifest dialect | Validate and copy the selected primitive |
| Package file to manifest resolver | JSON, resource keys and paths | Decode, enforce authority and retain path validation |
| Resolver to resource discovery | Manifest selection or policy rejection | Keep rejection terminal before filtering or fallback |
| Discovery to extension loading | Selected paths | Preserve existing project trust and permissions |

## Threat register

Paths in the evidence column are relative to `packages/coding-agent`.

| Threat ID | Category | Severity | Disposition | Mitigation and evidence | Status |
|---|---|---|---|---|---|
| B01-S01 | Spoofing | high | mitigate | Recursive terminal policy at `src/core/package-extension-entries.ts:103-123`; real wrapper/sentinel controls at `test/package-manifest-auto-boundary.test.ts:50-83` | closed |
| B01-T01 | Tampering | medium | mitigate | Dialect validation at `src/core/package-manifest.ts:10-15`; copied primitive at `src/core/package-manager.ts:529-535`; mutation controls in the boundary test | closed |
| B01-T02 | Tampering | high | mitigate | Own-key authority at `src/core/package-manifest.ts:109-120`; manager validation before filters/fallback at `src/core/package-manager.ts:1956,2067-2087` | closed |
| B01-I01 | Information disclosure | high | mitigate | Preserved lexical validation at `src/core/package-manifest.ts:51-55,74-100,119`; manager diagnostic rejection at `src/core/package-manager.ts:2084-2087` | closed |
| B01-D01 | Denial of service | medium | mitigate | Branch-local ancestry/depth64 and shared collection at `src/core/package-extension-entries.ts:91-97,114-123,143-187`; final canonical deduplication at `src/core/package-manager.ts:2385-2391`; directory/branch order controls pass | closed |
| B01-E01 | Elevation of privilege | high | mitigate | Preserved trust calls at `src/core/package-manager.ts:637,2220-2221`; script opt-in at `:539,1532,1541` and suppression at `src/core/package-install-args.ts:20,45-46` | closed |

Policy evaluation remains outside the JSON-decoding catch at
`src/core/package-manifest.ts:128-138`. The auditor found no new Repudiation
behavior in this diff and no unregistered threat flag requiring disposition.

## Accepted risks log

None. No risk was accepted or transferred on the operator's behalf.

## Evidence and limitations

- The final auditor confirmed all ten owned-file digests against the latest
  `verification-main.json` in `omk-native-branch-correction-NnqXllJa` under the
  approved temporary root, with ten non-owned originals and HEAD/index preserved.
- The final audit reused the observed 266-test targeted pass and root-check result
  of 555 passed script tests, 30 skipped and zero failed. It did not rerun tests.
- Path findings establish preserved lexical validation, not filesystem isolation.
- Trust findings establish preserved call sites, not downstream authorization correctness.
- Direct imports, installation trust, sandboxing, aliases, installed binaries and
  R parity remain outside this phase's acceptance.

## Security audit trail

| Date | Auditor | Total | Closed | Open blocking | Open non-blocking |
|---|---|---|---|---|---|
| 2026-11-05 | Independent `gsd-security-auditor` | 6 | 6 | 0 | 0 |
| 2026-11-05 | Main reopened B01-S01 from CR-01 | 6 | 5 | 1 | 0 |
| 2026-11-05 | Independent re-audit closes B01-S01 | 6 | 6 | 0 | 0 |
| 2026-11-05 | Main reopens B01-D01 from closure review | 6 | 5 | 0 | 1 |
| 2026-11-05 | Final independent closure of B01-D01 | 6 | 6 | 0 | 0 |

No implementation or test edits were made by the auditor. No commits, installs,
builds or provider calls ran as part of this audit.
