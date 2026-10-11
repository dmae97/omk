#!/usr/bin/env bash
# Interleaved A/B for spec 043: main worktree (BASE_ROOT) vs branch worktree (BRANCH_ROOT), one worker at a time.
# Scenarios (SCENARIOS, space separated):
#   fast  - mock answers at once: time to first request
#   slow  - mock holds the answer 2,000 ms: idle RSS while waiting
#   tool  - turn 1 is one `read` tool call, turn 2 is final text: wall time to exit and peak RSS
# PAIRS pairs per scenario (default 20, order alternates per pair), one warm-up per arm and scenario.
# C16_REPS batches of 16 workers at once per arm on the fast mock (default 3, 0 skips), interleaved.
# At the end analyze-ab.mjs writes pairs.tsv (and conc16.tsv) into the run dir and $OUT for paired_verdict.py.
# LABEL names the raw dir ($OUT/raw/<LABEL>-HHMMSS, OUT defaults to ./out, git-ignored). Pause gate: waits while PAUSE_FILE exists.
set -u
[ -d /workspace/tools/node-v22.23.3-linux-x64/bin ] && export PATH=/workspace/tools/node-v22.23.3-linux-x64/bin:$PATH
HERE=$(cd "$(dirname "$0")" && pwd); cd "$HERE"
BASE_ROOT=${BASE_ROOT:-/workspace/omk-worker-diet-base}
BRANCH_ROOT=${BRANCH_ROOT:-/workspace/omk-worker-diet}
PAIRS=${PAIRS:-20}; C16_REPS=${C16_REPS:-3}; SCENARIOS=${SCENARIOS:-"fast slow tool"}; LABEL=${LABEL:-ab}
PAUSE_FILE=${PAUSE_FILE:-/workspace/omk-perf-workers/perf-workers/PAUSE}
OUT=${OUT:-$HERE/out}; D=$OUT/raw/$LABEL-$(date +%H%M%S); mkdir -p "$D"; echo "$D" > "$OUT/LATEST"
{ echo "base $(git -C "$BASE_ROOT" rev-parse HEAD)"; echo "branch $(git -C "$BRANCH_ROOT" rev-parse HEAD)"; echo "pairs $PAIRS scenarios $SCENARIOS c16_reps $C16_REPS"; } > "$D/meta.txt"
gate() { while [ -e "$PAUSE_FILE" ]; do echo "paused $(date +%T)" >> "$D/pause.log"; sleep 15; done; }
cond() { { echo "== $1 $(date +%T.%N)"; cat /proc/loadavg; ps -eo pid,pcpu,rss,args --sort=-pcpu | head -6 | cut -c1-140; } >> "$D/conditions.log"; }
nice -n 10 node mock-server.mjs 18771 0 "$D/mock-fast.jsonl" > "$D/mock-fast.out" 2>&1 & MF=$!
nice -n 10 node mock-server.mjs 18772 2000 "$D/mock-slow.jsonl" > "$D/mock-slow.out" 2>&1 & MS=$!
nice -n 10 node mock-server-tool.mjs 18773 "$D/mock-tool.jsonl" > "$D/mock-tool.out" 2>&1 & MT=$!
sleep 1
port() { case $1 in fast | c16) echo 18771;; slow) echo 18772;; tool) echo 18773;; esac; }
mockv() { case $1 in c16) echo fast;; *) echo "$1";; esac; }
run() { # arm scenario rep [workers]
	local root; [ "$1" = base ] && root=$BASE_ROOT || root=$BRANCH_ROOT
	gate; cond "$1 $2 $3" "$D"
	HARNESS_ROOT=$root HARNESS_ENV_DIR=$OUT/env HARNESS_ARM=$1 nice -n 10 node harness.mjs "$D" "$(mockv "$2")" "$(port "$2")" "${4:-1}" "$1-$2-r$3" >> "$D/harness.log" 2>&1
}
for s in $SCENARIOS; do run base "$s" w0; run branch "$s" w0; done
for i in $(seq 1 "$PAIRS"); do
	if [ $((i % 2)) -eq 1 ]; then A=base; B=branch; else A=branch; B=base; fi
	for s in $SCENARIOS; do run $A "$s" "$i"; run $B "$s" "$i"; done
done
for i in $(seq 1 "$C16_REPS"); do
	if [ $((i % 2)) -eq 1 ]; then A=base; B=branch; else A=branch; B=base; fi
	run $A c16 "$i" 16; sleep 2; run $B c16 "$i" 16; sleep 2
done
kill $MF $MS $MT; wait 2>/dev/null
echo DONE >> "$D/harness.log"
node analyze-ab.mjs "$D" "$OUT" > "$D/summary.md" 2>&1
