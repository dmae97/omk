---
name: react-doctor
description: React, Next.js, Vite, and React Native diagnostics workflow adapted from millionco/react-doctor for OMK. Use for React health checks, component/effect bugs, performance regressions, accessibility issues, dead code, and agent-generated React review.
---

# react-doctor

Source basis: millionco/react-doctor at commit 8556b31d8e4e165f791db0aa60a6b038b18ec777. This OMK skill is a compact adaptation, not a vendored copy of upstream prompts or code.

## Use when

- Reviewing or debugging React, Next.js, Vite, Expo, or React Native code.
- A change touches hooks, effects, memoization, render paths, accessibility, security, or generated UI code.
- The user asks for a React health score or agent-written React audit.

## OMK workflow

1. Detect framework, package manager, React version, app routes, and existing lint/test/build scripts.
2. Read the smallest relevant component, hook, route, and test set. Check loading, error, empty, and responsive states.
3. Run existing local gates first: lint, typecheck, targeted tests, and build when available.
4. If external package execution is acceptable for the task, run React Doctor from the project root and capture its score/findings. Prefer diff mode for PR review.
5. Fix high-signal issues before suppressing rules. Use the narrowest config override when a warning is intentional.
6. Re-run the same diagnostics and include before/after score or finding count when available.

## Optional commands

```bash
npx -y react-doctor@latest .
npx -y react-doctor@latest --fail-on warning
```

## Output contract

Return:

- framework and package manager detected
- gates run and React Doctor result if run
- findings fixed vs intentionally deferred
- accessibility/performance/security notes
- remaining risks

## Guardrails

- Do not add broad ignores such as whole generated folders unless justified.
- Do not replace existing lint/test policy with React Doctor; use it as an extra signal.
- Do not run network/package-install commands in restricted environments without explicit user approval.
