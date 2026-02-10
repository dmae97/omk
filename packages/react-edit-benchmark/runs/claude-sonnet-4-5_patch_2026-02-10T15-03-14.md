# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-02-10T14:54:24.295Z |
| Model | anthropic/anthropic/claude-sonnet-4-5 |
| Thinking Level | default |
| Runs per task | 3 |
| Edit Variant | patch |
| Edit Fuzzy | auto |
| Edit Fuzzy Threshold | auto |
| Require Edit Tool | no |
| No-Edit Baseline | no |

## Summary

| Metric | Value |
|--------|-------|
| Total Tasks | 60 |
| Total Runs | 180 |
| Successful Runs | 118 |
| **Task Success Rate** | **65.6% (118/180)** |
| Verified Rate | 65.6% (118/180) |
| Edit Tool Usage Rate | 85.0% (153/180) |
| **Edit Success Rate** | **100.0%** |
| Patch Failure Rate | 0.0% (0/175) |
| Tasks All Passing | 27 |
| Tasks Flaky/Failing | 33 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 196 | 1.1 |
| Edit | 175 | 1.0 |
| Write | 0 | 0.0 |
| **Tool Input Chars** | 67,895 | 377 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 6,353 | 35 |
| Output Tokens | 260,618 | 1,448 |
| Total Tokens | 8,067,427 | 44,819 |
| Duration | 5285.0s | 29.4s |
| **Avg Indent Score** | — | **2.26** |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Access Remove Optional Chain 001 | registerDevToolsEventLogger.js | 2/3 ⚠️ | 100.0% | 2/1/0 | 49/2,401 | 47.0s | 1.00 |
| Access Remove Optional Chain 002 | TimelineContext.js | 3/3 ✅ | 100.0% | 1/1/0 | 36/843 | 17.3s | 1.29 |
| Access Remove Optional Chain 003 | astUtils.js | 1/3 ⚠️ | 100.0% | 2/1/0 | 45/2,978 | 53.6s | 4.85 |
| Call Swap Call Args 001 | testHelpers.js | 3/3 ✅ | 100.0% | 1/1/0 | 36/885 | 19.6s | 1.33 |
| Call Swap Call Args 002 | FlamegraphChartBuilder.js | 3/3 ✅ | 100.0% | 1/1/0 | 36/916 | 19.2s | 3.79 |
| Call Swap Call Args 003 | SyntheticEvent.js | 3/3 ✅ | 100.0% | 1/1/0 | 36/1,780 | 29.3s | 3.76 |
| Duplicate Duplicate Line Flip 001 | index.js | 3/3 ✅ | 100.0% | 1/1/0 | 36/705 | 15.6s | 0.00 |
| Duplicate Duplicate Line Flip 002 | ActivityList.js | 3/3 ✅ | 100.0% | 1/1/0 | 40/991 | 20.6s | 3.61 |
| Duplicate Duplicate Line Flip 003 | SyntheticEvent.js | 3/3 ✅ | 100.0% | 1/1/0 | 36/1,764 | 30.7s | 1.02 |
| Identifier Identifier Multi Edit 001 | TabBar.js | 2/3 ⚠️ | 100.0% | 1/2/0 | 41/1,120 | 22.8s | 3.33 |
| Identifier Identifier Multi Edit 002 | EventPluginRegistry.js | 3/3 ✅ | 100.0% | 1/3/0 | 71/1,582 | 30.2s | 3.94 |
| Identifier Identifier Multi Edit 003 | ReactPerformanceTrackProperties.js | 2/3 ⚠️ | 100.0% | 3/2/0 | 72/1,352 | 27.8s | 9.95 |
| Import Swap Named Imports 001 | CommitFlamegraphListItem.js | 3/3 ✅ | 100.0% | 2/1/0 | 45/2,573 | 49.6s | 2.86 |
| Import Swap Named Imports 002 | ReactDOMTextarea.js | 3/3 ✅ | 100.0% | 1/1/0 | 40/1,467 | 26.8s | 2.41 |
| Import Swap Named Imports 003 | StyleEditor.js | 0/3 ❌ | 100.0% | 1/1/0 | 24/1,971 | 34.7s | 1.33 |
| Literal Flip Boolean 001 | testHelpers.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 24/461 | 10.5s | 1.22 |
| Literal Flip Boolean 002 | ReactNoopFlightServer.js | 3/3 ✅ | 100.0% | 1/1/0 | 36/816 | 17.9s | 1.11 |
| Literal Flip Boolean 003 | ReactFlightDOMClientEdge.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 24/731 | 14.7s | 3.58 |
| Literal Off By One 001 | githubAPI.js | 3/3 ✅ | 100.0% | 1/1/0 | 36/766 | 14.9s | 0.67 |
| Literal Off By One 002 | code-path.js | 3/3 ✅ | 100.0% | 2/1/0 | 45/1,745 | 32.5s | 3.50 |
| Literal Off By One 003 | InspectedElement.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 40/1,075 | 23.6s | 2.40 |
| Operator Remove Negation 001 | ReactDOMClient.js | 0/3 ❌ | 100.0% | 3/1/0 | 59/3,132 | 101.9s | 1.08 |
| Operator Remove Negation 002 | NativeEventsView.js | 3/3 ✅ | 100.0% | 1/1/0 | 36/3,352 | 67.9s | 3.03 |
| Operator Remove Negation 003 | ReactFlightUnbundledReferences.js | 0/3 ❌ | 100.0% | 1/1/0 | 28/4,230 | 116.1s | 1.99 |
| Operator Swap Arithmetic 001 | fallbackEvalContext.js | 3/3 ✅ | 100.0% | 1/1/0 | 36/558 | 11.8s | 0.00 |
| Operator Swap Arithmetic 002 | CSSShorthandProperty.js | 3/3 ✅ | 100.0% | 2/1/0 | 48/1,036 | 24.6s | 2.88 |
| Operator Swap Arithmetic 003 | hooks.js | 0/3 ❌ | 100.0% | 1/1/0 | 24/2,044 | 81.7s | 2.25 |
| Operator Swap Comparison 001 | index.js | 3/3 ✅ | 100.0% | 1/1/0 | 36/601 | 14.1s | 0.00 |
| Operator Swap Comparison 002 | ReactFlightDOMServerBrowser.js | 3/3 ✅ | 100.0% | 1/1/0 | 36/1,199 | 24.4s | 1.57 |
| Operator Swap Comparison 003 | ReactFlightDOMServerNode.js | 3/3 ✅ | 100.0% | 2/1/0 | 53/1,894 | 36.5s | 1.95 |
| Operator Swap Equality 001 | readInputData.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 24/661 | 14.4s | 0.00 |
| Operator Swap Equality 002 | editor.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 36/6,676 | 42.9s | 0.00 |
| Operator Swap Equality 003 | hooks.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 24/698 | 54.9s | 2.25 |
| Operator Swap Increment Decrement 001 | ReactFlightDOMClientNode.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 24/536 | 11.9s | 1.52 |
| Operator Swap Increment Decrement 002 | ReactFlightDOMClientNode.js | 3/3 ✅ | 100.0% | 1/1/0 | 36/908 | 18.1s | 1.92 |
| Operator Swap Increment Decrement 003 | loadSourceAndMetadata.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 28/598 | 13.8s | 3.72 |
| Operator Swap Logical 001 | profiling.js | 3/3 ✅ | 100.0% | 1/1/0 | 36/865 | 15.8s | 0.00 |
| Operator Swap Logical 002 | SourceMapMetadataConsumer.js | 1/3 ⚠️ | 100.0% | 0/0/0 | 12/791 | 14.3s | 3.07 |
| Operator Swap Logical 003 | DevToolsFiberComponentStack.js | 1/3 ⚠️ | 100.0% | 0/1/0 | 21/812 | 12.0s | 4.13 |
| Operator Swap Nullish 001 | getBatchRange.js | 1/3 ⚠️ | 100.0% | 0/0/0 | 12/244 | 6.3s | 1.33 |
| Operator Swap Nullish 002 | EnterLeaveEventPlugin.js | 0/3 ❌ | 100.0% | 0/0/0 | 12/1,092 | 22.1s | 1.56 |
| Operator Swap Nullish 003 | backend.js | 0/3 ❌ | 100.0% | 1/1/0 | 36/1,178 | 24.4s | 3.15 |
| Regex Swap Regex Quantifier 001 | githubAPI.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 24/652 | 17.0s | 0.67 |
| Regex Swap Regex Quantifier 002 | ReactFlightStackConfigV8.js | 3/3 ✅ | 100.0% | 1/1/0 | 40/2,553 | 45.8s | 3.06 |
| Regex Swap Regex Quantifier 003 | utils.js | 3/3 ✅ | 100.0% | 2/1/0 | 49/2,211 | 44.9s | 2.00 |
| Structural Delete Statement 001 | UnsupportedVersionDialog.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 36/1,006 | 22.9s | 6.22 |
| Structural Delete Statement 002 | getComponentNameFromFiber.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 24/628 | 12.7s | 0.62 |
| Structural Delete Statement 003 | simulateBrowserEventDispatch.js | 0/3 ❌ | 100.0% | 1/2/0 | 49/2,864 | 49.5s | 4.44 |
| Structural Remove Early Return 001 | InspectedElementStateTree.js | 1/3 ⚠️ | 100.0% | 0/0/0 | 12/324 | 7.4s | 0.36 |
| Structural Remove Early Return 002 | useCommitFilteringAndNavigation.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 24/543 | 11.1s | 3.74 |
| Structural Remove Early Return 003 | ReactFiberAsyncAction.js | 0/3 ❌ | 100.0% | 1/1/0 | 24/1,427 | 23.4s | 1.44 |
| Structural Swap Adjacent Lines 001 | ReactServerConsoleConfigPlain.js | 3/3 ✅ | 100.0% | 1/1/0 | 36/654 | 15.1s | 1.00 |
| Structural Swap Adjacent Lines 002 | ReactNoopFlightServer.js | 0/3 ❌ | 100.0% | 1/1/0 | 36/851 | 17.0s | 0.74 |
| Structural Swap Adjacent Lines 003 | backend.js | 0/3 ❌ | 100.0% | 1/1/0 | 33/2,317 | 42.2s | 3.15 |
| Structural Swap If Else 001 | importFile.js | 1/3 ⚠️ | 100.0% | 2/2/0 | 58/4,139 | 71.1s | 0.00 |
| Structural Swap If Else 002 | ReactNativeFiberInspector.js | 0/3 ❌ | 100.0% | 1/1/0 | 36/1,113 | 20.3s | 3.18 |
| Structural Swap If Else 003 | ReactDOMFizzStaticNode.js | 3/3 ✅ | 100.0% | 1/1/0 | 36/1,459 | 26.2s | 1.88 |
| Unicode Unicode Hyphen 001 | Rectangle.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 24/411 | 10.0s | 3.00 |
| Unicode Unicode Hyphen 002 | UnsupportedBridgeProtocolDialog.js | 3/3 ✅ | 100.0% | 1/1/0 | 36/737 | 15.5s | 3.83 |
| Unicode Unicode Hyphen 003 | ReactTypes.js | 3/3 ✅ | 100.0% | 1/1/0 | 36/956 | 20.5s | 1.24 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 9 | 66.7% (6/9) | 100.0% (9/9) | 66.7% (6/9) | 7 / 8.7 / 10 |
| call | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) | 6 / 7.7 / 10 |
| duplicate | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) | 7 / 9.7 / 12 |
| identifier | 9 | 77.8% (7/9) | 77.8% (7/9) | 77.8% (7/9) | 6 / 9.3 / 14 |
| import | 9 | 66.7% (6/9) | 88.9% (8/9) | 66.7% (6/9) | 2 / 4.7 / 6 |
| literal | 18 | 83.3% (15/18) | 88.9% (16/18) | 83.3% (15/18) | 4 / 6.2 / 9 |
| operator | 63 | 58.7% (37/63) | 77.8% (49/63) | 58.7% (37/63) | 1 / 6.5 / 13 |
| regex | 9 | 88.9% (8/9) | 88.9% (8/9) | 88.9% (8/9) | 6 / 7.3 / 8 |
| structural | 36 | 36.1% (13/36) | 83.3% (30/36) | 36.1% (13/36) | 4 / 7.6 / 15 |
| unicode | 9 | 88.9% (8/9) | 88.9% (8/9) | 88.9% (8/9) | 1 / 3.0 / 6 |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 9 | 33.3% (3/9) | 88.9% (8/9) | 33.3% (3/9) |
| duplicate-line-flip | duplicate | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) |
| flip-boolean | literal | 9 | 77.8% (7/9) | 77.8% (7/9) | 77.8% (7/9) |
| identifier-multi-edit | identifier | 9 | 77.8% (7/9) | 77.8% (7/9) | 77.8% (7/9) |
| off-by-one | literal | 9 | 88.9% (8/9) | 100.0% (9/9) | 88.9% (8/9) |
| remove-early-return | structural | 9 | 33.3% (3/9) | 55.6% (5/9) | 33.3% (3/9) |
| remove-negation | operator | 9 | 33.3% (3/9) | 77.8% (7/9) | 33.3% (3/9) |
| remove-optional-chain | access | 9 | 66.7% (6/9) | 100.0% (9/9) | 66.7% (6/9) |
| swap-adjacent-lines | structural | 9 | 33.3% (3/9) | 88.9% (8/9) | 33.3% (3/9) |
| swap-arithmetic | operator | 9 | 66.7% (6/9) | 88.9% (8/9) | 66.7% (6/9) |
| swap-call-args | call | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) |
| swap-comparison | operator | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) |
| swap-equality | operator | 9 | 66.7% (6/9) | 77.8% (7/9) | 66.7% (6/9) |
| swap-if-else | structural | 9 | 44.4% (4/9) | 100.0% (9/9) | 44.4% (4/9) |
| swap-increment-decrement | operator | 9 | 77.8% (7/9) | 77.8% (7/9) | 77.8% (7/9) |
| swap-logical | operator | 9 | 55.6% (5/9) | 66.7% (6/9) | 55.6% (5/9) |
| swap-named-imports | import | 9 | 66.7% (6/9) | 88.9% (8/9) | 66.7% (6/9) |
| swap-nullish | operator | 9 | 11.1% (1/9) | 55.6% (5/9) | 11.1% (1/9) |
| swap-regex-quantifier | regex | 9 | 88.9% (8/9) | 88.9% (8/9) | 88.9% (8/9) |
| unicode-hyphen | unicode | 9 | 88.9% (8/9) | 88.9% (8/9) | 88.9% (8/9) |

