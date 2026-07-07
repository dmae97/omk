# Source — taste-skill (vendored)

This directory vendors the third-party `taste-skill` skill bundle into the OMK
repository under `.omk/skills/taste-skill/`. The upstream project is MIT-licensed
(see `LICENSE`, `Copyright (c) 2026 Leonxlnx`).

## Upstream

- **Repository**: https://github.com/Leonxlnx/taste-skill
- **License**: MIT (`Copyright (c) 2026 Leonxlnx`)
- **Pinned commit**: `b17742737e796305d829b3ad39eda3add0d79060`
- **Pinned as upstream HEAD on**: 2026-07-05
- **Tags at pin time**: none (commit hash is the only stable pin)

## What is vendored

The full upstream `skills/` tree is copied verbatim (folder structure preserved
to keep future refresh diffs minimal). 13 skill folders, each with a `SKILL.md`:

| Folder (upstream)         | Skill `name` (frontmatter)    |
| ------------------------- | ----------------------------- |
| `brandkit/`               | `brandkit`                    |
| `brutalist-skill/`        | `industrial-brutalist-ui`     |
| `gpt-tasteskill/`         | `gpt-taste`                   |
| `image-to-code-skill/`    | `image-to-code`               |
| `imagegen-frontend-mobile/` | `imagegen-frontend-mobile`  |
| `imagegen-frontend-web/`  | `imagegen-frontend-web`       |
| `minimalist-skill/`       | `minimalist-ui`               |
| `output-skill/`           | `full-output-enforcement`     |
| `redesign-skill/`         | `redesign-existing-projects`  |
| `soft-skill/`             | `high-end-visual-design`      |
| `stitch-skill/`           | `stitch-design-taste`         |
| `taste-skill/`            | `design-taste-frontend`       |
| `taste-skill-v1/`         | `design-taste-frontend-v1`    |

`skills/llms.txt` and `skills/stitch-skill/DESIGN.md` are upstream artifacts
inside the `skills/` tree and are carried along unchanged.

## Acquisition method (reproducible)

```sh
# Confirm the pinned commit is reachable / is upstream HEAD:
git ls-remote https://github.com/Leonxlnx/taste-skill.git HEAD
# -> b17742737e796305d829b3ad39eda3add0d79060

# Shallow clone at the pin:
git clone --depth 1 https://github.com/Leonxlnx/taste-skill.git /tmp/taste-skill-pin
cd /tmp/taste-skill-pin && git rev-parse HEAD
# -> b17742737e796305d829b3ad39eda3add0d79060

# Copy LICENSE + the whole skills/ tree verbatim:
mkdir -p .omk/skills/taste-skill
cp /tmp/taste-skill-pin/LICENSE .omk/skills/taste-skill/LICENSE
cp -R /tmp/taste-skill-pin/skills .omk/skills/taste-skill/skills
```

Integrity at vendor time was confirmed by `diff -rq` between the pin clone and
the local working clone — byte-identical for `LICENSE` and the entire `skills/`
tree.

## Re-evaluation guidance

The upstream project had **no release tags** at pin time and states it is pre-
`v2.0.0`-stable, so breaking changes to skill shape, frontmatter, or folder
layout are possible before `v2.0.0`. Before refreshing this vendored copy:

1. Re-run `git ls-remote` and capture the new HEAD.
2. Shallow clone, then `diff -rq` the new `skills/` against the vendored copy.
3. Re-validate every `SKILL.md` frontmatter against OMK rules:
   `name` ≤ 64 chars, matches `^[a-z0-9-]+$`; `description` ≤ 1024 chars.
4. Update the pinned commit hash and date in this file.
