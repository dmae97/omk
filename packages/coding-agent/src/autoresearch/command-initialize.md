Set up autoresearch for this intent:

{{intent}}

Explain briefly what autoresearch will do in this repository, then initialize the workspace.

Your first actions:
- write `autoresearch.md`
- define the benchmark entrypoint in `autoresearch.sh`
- optionally add `autoresearch.checks.sh` if correctness or quality needs a hard gate
- run `init_experiment`
- run and log the baseline
- keep iterating until interrupted or until the configured iteration cap is reached