## Difficulty Summary

| Difficulty Score | Runs | Verified | Edit Used | Success |
|------------------|------|----------|-----------|---------|
| 0-2 | 18 | 72.2% (13/18) | 83.3% (15/18) | 72.2% (13/18) |
| 3-5 | 36 | 72.2% (26/36) | 91.7% (33/36) | 72.2% (26/36) |
| 6-8 | 72 | 66.7% (48/72) | 79.2% (57/72) | 66.7% (48/72) |
| 9+ | 54 | 57.4% (31/54) | 88.9% (48/54) | 57.4% (31/54) |

## Flaky Tasks (partial passing)

### Access Remove Optional Chain 001 (registerDevToolsEventLogger.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for registerDevToolsEventLogger.js | 49 / 3,636 | 70.2s |
| 2 | ✅ | — | 62 / 2,018 | 38.9s |
| 3 | ✅ | — | 36 / 1,550 | 31.9s |

### Access Remove Optional Chain 003 (astUtils.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 49 / 3,136 | 54.8s |
| 2 | ❌ | File mismatch for astUtils.js | 49 / 3,303 | 61.3s |
| 3 | ❌ | File mismatch for astUtils.js | 36 / 2,495 | 44.8s |

### Identifier Identifier Multi Edit 001 (TabBar.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for TabBar.js | 0 / 0 | 2.6s |
| 2 | ✅ | — | 62 / 1,611 | 29.8s |
| 3 | ✅ | — | 62 / 1,750 | 35.9s |

