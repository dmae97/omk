---
name: omk-site
description: Build, modify and validate websites in the existing repository. Preserve its framework and pinned dependencies, verify local previews with DOM or compatible vision tools, and distinguish local build, preview and production deployment.
---

# Site implementation and verification

## Bound the change

Inspect the existing repository instructions, package manifest, lockfile, routes, design tokens and target page before editing. Preserve the current framework, version pins and component conventions. Do not replace the application just to match a familiar stack. Define the requested pages, interactions, responsive breakpoints and acceptance checks. Treat a reference site as design evidence, not permission to copy private assets or credentials.

Use the existing local build and preview commands. Bind previews to loopback unless a public preview was approved. Do not install dependencies, launch paid cloud browsers or publish a service merely because a skill recommends them. External APIs, images and fonts need an approved source and reproducible configuration; never invent keys or environment values.

## Implement a complete vertical slice

Make the smallest complete change covering data input, validation, loading, success, empty and error states. Reuse shared tokens and accessible components. Keep controls keyboard reachable, labels associated with inputs, focus visible, and layout usable at narrow widths. Validate untrusted input on the authoritative server boundary as well as in the interface where relevant.

Write targeted tests for the changed behavior. Run the actual repository lint/typecheck/build commands within the approved scope. Record command, exit status and artifact path. A successful compiler does not prove the page is usable.

## Preview loop

Use `../omk-browser/SKILL.md`. Open the local preview through the connected browser and test the requested flows. Check at representative narrow, medium and wide viewport sizes, including empty and long content. Inspect console/network errors only through tools that are actually available. Re-observe after each edit that affects the acceptance criteria.

A vision-capable model may inspect rendered screenshots. A text-only model uses accessibility/DOM state, element geometry, overflow measurements, forms and link targets. Do not claim screenshot-level visual approval without inspecting images. Do not invent a localhost URL or claim the server is running without a successful observation.

## Release boundary

Distinguish four outcomes: source changed, checks passed, preview verified, production deployed. Production requires the user's deployment authorization, the existing project/environment, successful release checks and a post-deployment smoke test. Do not create an unrelated hosting project, change secrets, expand permissions or bypass failing CI. If release is blocked, preserve the patch and report the exact failing gate rather than calling the work deployed.
