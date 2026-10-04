# OMK landing

Existing static product landing for the OMK coding-agent CLI:

- dark canvas, serif hero, mono meta
- sticky top nav + install CTA
- clearly labelled illustrative goal acceptance workflow
- feature bento with existing `readmeasset` demos
- install panel + FAQ

## Local preview

```bash
python3 -m http.server 4173 --directory landing
# open http://127.0.0.1:4173/
```

Assets are vendored under `landing/assets/` (from `readmeasset/`).

## Notes

- Not wired into npm package publish surface.
- Copy tracks root README positioning for v1.3.0: one agent by default,
  configured provider switching, saved sessions, and approved goal acceptance
  checks. Subagent and protocol workflows are opt-in.
- The workflow panel is an illustration, not a live run or benchmark. Existing
  interface and animation assets are archived examples, labelled as such.
- Install commands use npm latest rather than a historical pinned release.
- The primary try link opens the GitHub quickstart. The candidate GitHub Pages
  URL returned 404 during the 2026-10-04 audit; do not use it in outreach until
  a deployment is confirmed.