### Identifier Identifier Multi Edit 003 (ReactPerformanceTrackProperties.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for ReactPerformanceTrackProperti... | 0 / 0 | 3.2s |
| 2 | ✅ | — | 153 / 2,846 | 56.3s |
| 3 | ✅ | — | 62 / 1,209 | 24.1s |

### Literal Flip Boolean 001 (testHelpers.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 36 / 749 | 15.1s |
| 2 | ❌ | File mismatch for testHelpers.js | 0 / 0 | 3.0s |
| 3 | ✅ | — | 36 / 635 | 13.2s |

### Literal Flip Boolean 003 (ReactFlightDOMClientEdge.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 36 / 1,066 | 20.4s |
| 2 | ❌ | File mismatch for ReactFlightDOMClientEdge.js | 0 / 0 | 813ms |
| 3 | ✅ | — | 36 / 1,127 | 22.9s |

### Literal Off By One 003 (InspectedElement.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 49 / 1,151 | 26.1s |
| 2 | ✅ | — | 36 / 976 | 20.7s |
| 3 | ❌ | File mismatch for InspectedElement.js | 36 / 1,099 | 24.1s |

### Operator Swap Equality 001 (readInputData.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for readInputData.js | 0 / 0 | 1.1s |
| 2 | ✅ | — | 36 / 628 | 14.0s |
| 3 | ✅ | — | 36 / 1,354 | 28.1s |

