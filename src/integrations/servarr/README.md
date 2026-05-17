# OMK Servarr integration

OMK implements this integration as original TypeScript code. It must not copy,
fork, vendor, or translate Managarr source code because Managarr's repository
currently exposes conflicting license signals: README/Cargo metadata advertise
MIT-like licensing while the repository `LICENSE` restricts use to
non-commercial derivative terms.

Managarr is only an inspiration/reference point for UX patterns:

- multi-instance configuration
- `--config-file`
- `--servarr-name`
- CLI/TUI separation
- API token from file or environment
- JSON output that is friendly to `jq`
- health/log/task/list/search command taxonomy

## Config

Default path:

```txt
.omk/servarr.yml
```

Example:

```yaml
radarr:
  - name: local
    uri: http://localhost:7878
    api_token_env: RADARR_API_KEY

sonarr:
  - name: anime
    host: localhost
    port: 8989
    api_token_file: ./secrets/sonarr-api-token
```

Equivalent normalized form:

```yaml
instances:
  - type: lidarr
    name: music
    baseUrl: http://localhost:8686
    apiTokenEnv: LIDARR_API_KEY
```

Prefer `api_token_env` or `api_token_file` over inline tokens.

## Commands

```bash
omk servarr config-path
omk servarr instances --json
omk servarr status radarr --servarr-name local --json
omk servarr health sonarr
omk servarr logs lidarr --limit 10 --json
omk servarr tasks radarr --json
omk servarr list sonarr --json
omk servarr search radarr "Ad Astra" --json
```

Supported services are `radarr`, `sonarr`, and `lidarr`. Readarr, Prowlarr,
Bazarr, Whisparr, and Tautulli are intentionally not core OMK features.
