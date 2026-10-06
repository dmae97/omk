---
description: "Fix: `-p`/`--print` rejects an inline prompt that starts with a dash"
---

# Feature Specification: Dash-Led Inline Print Prompt

**Specification ID**: `028-print-prompt-dash`
**Feature Branch**: `fix/print-prompt-dash`
**Created**: 2026-10-06
**Status**: Accepted
**Constitution**: [specs/constitution.md](../constitution.md)
**Input**: In a benchmark run, `omk -p "- do something..."` (an instruction that opens with a Markdown bullet) exited immediately with `Error: Unknown option: - do something...` and exit code 1. The model never ran.
**OMK Preset**: `omk`

## CLI Harness Target Impact

**Classification**: preserve (bug fix in CLI argument parsing. It moves no harness metric beyond turning a hard failure into a run.)

| Dimension | Baseline | Acceptance target | Regression floor | Verification command | Evidence artifact |
| --- | --- | --- | --- | --- | --- |
| Reliability | `parseArgs(["-p", "- foo"])` → `print: true`, no message, error `Unknown option: - foo`. `-p "--not-a-flag text"` → unknown extension flag `not-a-flag text` → `Unknown option` exit 1 | Dash-led prose after `-p`/`--print` becomes the prompt | Known flags after `-p` stay flags. Unknown flags elsewhere still error | Focused vitest below | `packages/coding-agent/test/args.test.ts` |

## Root cause

`packages/coding-agent/src/cli/args.ts` (`parseArgs`): `--print`/`-p` is a boolean flag with an optional inline prompt. It takes the next token only when `!next.startsWith("-") || next.startsWith("---")`. A dash-led prompt is left in the loop and lands in either:

- the short-option branch (`arg.startsWith("-") && !arg.startsWith("--")`), which reports `Unknown option: <arg>`, or
- the long unknown-flag branch, which records it as an extension flag. `collectExtensionFlagDiagnostics` (`core/agent-session-services.ts`) later rejects it as `Unknown option: --<prompt>`.

`main.ts` exits 1 on any parse error.

## Goal

The token after `-p`/`--print` is its prompt unless it is an option. The rule:

| Next token | Treated as |
| --- | --- |
| absent, `--`, `@file` | not consumed (unchanged) |
| does not start with `-` | prompt (unchanged) |
| exactly `-` | not consumed (unchanged; conventional stdin placeholder, still an error) |
| starts with `---` (front matter) | prompt (unchanged) |
| a one-word dash token without whitespace (`-x`, `-foo`, `-h`, `--verbose`) | option (unchanged; a typo like `-p -x` still errors with `Unknown option`) |
| a long-option token `--name=value` whose value contains whitespace (known or extension flag) | flag (unchanged) |
| any other dash-led token containing whitespace or a newline (`- foo`, `--not-a-flag text`, multi-line `- a\n- b`) | prompt (**new**) |

To pass a one-word dash prompt or a prompt that is exactly a flag, use the existing end-of-options terminator: `omk -p -- -foo`, `omk -p -- "--verbose"`. A prompt that opens with a `--name=value` token (`"--retries=3 is wrong, fix"`) is still a flag; `omk -p -- "--retries=3 is wrong, fix"` passes it as text. Documented in `packages/coding-agent/docs/usage.md` (Modes). (Rule narrowed per Tech Lead review on #84: only whitespace-containing tokens change, so typo errors are kept.)

## Agent-Oriented Requirements

### Requirement 1 - Accept dash-led inline print prompts (Priority: P1)

**Agent**: coder
**Evidence Gate**: command-pass
**Risk**: low

**What**: Implement the rule above in `parseArgs` for `--print`/`-p` only.

**Acceptance** (each measured by a named vitest case in `packages/coding-agent/test/args.test.ts`):
1. `parseArgs(["-p", "- foo"])` → `messages: ["- foo"]`, `print: true`, zero diagnostics.
2. `parseArgs(["-p", "--", "-foo"])` → `messages: ["-foo"]`, zero diagnostics; `parseArgs(["-p", "-foo"])` and `parseArgs(["-p", "-x"])` still produce `Unknown option`.
3. `parseArgs(["-p", "--not-a-flag text"])` → `messages: ["--not-a-flag text"]`, empty `unknownFlags`.
4. A multi-line prompt `"- step one\n- step two"` after `--print` → one message, zero diagnostics.
5. Known flags after `-p` keep their meaning: every short flag literal in `args.ts` (extracted from source, so the list cannot drift) is never consumed as the prompt. `-p --provider openai "Say hi."` and `-p --ext-flag value` are unchanged.
6. Genuinely unknown flags elsewhere still error: `["-x", "-p", "hi"]` and `["-p", "hi", "-foo"]`, `["-p", "-x"]` and `["-p", "-foo"]` produce `Unknown option`. `-p -` is still an error.
7. `--` still works: `-p -- "--verbose"` → message `--verbose`, `verbose` unset. Existing positional/`--`/`@file` tests pass unchanged.

### Requirement 2 - Gates (Priority: P1)

- `npm run check` passes before each commit. Explicit-path staging. The first commit is this spec.
- `args.ts` stays under the 250 pure-LOC ceiling. Top-level imports only. No `any`.

## Non-goals

- No change to positional prompts: `omk "- foo"` without `-p` still errors as before. The documented escape is `omk -- "- foo"`. Stdin prompts are unaffected.
- No change to other options. These share the "skip a dash-led value" pattern but are out of scope: `--list-models` (optional search pattern), unknown long flags (optional extension value), `--model-contract` (rejects a dash-led path). Options with a required value (`--provider`, `--model`, `--system-prompt`, `--append-system-prompt`, `--name`, `--tools`, …) already consume the next token unconditionally.
- No change to extension-flag validation in `agent-session-services.ts`.

## Expected Files

- `specs/028-print-prompt-dash/spec.md`: this spec (first commit)
- `packages/coding-agent/src/cli/args.ts`: inline-prompt rule for `--print`/`-p`
- `packages/coding-agent/test/args.test.ts`: regression tests

## Verification Commands

- `node node_modules/vitest/dist/cli.js --run test/args.test.ts` (in `packages/coding-agent`)
- `npm run check`

## Assumptions

- Extension flags are always long (`--name`), so a dash-led token with whitespace in its name part can never be a flag.