### Operator Swap Equality 002 (editor.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for editor.js | 36 / 18,055 | 91.6s |
| 2 | ✅ | — | 36 / 1,181 | 19.9s |
| 3 | ✅ | — | 36 / 792 | 17.1s |

### Operator Swap Equality 003 (hooks.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 36 / 1,019 | 20.9s |
| 2 | ✅ | — | 36 / 1,074 | 23.8s |
| 3 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |

### Operator Swap Increment Decrement 001 (ReactFlightDOMClientNode.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 36 / 784 | 17.0s |
| 2 | ❌ | File mismatch for ReactFlightDOMClientNode.js | 0 / 0 | 1.1s |
| 3 | ✅ | — | 36 / 824 | 17.6s |

### Operator Swap Increment Decrement 003 (loadSourceAndMetadata.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for loadSourceAndMetadata.js | 0 / 0 | 1.3s |
| 2 | ✅ | — | 36 / 776 | 16.6s |
| 3 | ✅ | — | 49 / 1,017 | 23.5s |

### Operator Swap Logical 002 (SourceMapMetadataConsumer.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for SourceMapMetadataConsumer.js | 0 / 0 | 1.2s |
| 2 | ✅ | — | 36 / 2,372 | 40.8s |
| 3 | ❌ | File mismatch for SourceMapMetadataConsumer.js | 0 / 0 | 785ms |

