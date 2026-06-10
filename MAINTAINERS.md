# Maintainers

## Core Team

- **dmae97** — Lead Maintainer ([GitHub](https://github.com/dmae97))

## Release Process

1. Ensure CI passes on the `main` branch.
2. Update `CHANGELOG.md` with release notes.
3. Run local gates: `npm run verify && npm run audit:package`.
4. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.
5. The Release workflow handles the rest.

## CI / CD

- Pull requests trigger `.github/workflows/ci.yml` and `.github/workflows/omk-review.yml`.
- Pushing a `v*` tag triggers `.github/workflows/release.yml`.
- See individual workflow files for job details.
