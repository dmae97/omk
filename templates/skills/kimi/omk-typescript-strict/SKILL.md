---
name: omk-typescript-strict
description: TypeScript strict-mode development standards for Next.js, NestJS, Node.js, React, and full-stack projects.
---

## TypeScript Rules

- Assume `strict: true`.
- Do not use `any` unless explicitly justified.
- Prefer `unknown` with narrowing over `any`.
- Define return types for exported functions.
- Avoid type assertions unless unavoidable.
- Prefer discriminated unions for state machines.
- Keep DTO, domain, persistence, and API response types separate.
- Do not weaken `tsconfig` to pass builds.

## Next.js

- Keep server/client boundaries explicit.
- Do not use browser APIs in server components.
- Validate route params and search params.
- Avoid unnecessary client components.

## NestJS

- Keep controller thin.
- Put business logic in services.
- Validate DTOs.
- Avoid leaking ORM entities as API responses.

## Output When Reviewing

```txt
Type issues:
Boundary issues:
Unsafe casts:
Suggested fix:
```