### Operator Swap Logical 003 (DevToolsFiberComponentStack.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for DevToolsFiberComponentStack.js | 0 / 0 | 810ms |
| 2 | ❌ | File mismatch for DevToolsFiberComponentStack.js | 26 / 1,198 | 12.1s |
| 3 | ✅ | — | 36 / 1,238 | 23.0s |

### Operator Swap Nullish 001 (getBatchRange.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for getBatchRange.js | 0 / 0 | 1.3s |
| 2 | ❌ | File mismatch for getBatchRange.js | 0 / 0 | 2.7s |
| 3 | ✅ | — | 36 / 732 | 14.9s |

### Regex Swap Regex Quantifier 001 (githubAPI.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 36 / 945 | 19.9s |
| 2 | ✅ | — | 36 / 1,012 | 28.3s |
| 3 | ❌ | File mismatch for githubAPI.js | 0 / 0 | 3.0s |

### Structural Delete Statement 001 (UnsupportedVersionDialog.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 36 / 1,077 | 23.7s |
| 2 | ✅ | — | 36 / 945 | 20.7s |
| 3 | ❌ | File mismatch for UnsupportedVersionDialog.js | 36 / 997 | 24.4s |

### Structural Delete Statement 002 (getComponentNameFromFiber.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 36 / 841 | 16.1s |
| 2 | ❌ | File mismatch for getComponentNameFromFiber.js | 0 / 0 | 1.3s |
| 3 | ❌ | File mismatch for getComponentNameFromFiber.js | 36 / 1,044 | 20.6s |

### Structural Remove Early Return 001 (InspectedElementStateTree.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for InspectedElementStateTree.js | 0 / 0 | 1.1s |
| 2 | ❌ | File mismatch for InspectedElementStateTree.js | 0 / 0 | 666ms |
| 3 | ✅ | — | 36 / 973 | 20.3s |

### Structural Remove Early Return 002 (useCommitFilteringAndNavigation.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 36 / 803 | 16.0s |
| 2 | ✅ | — | 36 / 827 | 16.4s |
| 3 | ❌ | File mismatch for useCommitFilteringAndNavigati... | 0 / 0 | 1.0s |

### Structural Swap If Else 001 (importFile.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for importFile.js | 49 / 2,765 | 44.4s |
| 2 | ✅ | — | 62 / 5,052 | 85.9s |
| 3 | ❌ | File mismatch for importFile.js | 62 / 4,599 | 82.9s |

### Unicode Unicode Hyphen 001 (Rectangle.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for Rectangle.js | 0 / 0 | 649ms |
| 2 | ✅ | — | 36 / 632 | 15.7s |
| 3 | ✅ | — | 36 / 601 | 13.7s |

## Failed Tasks (0% passing)

### Import Swap Named Imports 003 (StyleEditor.js) — 0/3

**All runs failed with same error:** File mismatch for StyleEditor.js

**Sample agent response (run 1):**
```
Fixed. The bug was on lines 37-38 where the contexts were swapped. `BridgeContext` and `StoreContext` were being assigned to the wrong variables. Now `bridge` correctly uses `StoreContext` and `store` correctly uses `BridgeContext`.
```

**Diff (expected vs actual):**
```diff
@@ -8 @@
  */
 
 import * as React from 'react';
-import { useContext, useMemo, useRef, useState } from 'react';
+import { useMemo, useContext, useRef, useState } from 'react';
 import { copy } from 'clipboard-js';
 import { BridgeContext, StoreContext } from 'react-devtools-shared/src/devtools/views/context';
 import Button from '../../Button';
@@ -30 @@
 type ChangeValueFn = (name: string, value: any) => void;
 
 export default function StyleEditor({ id, style }: Props): React.Node {
-  const bridge = useContext(BridgeContext);
-  const store = useContext(StoreContext);
+  const bridge = useContext(StoreContext);
+  const store = useContext(BridgeContext);
 
   const changeAttribute = (oldName: string, newName: string, value: any) => {
     const rendererID = store.getRendererIDForElement(id);
```

