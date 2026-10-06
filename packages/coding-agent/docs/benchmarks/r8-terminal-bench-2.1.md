# Terminal-Bench 2.1: OMK vs mini-swe-agent

A single paired run of OMK against mini-swe-agent on Terminal-Bench 2.1 with
the same model. OMK passed more tasks, but the difference is **not
statistically significant**. OMK cost less per trial and took longer per trial.
This is one dated comparison, not a leaderboard result or a SOTA claim.

## Setup

| Item | Value |
| --- | --- |
| Run | R8 |
| Benchmark | Terminal-Bench 2.1, 89 tasks |
| Trials | 3 per task per harness (89 × 3 × 2 = 534 units) |
| Model | xAI `grok-4.7`, reasoning effort `xhigh`, for both harnesses |
| Run window | 2026-10-05 12:21 KST to 2026-10-06 20:40 KST; every unit finished |
| OMK | 1.3.0 evaluation build, commit `78cc483` (see below) |
| mini-swe-agent | 2.4.6 (pinned), run through Harbor |
| Runner | [Harbor](https://www.harborframework.com/docs/tutorials/running-terminal-bench) with our own scheduler and OMK adapter |

**OMK build.** Commit `78cc483` is a local evaluation branch: `main` at
`8baa743` (#39, version 1.3.0) plus pull requests #42–#45 and #47–#54, and three
follow-up commits. #50–#52 have since been merged; the others were still open
on 2026-10-06. The commit is not on `main`, and the result does not describe the
published npm package exactly. OMK ran headless in print mode (`omk -p`) through
our Harbor adapter.

**Pairing and order.** All first trials ran before any second trials, then all
third trials. Within a trial round the two harnesses ran back to back on each
task. Both harnesses ran behind the same network allowlist and apt cache proxy.

**Scoring.** The task's verifier reward is the score. Confidence intervals are
task-level paired bootstrap intervals (10,000 resamples): each task contributes
its 3-trial mean for each harness.

## Results

Primary result: contaminated trials score 0 and `prove-plus-comm` is excluded
from both sides (88 tasks). See [Audit](#audit) for both corrections.

| Measure | OMK | mini-swe-agent | Difference (OMK − mini) |
| --- | --- | --- | --- |
| Raw score (89 tasks) | 75.3% (201/267) | 73.4% (196/267) | +1.9 pp [−4.9, +8.2] |
| **Primary** (88 tasks) | **75.8% (200/264)** | **71.6% (189/264)** | **+4.2 pp [−1.9, +10.2]** |
| Sensitivity: also excluding `pytorch-model-recovery` (87 tasks) | 76.6% (200/261) | 71.3% (186/261) | +5.4 pp [0.0, +10.7] |
| Medium tasks (55) | 81.8% | 77.0% | +4.8 pp [−2.4, +12.1] |
| Hard tasks (30) | 64.4% | 62.2% | +2.2 pp [−8.9, +13.3] |
| Easy tasks (3) | 77.8% | 66.7% | +11.1 pp (sample too small) |
| Per-task outcome (88 tasks) | OMK ahead on 22 | mini ahead on 14 | 52 ties |
| Cost | $155.04 / 267 trials = **$0.581 per trial** | $202.65 / 267 trials = **$0.759 per trial** | OMK about 23% cheaper |
| Median wall time per trial | **482 s** | **376 s** | OMK slower |

Per-difficulty rows use the primary correction. Every reported 95% interval
includes zero; the sensitivity row's lower bound is exactly 0.0. None of these
differences is statistically significant.

Cost is the provider-reported cost (`cost_in_usd_ticks`) summed over all 267
trials per harness. It excludes 42 calls that code run inside one mini-swe-agent
task made to other models through the request relay (see audit item 2).

## Audit

1. **Infrastructure errors.** Two transient provider errors (one per harness)
   were retried with the same task and trial number and then graded normally.
   No trial was excluded. The relay recorded 12,035 successful responses and
   7 server errors, all absorbed by retries.
2. **Contamination.** Under the official rule, a trial that tries to read
   Terminal-Bench sources or reference answers scores 0.
   - mini-swe-agent: 5 trials flagged (`count-dataset-tokens` r1, `extract-elf`
     r3, `headless-terminal` r2 and r3, `torch-pipeline-parallelism` r2). The 4
     of them that had passed were set to 0.
   - OMK: 2 trials flagged (`db-wal-recovery` r1 and r3, which requested the
     task's reference solution from the upstream Terminal-Bench repository).
     The one that had passed (r1) was set to 0.
   - Not corrected (false positives): copied "Terminal-Bench" canary or PRODID
     strings in `constraints-scheduling` and `custom-memory-heap-crash`, and one
     comment line in OMK's `constraints-scheduling` r3.
   - mini-swe-agent `financial-document-processor` r2, already scored 0: code it
     ran inside the task called other models through the relay. No score
     effect; those 42 calls are left out of the cost.
3. **Harness defects found during the audit.**
   - `prove-plus-comm`: our OMK adapter changed into a fixed directory, but
     this task uses a different working directory, so OMK never started (all 3
     trials ended in 0.1 s with no log). This is a fault in our harness, so the
     task is excluded from both sides in the primary result.
   - `pytorch-model-recovery`: the task instruction starts with `- `, and the
     OMK CLI exited immediately with `Unknown option` (all 3 trials, 1.5 s).
     This is an OMK bug (or the adapter not passing `--`), so the primary result
     keeps these trials as 0; only the sensitivity row drops the task. The CLI
     fix is in open pull request #84.
4. **Extra time for OMK.** OMK alone had 150 s added to its time budget to save
   a workspace snapshot for pre-check rescoring. On the same 195 trials the
   pre-check snapshots scored 82.1% versus 83.6% final. The run report
   concludes the extra time did not inflate the score. The official score is
   the final reward.

## Caveats

- **Not significant.** The primary difference is +4.2 pp with a 95% interval
  of [−1.9, +10.2]. Treat it as "no detectable difference at this sample size".
- **Unequal time budget.** OMK's extra 150 s and pre-check rescoring were not
  given to mini-swe-agent. Under the
  [controlled comparison contract](../metrics.md#controlled-comparison-contract)
  this is a deviation from "same budget".
- **Corrections after the run.** The contamination zeroing and the
  `prove-plus-comm` exclusion were applied in the post-run audit. No
  pre-registered analysis plan is published for this run. The raw row shows the
  uncorrected result.
- **Three trials, not five.** The official protocol uses 5 trials, so this run
  cannot be submitted to the Terminal-Bench leaderboard.
- **Our harness settings.** Both harnesses ran behind a network allowlist and a
  transparent apt cache proxy that we configured. These are not part of the
  official setup.
- **One model.** Only `grok-4.7` at `xhigh` was tested. Results may differ with
  other models, providers or reasoning levels.
- **Evaluation build.** The OMK build includes unmerged pull requests and is not
  the published npm package.

## Reproduction notes

- Tasks: the public Terminal-Bench 2.1 task set (89 tasks), run with Harbor.
- mini-swe-agent: Harbor's mini-swe-agent agent, version 2.4.6, model
  `xai/grok-4.7` with `reasoning_effort=xhigh`.
- OMK: commit `78cc483` is not published. The closest public equivalent is
  `main` at `8baa743` with the pull requests listed under [Setup](#setup)
  applied. Run it headless with `omk -p "<instruction>"` in the task container,
  model `grok-4.7` with thinking level `xhigh`. Our Harbor adapter and scheduler
  are not published in this repository. When writing an adapter, pass `--` before the instruction (or use
  a build with #84) and start in the task's own working directory; those are
  the two defects found above.
- Analysis: per task, take the 3-trial mean for each harness; compare paired
  means with a task-level bootstrap (10,000 resamples) for the 95% interval.
- [`scripts/tb21-audit.mjs`](../tb21-audit.md) audits single-attempt Harbor jobs
  and rejects repeated trials, so it does not cover this 3-trial run.
- Raw trial logs, prompts and relay records are not published, in line with the
  [evidence privacy rules](../metrics.md#evidence-privacy). Only aggregate
  numbers and public task names appear here.
