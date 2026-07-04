# Security Audit (`security-audit`)

> Inherited domain capability document. Auto-generated from `src/core/domain-loadouts.ts` — do not edit by hand.


## Identity

| field | value |
|---|---|
| id | `security-audit` |
| authority | `security-review` |
| tools | read, grep, find, ls, bash |
| command mode | `read-only-shell` |

## Routing prompt

> Prepended to the lane task prompt when the router selects this domain.

```text
DOMAIN: Security Audit. You are operating in a security-review lane (read-biased, evidence-bound).
Prioritize true-positive findings with proof, exact locations, and remediation.

SEQUENCE:
1. Scope the audit: read entry-point-analyzer output (externally callable, state-changing surfaces) before reading internals.
2. Build deep context with audit-context-building; shallow reads miss cross-file data flow.
3. Run static analysis: semgrep (custom rules via semgrep-rule-creator) + codeql for inter-procedural taint. Parse results with sarif-parsing and dedupe.
4. Verify every candidate with fp-check — return TRUE/FALSE POSITIVE with evidence, never a bare "might be vulnerable".
5. Differential scope: differential-review on the diff/PR, not just the whole tree, to catch regressions.
6. Domain lenses: constant-time-analysis + zeroize-audit for crypto; supply-chain-risk-auditor for deps; agentic-actions-auditor for CI/LLM-agent workflows; sharp-edges + insecure-defaults for misuse-prone APIs.
7. After fixes: variant-analysis to find the same bug class elsewhere.

HARD RULES: read-only by default; every finding needs file:line + exploit sketch + fix; rank by real exploitability not CWE count; secrets are reported, never printed (protect-secrets hook).
```

## Curated skills (23)

- `security-review`
- `security-scan`
- `differential-review`
- `semgrep`
- `codeql`
- `sarif-parsing`
- `semgrep-rule-creator`
- `sharp-edges`
- `supply-chain-risk-auditor`
- `spec-to-code-compliance`
- `entry-point-analyzer`
- `audit-context-building`
- `fp-check`
- `constant-time-analysis`
- `zeroize-audit`
- `agentic-actions-auditor`
- `insecure-defaults`
- `property-based-testing`
- `variant-analysis`
- `yara-rule-authoring`
- `code-maturity-assessor`
- `django-security`
- `springboot-security`

## Curated MCP servers (3)

- `filesystem`
- `github`
- `memory`

## Curated hooks (4)

- `pre-shell-guard`
- `protect-secrets`
- `stop-verify`
- `subagent-stop-audit`

## Routing triggers (21)

| kind | pattern | weight |
|---|---|---|
| keyword | `security` | 6 |
| keyword | `vulnerability` | 6 |
| keyword | `vuln` | 6 |
| keyword | `exploit` | 6 |
| keyword | `audit` | 5 |
| keyword | `cve` | 7 |
| keyword | `xss` | 6 |
| keyword | `csrf` | 6 |
| keyword | `injection` | 6 |
| keyword | `secret` | 5 |
| keyword | `leak` | 5 |
| keyword | `crypto` | 4 |
| keyword | `hardening` | 5 |
| keyword | `threat model` | 5 |
| keyword | `threat` | 5 |
| keyword | `penetration` | 6 |
| keyword | `malware` | 6 |
| keyword | `supply chain` | 6 |
| regex | `sql[ -]?inj|command[ -]?inj|path[ -]?traversal` | 7 |
| regex | `cve-\d{4}-\d+` | 8 |
| regex | `\b(authz|rbac|privilege escalation|idor)\b` | 6 |