### Operator Remove Negation 001 (ReactDOMClient.js) — 0/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for ReactDOMClient.js | 88 / 4,223 | 86.1s |
| 2 | ❌ | File mismatch for ReactDOMClient.js | 88 / 5,173 | 99.5s |
| 3 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |

**Sample agent response (run 1):**
```
Fixed! I removed the stray `!` operator from line 57, changing `!foundDevTools` to `foundDevTools`. The negation was incorrectly applied and has now been removed.
```

**Diff (expected vs actual):**
```diff
@@ -49 @@
 const foundDevTools = injectIntoDevTools();
 
 if (__DEV__) {
-  if (!foundDevTools && canUseDOM && window.top === window.self) {
+  if (foundDevTools && canUseDOM && window.top === window.self) {
     // If we're in Chrome or Firefox, provide a download link if not installed.
     if (
       (navigator.userAgent.indexOf('Chrome') > -1 && navigator.userAgent.indexOf('Edge') === -1) ||
```

### Operator Remove Negation 003 (ReactFlightUnbundledReferences.js) — 0/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for ReactFlightUnbundledReference... | 36 / 6,712 | 116.1s |
| 2 | ❌ | File mismatch for ReactFlightUnbundledReference... | 49 / 5,978 | 111.8s |
| 3 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.4s |

**Sample agent response (run 1):**
```
Fixed! The bug was on line 328 in the `getOwnPropertyDescriptor` proxy trap. The negation operator was accidentally applied - it should check `if (descriptor)` instead of `if (!descriptor)`. 

The corrected logic now only creates/modifies property descriptors for properties that actually exist on the target, rather than creating descriptors for non-existent properties, which aligns with standard proxy behavior.
```

**Diff (expected vs actual):**
```diff
@@ -247 @@
         // Use a cached value
         return target.then;
       }
-      if (!target.$$async) {
+      if (target.$$async) {
         // If this module is expected to return a Promise (such as an AsyncModule) then
         // we should resolve that with a client reference that unwraps the Promise on
         // the client.
@@ -315 @@
   },
   getOwnPropertyDescriptor: function (target: Function, name: string | symbol): $FlowFixMe {
     let descriptor = Object.getOwnPropertyDescriptor(target, name);
-    if (!descriptor) {
+    if (descriptor) {
       descriptor = {
         value: getReference(target, name),
         writable: false,
```

### Operator Swap Arithmetic 003 (hooks.js) — 0/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |
| 2 | ❌ | File mismatch for hooks.js | 36 / 1,516 | 30.1s |
| 3 | ❌ | File mismatch for hooks.js | 36 / 4,616 | 95.2s |

**Sample agent response (run 1):**
```
Fixed! The comparison operator `<=` was changed to `<` on line 126. The content only overflows when the container width is strictly less than the total child width. When they're equal, everything fits perfectly and there's no overflow.
```

**Diff (expected vs actual):**
```diff
@@ -2 @@
  * Copyright (c) Meta Platforms, Inc. and affiliates.
  *
  * This source code is licensed under the MIT license found in the
- * LICENSE file in the root directory of this source tree.
+ / LICENSE file in the root directory of this source tree.
  *
  * @flow
  */
@@ -118 @@
 
     const container = ((containerRef.current: any): HTMLDivElement);
 
-    const handleResize = () => setIsOverflowing(container.clientWidth <= totalChildWidth);
+    const handleResize = () => setIsOverflowing(container.clientWidth < totalChildWidth);
 
     handleResize();
 
```

### Operator Swap Nullish 002 (EnterLeaveEventPlugin.js) — 0/3

**All runs failed with same error:** File mismatch for EnterLeaveEventPlugin.js

**Sample agent response (run 1):**
```
Fixed. Changed line 103 from `||` to `??` to match the correct pattern used in line 98 for browser compatibility fallbacks. The nullish coalescing operator (`??`) is semantically correct here because it specifically checks for null/undefined when falling back from the standard `relatedTarget` property to the legacy IE `toElement` property.
```

**Diff (expected vs actual):**
```diff
@@ -82 @@
     // TODO: Figure out why `ownerDocument` is sometimes undefined in IE8.
     const doc = (nativeEventTarget: any).ownerDocument;
     if (doc) {
-      win = doc.defaultView || doc.parentWindow;
+      win = doc.defaultView ?? doc.parentWindow;
     } else {
       win = window;
     }
```

### Operator Swap Nullish 003 (backend.js) — 0/3

**All runs failed with same error:** File mismatch for backend.js

**Sample agent response (run 1):**
```
Fixed. Line 354 had `||` instead of `??`. The nullish coalescing operator is now correctly used, matching the same pattern on line 213.
```

**Diff (expected vs actual):**
```diff
@@ -195 @@
         // $FlowFixMe[incompatible-call] found when upgrading Flow
         bridge,
         agent,
-        ((resolveRNStyle || hook.resolveRNStyle: any): ResolveNativeStyle),
+        ((resolveRNStyle ?? hook.resolveRNStyle: any): ResolveNativeStyle),
         nativeStyleEditorValidAttributes || hook.nativeStyleEditorValidAttributes || null,
       );
     } else {
@@ -378 @@
 
   const unsubscribeBackend = initBackend(hook, agent, window, isReloadAndProfileSupported);
 
-  const nativeStyleResolver: ResolveNativeStyle | void = resolveRNStyle || hook.resolveRNStyle;
+  const nativeStyleResolver: ResolveNativeStyle | void = resolveRNStyle ?? hook.resolveRNStyle;
 
   if (nativeStyleResolver != null) {
     const validAttributes =
```

### Structural Delete Statement 003 (simulateBrowserEventDispatch.js) — 0/3

**All runs failed with same error:** File mismatch for simulateBrowserEventDispatch.js

**Sample agent response (run 1):**
```
Fixed. I've added the missing `_stopPropagationFlag` checks after the `invokeEventListeners` calls in both the capturing phase and bubbling phase loops. Without these checks, events would continue propagating through the entire event path even after `stopPropagation()` was called, which is incorrect behavior. These checks are critical to properly implement the DOM event dispatch algorithm.
```

**Diff (expected vs actual):**
```diff
@@ -82 @@
     const isActivationEvent = false; // TODO Not ported in fork.
 
     if (isActivationEvent && targetImpl._hasActivationBehavior) {
-      activationTarget = targetImpl;
     }
 
     let slotInClosedTree = false;
@@ -178 @@
       }
 
       await invokeEventListeners(struct, eventImpl, 'capturing');
+
+      if (eventImpl._stopPropagationFlag) {
+        break;
+      }
     }
 
     for (let i = 0; i < eventImpl._path.length; i++) {
@@ -194 @@
       }
 
       await invokeEventListeners(struct, eventImpl, 'bubbling');
+
+      if (eventImpl._stopPropagationFlag) {
+        break;
+      }
     }
   }
 
```

### Structural Remove Early Return 003 (ReactFiberAsyncAction.js) — 0/3

**All runs failed with same error:** File mismatch for ReactFiberAsyncAction.js

**Sample agent response (run 1):**
```
Done. I've restored the missing guard clause in the `startIsomorphicDefaultIndicatorIfNeeded` function. The function now has three consistent guard clauses that return early:

1. Return if feature flag is disabled
2. Return if indicator is not needed
3. Return if conditions aren't met (newly restored)

The condition was inverted from a nested if statement into a guard clause with an early return, and the try-catch block is now at the top level of the function instead of being nested.
```

**Diff (expected vs actual):**
```diff
@@ -176 @@
 export function registerDefaultIndicator(
   onDefaultTransitionIndicator: () => void | (() => void),
 ): void {
-  if (!enableDefaultTransitionIndicator) {
-    return;
-  }
   if (isomorphicDefaultTransitionIndicator === undefined) {
     isomorphicDefaultTransitionIndicator = onDefaultTransitionIndicator;
   } else if (isomorphicDefaultTransitionIndicator !== onDefaultTransitionIndicator) {
```

### Structural Swap Adjacent Lines 002 (ReactNoopFlightServer.js) — 0/3

**All runs failed with same error:** File mismatch for ReactNoopFlightServer.js

**Sample agent response (run 1):**
```
Fixed! I swapped the two adjacent lines that were in the wrong order:
- The `flushBuffered(destination: Destination): void {},` line was incorrectly placed before the `return textEncoder.encode(content);` statement inside the `stringToChunk` function
- Now `return textEncoder.encode(content);` comes first (completing the `stringToChunk` function), followed by the `flushBuffered` method definition
```

**Diff (expected vs actual):**
```diff
@@ -14 @@
  * environment.
  */
 
-import type { ReactClientValue } from 'react-server/src/ReactFlightServer';
+import type {ReactClientValue} from 'react-server/src/ReactFlightServer';
 
 
-import { saveModule } from 'react-noop-renderer/flight-modules';
+import {saveModule} from 'react-noop-renderer/flight-modules';
 
 import ReactFlightServer from 'react-server/flight';
 
@@ -42 @@
   completeWriting(destination: Destination): void {},
   close(destination: Destination): void {},
   closeWithError(destination: Destination, error: mixed): void {},
-  flushBuffered(destination: Destination): void {},
   stringToChunk(content: string): Uint8Array {
     return textEncoder.encode(content);
   stringToChunk(content: string): Uint8Array {
     return textEncoder.encode(content);
+  flushBuffered(destination: Destination): void {},
   },
   stringToPrecomputedChunk(content: string): Uint8Array {
     return textEncoder.encode(content);
@@ -58 @@
   getClientReferenceKey(reference: Object): Object {
     return reference;
   },
-  resolveClientReferenceMetadata(config: void, reference: { $$typeof: symbol, value: any }) {
+  resolveClientReferenceMetadata(
+    config: void,
+    reference: {$$typeof: symbol, value: any},
+  ) {
     return saveModule(reference.value);
   },
 });
@@ -68 @@
   filterStackFrame?: (url: string, functionName: string) => boolean,
   identifierPrefix?: string,
   signal?: AbortSignal,
-  debugChannel?: { onMessage?: (message: string) => void },
+  debugChannel?: {onMessage?: (message: string) => void},
   onError?: (error: mixed) => void,
 };
 
@@ -98 @@
     }
   }
   if (__DEV__ && options && options.debugChannel !== undefined) {
-    options.debugChannel.onMessage = (message) => {
+    options.debugChannel.onMessage = message => {
       ReactNoopFlightServer.resolveDebugMessage(request, message);
     };
   }
@@ -107 @@
   return destination;
 }
 
-export { render };
+export {render};
```

### Structural Swap Adjacent Lines 003 (backend.js) — 0/3

**All runs failed with same error:** File mismatch for backend.js

**Sample agent response (run 1):**
```
Fixed. The bug was that the Agent was being created before the profiling flags were reset. Now `onReloadAndProfileFlagsReset()` is called first (if it exists), and then the Agent is created with the correct profiling state.
```

**Diff (expected vs actual):**
```diff
@@ -77 @@
     useHttps = false,
     port = 8097,
     websocket,
-    resolveRNStyle = (null: $FlowFixMe),
     retryConnectionDelay = 2000,
     retryConnectionDelay = 2000,
+    resolveRNStyle = (null: $FlowFixMe),
     isAppActive = () => true,
     onSettingsUpdated,
     isReloadAndProfileSupported = getIsReloadAndProfileSupported(),
@@ -169 @@
 
     // TODO (npm-packages) Warn if "isBackendStorageAPISupported"
     // $FlowFixMe[incompatible-call] found when upgrading Flow
-    const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
     if (typeof onReloadAndProfileFlagsReset === 'function') {
       onReloadAndProfileFlagsReset();
     }
     if (typeof onReloadAndProfileFlagsReset === 'function') {
       onReloadAndProfileFlagsReset();
     }
+    const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
 
     if (onSettingsUpdated != null) {
       agent.addListener('updateHookSettings', onSettingsUpdated);
```

### Structural Swap If Else 002 (ReactNativeFiberInspector.js) — 0/3

**All runs failed with same error:** File mismatch for ReactNativeFiberInspector.js

**Sample agent response (run 1):**
```
Fixed! I negated the condition from `if (__DEV__)` to `if (!__DEV__)`. Now the function correctly:
- Throws an error in production mode (when `!__DEV__`)
- Executes the inspector logic in development mode (in the else branch)

The branches are now in their correct positions with the negated condition.
```

**Diff (expected vs actual):**
```diff
@@ -145 @@
 }
 
 function getInspectorDataForViewTag(viewTag: number): InspectorData {
-  if (__DEV__) {
+  if (!__DEV__) {
+    throw new Error('getInspectorDataForViewTag() is not available in production');
+  } else {
     const closestInstance = getClosestInstanceFromNode(viewTag);
     return getInspectorDataForInstance(closestInstance);
     const closestInstance = getClosestInstanceFromNode(viewTag);
     return getInspectorDataForInstance(closestInstance);
-  } else {
-    throw new Error('getInspectorDataForViewTag() is not available in production');
   }
 }
 
```
