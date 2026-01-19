# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-01-19T13:44:45.661Z |
| Model | anthropic/openai-codex/gpt-5.1-codex-mini |
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
| Successful Runs | 96 |
| **Task Success Rate** | **53.3% (96/180)** |
| Verified Rate | 53.3% (96/180) |
| Edit Tool Usage Rate | 67.2% (121/180) |
| **Edit Success Rate** | **98.6%** |
| Patch Failure Rate | 1.4% (2/142) |
| Tasks All Passing | 14 |
| Tasks Flaky/Failing | 46 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 272 | 1.5 |
| Edit | 142 | 0.8 |
| Write | 0 | 0.0 |
| **Tool Input Chars** | 60,288 | 335 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 2,109,510 | 11,720 |
| Output Tokens | 385,104 | 2,139 |
| Total Tokens | 8,913,686 | 49,520 |
| Duration | 5912.0s | 32.8s |
| **Avg Indent Score** | — | **2.28** |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Access Remove Optional Chain 001 | registerDevToolsEventLogger.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 7,881/1,102 | 50.7s | 1.00 |
| Access Remove Optional Chain 002 | TimelineContext.js | 3/3 ✅ | 100.0% | 4/2/0 | 32,303/5,595 | 49.6s | 1.29 |
| Access Remove Optional Chain 003 | astUtils.js | 0/3 ❌ | 100.0% | 3/0/0 | 34,617/5,112 | 38.7s | 4.87 |
| Call Swap Call Args 001 | testHelpers.js | 2/3 ⚠️ | 100.0% | 2/1/0 | 12,362/1,878 | 22.7s | 1.33 |
| Call Swap Call Args 002 | FlamegraphChartBuilder.js | 1/3 ⚠️ | 100.0% | 4/1/0 | 25,888/3,771 | 35.0s | 3.79 |
| Call Swap Call Args 003 | SyntheticEvent.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 10,545/862 | 48.4s | 3.76 |
| Duplicate Duplicate Line Flip 001 | index.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 6,779/583 | 7.4s | 0.00 |
| Duplicate Duplicate Line Flip 002 | ActivityList.js | 3/3 ✅ | 100.0% | 2/2/0 | 11,594/987 | 11.5s | 3.61 |
| Duplicate Duplicate Line Flip 003 | SyntheticEvent.js | 0/3 ❌ | 100.0% | 0/0/0 | 926/1,601 | 92.0s | 1.02 |
| Identifier Identifier Multi Edit 001 | TabBar.js | 1/3 ⚠️ | 100.0% | 4/2/0 | 10,937/2,373 | 25.9s | 3.33 |
| Identifier Identifier Multi Edit 002 | EventPluginRegistry.js | 1/3 ⚠️ | 100.0% | 3/1/0 | 13,257/1,718 | 61.7s | 3.94 |
| Identifier Identifier Multi Edit 003 | ReactPerformanceTrackProperties.js | 2/3 ⚠️ | 100.0% | 2/1/0 | 16,552/1,505 | 15.6s | 9.95 |
| Import Swap Named Imports 001 | CommitFlamegraphListItem.js | 3/3 ✅ | 100.0% | 2/1/0 | 9,074/1,246 | 15.8s | 2.86 |
| Import Swap Named Imports 002 | ReactDOMTextarea.js | 2/3 ⚠️ | 100.0% | 2/1/0 | 14,842/1,604 | 19.2s | 2.41 |
| Import Swap Named Imports 003 | StyleEditor.js | 0/3 ❌ | 100.0% | 1/1/0 | 9,254/4,430 | 68.7s | 1.31 |
| Literal Flip Boolean 001 | testHelpers.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 7,384/432 | 8.6s | 0.89 |
| Literal Flip Boolean 002 | ReactNoopFlightServer.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 6,287/1,809 | 18.1s | 1.11 |
| Literal Flip Boolean 003 | ReactFlightDOMClientEdge.js | 0/3 ❌ | 100.0% | 1/0/0 | 3,972/4,440 | 9.0s | 3.58 |
| Literal Off By One 001 | githubAPI.js | 3/3 ✅ | 100.0% | 1/1/0 | 12,865/206 | 8.5s | 0.67 |
| Literal Off By One 002 | code-path.js | 3/3 ✅ | 100.0% | 2/1/0 | 28,443/6,444 | 49.8s | 3.50 |
| Literal Off By One 003 | InspectedElement.js | 2/3 ⚠️ | 100.0% | 2/1/0 | 13,076/2,061 | 21.3s | 3.60 |
| Operator Remove Negation 001 | ReactDOMClient.js | 2/3 ⚠️ | 100.0% | 3/1/0 | 21,759/5,975 | 90.0s | 1.08 |
| Operator Remove Negation 002 | NativeEventsView.js | 2/3 ⚠️ | 100.0% | 2/1/0 | 20,692/7,036 | 87.8s | 3.03 |
| Operator Remove Negation 003 | ReactFlightUnbundledReferences.js | 0/3 ❌ | 100.0% | 0/0/0 | 0/0 | 120.0s | 0.00 |
| Operator Swap Arithmetic 001 | fallbackEvalContext.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 2,171/293 | 46.6s | 0.00 |
| Operator Swap Arithmetic 002 | CSSShorthandProperty.js | 1/3 ⚠️ | 100.0% | 3/1/0 | 15,150/3,112 | 27.5s | 2.88 |
| Operator Swap Arithmetic 003 | hooks.js | 0/3 ❌ | 100.0% | 2/0/0 | 11,289/4,322 | 71.7s | 2.25 |
| Operator Swap Comparison 001 | index.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 4,890/340 | 7.0s | 0.00 |
| Operator Swap Comparison 002 | ReactFlightDOMServerBrowser.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 4,042/2,543 | 11.6s | 1.57 |
| Operator Swap Comparison 003 | ReactFlightDOMServerNode.js | 2/3 ⚠️ | 100.0% | 2/1/0 | 18,337/1,471 | 16.4s | 1.95 |
| Operator Swap Equality 001 | readInputData.js | 2/3 ⚠️ | 100.0% | 2/1/0 | 13,469/501 | 9.9s | 0.00 |
| Operator Swap Equality 002 | editor.js | 3/3 ✅ | 100.0% | 2/1/0 | 20,983/1,152 | 14.3s | 0.00 |
| Operator Swap Equality 003 | hooks.js | 3/3 ✅ | 100.0% | 1/1/0 | 12,057/556 | 9.4s | 2.25 |
| Operator Swap Increment Decrement 001 | ReactFlightDOMClientNode.js | 3/3 ✅ | 100.0% | 1/1/0 | 8,681/290 | 6.1s | 1.52 |
| Operator Swap Increment Decrement 002 | ReactFlightDOMClientNode.js | 3/3 ✅ | 100.0% | 1/1/0 | 6,212/284 | 7.8s | 1.92 |
| Operator Swap Increment Decrement 003 | loadSourceAndMetadata.js | 3/3 ✅ | 100.0% | 2/1/0 | 30,476/697 | 12.5s | 3.72 |
| Operator Swap Logical 001 | profiling.js | 3/3 ✅ | 100.0% | 1/1/0 | 5,962/436 | 13.3s | 0.00 |
| Operator Swap Logical 002 | SourceMapMetadataConsumer.js | 1/3 ⚠️ | 100.0% | 1/0/0 | 3,294/1,651 | 13.1s | 3.07 |
| Operator Swap Logical 003 | DevToolsFiberComponentStack.js | 2/3 ⚠️ | 100.0% | 2/1/0 | 6,757/5,239 | 28.4s | 4.13 |
| Operator Swap Nullish 001 | getBatchRange.js | 3/3 ✅ | 100.0% | 1/1/0 | 7,028/402 | 8.0s | 1.33 |
| Operator Swap Nullish 002 | EnterLeaveEventPlugin.js | 1/3 ⚠️ | 100.0% | 1/0/0 | 3,257/822 | 10.3s | 1.56 |
| Operator Swap Nullish 003 | backend.js | 0/3 ❌ | 100.0% | 5/1/0 | 20,811/5,938 | 53.4s | 3.15 |
| Regex Swap Regex Quantifier 001 | githubAPI.js | 3/3 ✅ | 100.0% | 1/1/0 | 12,987/1,378 | 14.5s | 0.67 |
| Regex Swap Regex Quantifier 002 | ReactFlightStackConfigV8.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 17,922/1,857 | 20.6s | 3.06 |
| Regex Swap Regex Quantifier 003 | utils.js | 1/3 ⚠️ | 100.0% | 0/0/0 | 2,297/4,655 | 110.0s | 2.00 |
| Structural Delete Statement 001 | UnsupportedVersionDialog.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 21,975/445 | 8.0s | 6.22 |
| Structural Delete Statement 002 | getComponentNameFromFiber.js | 0/3 ❌ | 100.0% | 1/1/0 | 18,709/953 | 9.2s | 0.74 |
| Structural Delete Statement 003 | simulateBrowserEventDispatch.js | 1/3 ⚠️ | 100.0% | 1/0/0 | 3,582/1,414 | 93.2s | 4.46 |
| Structural Remove Early Return 001 | InspectedElementStateTree.js | 0/3 ❌ | 100.0% | 2/1/0 | 10,838/2,575 | 24.0s | 0.41 |
| Structural Remove Early Return 002 | useCommitFilteringAndNavigation.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 15,643/3,704 | 29.6s | 3.81 |
| Structural Remove Early Return 003 | ReactFiberAsyncAction.js | 0/3 ❌ | 100.0% | 0/0/0 | 5,414/2,433 | 55.9s | 1.46 |
| Structural Swap Adjacent Lines 001 | ReactServerConsoleConfigPlain.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 4,366/1,978 | 17.6s | 0.33 |
| Structural Swap Adjacent Lines 002 | ReactNoopFlightServer.js | 3/3 ✅ | 100.0% | 1/1/0 | 6,983/2,050 | 18.0s | 1.11 |
| Structural Swap Adjacent Lines 003 | backend.js | 0/3 ❌ | 50.0% | 2/1/0 | 15,928/5,067 | 116.0s | 3.15 |
| Structural Swap If Else 001 | importFile.js | 0/3 ❌ | 100.0% | 1/1/0 | 2,414/2,282 | 58.0s | 0.00 |
| Structural Swap If Else 002 | ReactNativeFiberInspector.js | 0/3 ❌ | 100.0% | 1/1/0 | 7,518/1,443 | 12.5s | 3.18 |
| Structural Swap If Else 003 | ReactDOMFizzStaticNode.js | 2/3 ⚠️ | 100.0% | 2/1/0 | 9,895/2,558 | 23.0s | 1.89 |
| Unicode Unicode Hyphen 001 | Rectangle.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 4,579/193 | 5.3s | 3.00 |
| Unicode Unicode Hyphen 002 | UnsupportedBridgeProtocolDialog.js | 1/3 ⚠️ | 100.0% | 1/0/0 | 6,211/348 | 5.5s | 3.83 |
| Unicode Unicode Hyphen 003 | ReactTypes.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 9,753/216 | 6.3s | 1.24 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 9 | 55.6% (5/9) | 66.7% (6/9) | 55.6% (5/9) | 7 / 8.7 / 10 |
| call | 9 | 55.6% (5/9) | 66.7% (6/9) | 55.6% (5/9) | 6 / 7.7 / 10 |
| duplicate | 9 | 55.6% (5/9) | 66.7% (6/9) | 55.6% (5/9) | 7 / 9.7 / 12 |
| identifier | 9 | 44.4% (4/9) | 55.6% (5/9) | 44.4% (4/9) | 6 / 9.3 / 14 |
| import | 9 | 55.6% (5/9) | 88.9% (8/9) | 55.6% (5/9) | 2 / 4.7 / 6 |
| literal | 18 | 66.7% (12/18) | 72.2% (13/18) | 66.7% (12/18) | 4 / 6.2 / 9 |
| operator | 63 | 60.3% (38/63) | 69.8% (44/63) | 60.3% (38/63) | 1 / 6.5 / 13 |
| regex | 9 | 66.7% (6/9) | 66.7% (6/9) | 66.7% (6/9) | 6 / 7.3 / 8 |
| structural | 36 | 30.6% (11/36) | 61.1% (22/36) | 30.6% (11/36) | 4 / 7.6 / 15 |
| unicode | 9 | 55.6% (5/9) | 55.6% (5/9) | 55.6% (5/9) | 1 / 3.0 / 6 |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 9 | 33.3% (3/9) | 55.6% (5/9) | 33.3% (3/9) |
| duplicate-line-flip | duplicate | 9 | 55.6% (5/9) | 66.7% (6/9) | 55.6% (5/9) |
| flip-boolean | literal | 9 | 44.4% (4/9) | 55.6% (5/9) | 44.4% (4/9) |
| identifier-multi-edit | identifier | 9 | 44.4% (4/9) | 55.6% (5/9) | 44.4% (4/9) |
| off-by-one | literal | 9 | 88.9% (8/9) | 88.9% (8/9) | 88.9% (8/9) |
| remove-early-return | structural | 9 | 22.2% (2/9) | 66.7% (6/9) | 22.2% (2/9) |
| remove-negation | operator | 9 | 44.4% (4/9) | 44.4% (4/9) | 44.4% (4/9) |
| remove-optional-chain | access | 9 | 55.6% (5/9) | 66.7% (6/9) | 55.6% (5/9) |
| swap-adjacent-lines | structural | 9 | 44.4% (4/9) | 55.6% (5/9) | 44.4% (4/9) |
| swap-arithmetic | operator | 9 | 22.2% (2/9) | 44.4% (4/9) | 22.2% (2/9) |
| swap-call-args | call | 9 | 55.6% (5/9) | 66.7% (6/9) | 55.6% (5/9) |
| swap-comparison | operator | 9 | 55.6% (5/9) | 66.7% (6/9) | 55.6% (5/9) |
| swap-equality | operator | 9 | 88.9% (8/9) | 88.9% (8/9) | 88.9% (8/9) |
| swap-if-else | structural | 9 | 22.2% (2/9) | 66.7% (6/9) | 22.2% (2/9) |
| swap-increment-decrement | operator | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) |
| swap-logical | operator | 9 | 66.7% (6/9) | 66.7% (6/9) | 66.7% (6/9) |
| swap-named-imports | import | 9 | 55.6% (5/9) | 88.9% (8/9) | 55.6% (5/9) |
| swap-nullish | operator | 9 | 44.4% (4/9) | 77.8% (7/9) | 44.4% (4/9) |
| swap-regex-quantifier | regex | 9 | 66.7% (6/9) | 66.7% (6/9) | 66.7% (6/9) |
| unicode-hyphen | unicode | 9 | 55.6% (5/9) | 55.6% (5/9) | 55.6% (5/9) |

## Difficulty Summary

| Difficulty Score | Runs | Verified | Edit Used | Success |
|------------------|------|----------|-----------|---------|
| 0-2 | 18 | 61.1% (11/18) | 66.7% (12/18) | 61.1% (11/18) |
| 3-5 | 36 | 61.1% (22/36) | 72.2% (26/36) | 61.1% (22/36) |
| 6-8 | 72 | 51.4% (37/72) | 68.1% (49/72) | 51.4% (37/72) |
| 9+ | 54 | 48.1% (26/54) | 63.0% (34/54) | 48.1% (26/54) |

## Edit Tool Errors

Failures where the edit tool returned an error or failed to apply the patch.

### Structural Swap Adjacent Lines 003 (backend.js)

#### Run 3

##### Attempt 1

- Path: backend.js
- Operation: —

**Tool error**

```
Found 2 occurrences of the text in backend.js. The text must be unique. Please provide more context to make it unique.
```

**Patch args**

```diff
@@
-    const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
-    if (typeof onReloadAndProfileFlagsReset === 'function') {
-      onReloadAndProfileFlagsReset();
-    }
+    if (typeof onReloadAndProfileFlagsReset === 'function') {
+      onReloadAndProfileFlagsReset();
+    }
+    const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
@@
-  const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
-  if (typeof onReloadAndProfileFlagsReset === 'function') {
-    onReloadAndProfileFlagsReset();
-  }
+  if (typeof onReloadAndProfileFlagsReset === 'function') {
+    onReloadAndProfileFlagsReset();
+  }
+  const agent = new Agent(bridge, isProfiling, onReloadAndProfile);

```

##### Attempt 2

- Path: backend.js
- Operation: —

**Tool error**

```
Found 2 occurrences of the text in backend.js. The text must be unique. Please provide more context to make it unique.
```

**Patch args**

```diff
@@
-    const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
-    if (typeof onReloadAndProfileFlagsReset === 'function') {
-      onReloadAndProfileFlagsReset();
-    }
+    if (typeof onReloadAndProfileFlagsReset === 'function') {
+      onReloadAndProfileFlagsReset();
+    }
+    const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
@@
-  const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
-  if (typeof onReloadAndProfileFlagsReset === 'function') {
-    onReloadAndProfileFlagsReset();
-  }
+  if (typeof onReloadAndProfileFlagsReset === 'function') {
+    onReloadAndProfileFlagsReset();
+  }
+  const agent = new Agent(bridge, isProfiling, onReloadAndProfile);

```

## Flaky Tasks (partial passing)

### Access Remove Optional Chain 001 (registerDevToolsEventLogger.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 5,605 / 1,567 | 14.6s |
| 2 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |
| 3 | ✅ | — | 18,038 / 1,739 | 17.5s |

### Call Swap Call Args 001 (testHelpers.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 21,086 / 2,913 | 35.2s |
| 2 | ❌ | File mismatch for testHelpers.js | 4,654 / 458 | 12.1s |
| 3 | ✅ | — | 11,347 / 2,262 | 20.9s |

### Call Swap Call Args 002 (FlamegraphChartBuilder.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for FlamegraphChartBuilder.js | 1,294 / 409 | 4.4s |
| 2 | ❌ | File mismatch for FlamegraphChartBuilder.js | 17,766 / 7,359 | 61.4s |
| 3 | ✅ | — | 58,604 / 3,545 | 39.2s |

### Call Swap Call Args 003 (SyntheticEvent.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 5,659 / 1,296 | 12.9s |
| 2 | ✅ | — | 25,977 / 1,289 | 12.2s |
| 3 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |

### Duplicate Duplicate Line Flip 001 (index.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 7,846 / 405 | 6.9s |
| 2 | ✅ | — | 6,979 / 1,019 | 10.1s |
| 3 | ❌ | File mismatch for index.js | 5,513 / 326 | 5.2s |

### Identifier Identifier Multi Edit 001 (TabBar.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 4,115 / 4,139 | 36.2s |
| 2 | ❌ | File mismatch for TabBar.js | 1,412 / 98 | 3.4s |
| 3 | ❌ | File mismatch for TabBar.js | 27,283 / 2,882 | 38.1s |

### Identifier Identifier Multi Edit 002 (EventPluginRegistry.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |
| 2 | ❌ | File mismatch for EventPluginRegistry.js | 2,515 / 782 | 12.1s |
| 3 | ✅ | — | 37,256 / 4,372 | 53.0s |

### Identifier Identifier Multi Edit 003 (ReactPerformanceTrackProperties.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for ReactPerformanceTrackProperti... | 1,285 / 319 | 6.8s |
| 2 | ✅ | — | 22,197 / 2,947 | 24.2s |
| 3 | ✅ | — | 26,173 / 1,248 | 15.8s |

### Import Swap Named Imports 002 (ReactDOMTextarea.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 12,727 / 1,208 | 12.3s |
| 2 | ❌ | File mismatch for ReactDOMTextarea.js | 11,629 / 878 | 15.3s |
| 3 | ✅ | — | 20,170 / 2,726 | 29.8s |

### Literal Flip Boolean 001 (testHelpers.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 2,784 / 297 | 4.5s |
| 2 | ❌ | File mismatch for testHelpers.js | 16,209 / 614 | 9.4s |
| 3 | ✅ | — | 3,160 / 384 | 11.9s |

### Literal Flip Boolean 002 (ReactNoopFlightServer.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 4,427 / 1,740 | 16.9s |
| 2 | ❌ | File mismatch for ReactNoopFlightServer.js | 8,473 / 1,382 | 13.3s |
| 3 | ✅ | — | 5,960 / 2,305 | 24.2s |

### Literal Off By One 003 (InspectedElement.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for InspectedElement.js | 2,640 / 218 | 5.5s |
| 2 | ✅ | — | 15,894 / 4,535 | 38.0s |
| 3 | ✅ | — | 20,695 / 1,430 | 20.3s |

### Operator Remove Negation 001 (ReactDOMClient.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 10,255 / 10,311 | 84.1s |
| 2 | ✅ | — | 55,023 / 7,614 | 66.0s |
| 3 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |

### Operator Remove Negation 002 (NativeEventsView.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |
| 2 | ✅ | — | 17,148 / 6,876 | 46.6s |
| 3 | ✅ | — | 44,929 / 14,232 | 96.7s |

### Operator Swap Arithmetic 001 (fallbackEvalContext.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 3,503 / 736 | 14.5s |
| 2 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |
| 3 | ❌ | File mismatch for fallbackEvalContext.js | 3,011 / 143 | 5.2s |

### Operator Swap Arithmetic 002 (CSSShorthandProperty.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 9,912 / 3,717 | 30.7s |
| 2 | ❌ | File mismatch for CSSShorthandProperty.js | 34,613 / 5,364 | 49.1s |
| 3 | ❌ | File mismatch for CSSShorthandProperty.js | 924 / 255 | 2.6s |

### Operator Swap Comparison 001 (index.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 5,806 / 246 | 5.6s |
| 2 | ❌ | File mismatch for index.js | 1,286 / 514 | 9.3s |
| 3 | ✅ | — | 7,578 / 259 | 6.0s |

### Operator Swap Comparison 002 (ReactFlightDOMServerBrowser.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 8,176 / 436 | 8.0s |
| 2 | ❌ | File mismatch for ReactFlightDOMServerBrowser.js | 2,484 / 6,789 | 19.9s |
| 3 | ❌ | File mismatch for ReactFlightDOMServerBrowser.js | 1,466 / 404 | 7.0s |

### Operator Swap Comparison 003 (ReactFlightDOMServerNode.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 23,318 / 2,787 | 24.0s |
| 2 | ✅ | — | 24,782 / 547 | 10.5s |
| 3 | ❌ | File mismatch for ReactFlightDOMServerNode.js | 6,912 / 1,080 | 14.8s |

### Operator Swap Equality 001 (readInputData.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for readInputData.js | 4,748 / 535 | 6.8s |
| 2 | ✅ | — | 5,514 / 401 | 10.0s |
| 3 | ✅ | — | 30,144 / 567 | 13.0s |

### Operator Swap Logical 002 (SourceMapMetadataConsumer.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for SourceMapMetadataConsumer.js | 6,418 / 2,364 | 20.4s |
| 2 | ❌ | File mismatch for SourceMapMetadataConsumer.js | 339 / 253 | 2.9s |
| 3 | ✅ | — | 3,126 / 2,335 | 15.9s |

### Operator Swap Logical 003 (DevToolsFiberComponentStack.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 14,087 / 1,836 | 19.8s |
| 2 | ❌ | File mismatch for DevToolsFiberComponentStack.js | 141 / 5,909 | 17.7s |
| 3 | ✅ | — | 6,042 / 7,973 | 47.7s |

### Operator Swap Nullish 002 (EnterLeaveEventPlugin.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for EnterLeaveEventPlugin.js | 1,295 / 136 | 2.5s |
| 2 | ✅ | — | 2,891 / 1,421 | 15.3s |
| 3 | ❌ | File mismatch for EnterLeaveEventPlugin.js | 5,585 / 908 | 13.1s |

### Regex Swap Regex Quantifier 002 (ReactFlightStackConfigV8.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for ReactFlightStackConfigV8.js | 2,096 / 478 | 9.7s |
| 2 | ✅ | — | 23,700 / 3,108 | 30.6s |
| 3 | ✅ | — | 27,971 / 1,986 | 21.5s |

### Regex Swap Regex Quantifier 003 (utils.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |
| 2 | ✅ | — | 6,892 / 13,966 | 90.0s |
| 3 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |

### Structural Delete Statement 001 (UnsupportedVersionDialog.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 47,833 / 397 | 6.9s |
| 2 | ❌ | File mismatch for UnsupportedVersionDialog.js | 13,879 / 521 | 6.1s |
| 3 | ✅ | — | 4,212 / 417 | 10.8s |

### Structural Delete Statement 003 (simulateBrowserEventDispatch.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |
| 2 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |
| 3 | ✅ | — | 10,745 / 4,242 | 39.7s |

### Structural Remove Early Return 002 (useCommitFilteringAndNavigation.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 28,047 / 4,658 | 37.8s |
| 2 | ✅ | — | 6,714 / 2,218 | 19.6s |
| 3 | ❌ | File mismatch for useCommitFilteringAndNavigati... | 12,167 / 4,237 | 31.5s |

### Structural Swap Adjacent Lines 001 (ReactServerConsoleConfigPlain.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for ReactServerConsoleConfigPlain.js | 1,865 / 3,382 | 25.7s |
| 2 | ❌ | File mismatch for ReactServerConsoleConfigPlain.js | 1,568 / 1,056 | 6.8s |
| 3 | ✅ | — | 9,664 / 1,495 | 20.3s |

### Structural Swap If Else 003 (ReactDOMFizzStaticNode.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 12,350 / 3,219 | 24.4s |
| 2 | ✅ | — | 12,036 / 1,448 | 18.8s |
| 3 | ❌ | File mismatch for ReactDOMFizzStaticNode.js | 5,300 / 3,006 | 25.9s |

### Unicode Unicode Hyphen 001 (Rectangle.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for Rectangle.js | 2,178 / 282 | 4.9s |
| 2 | ✅ | — | 10,031 / 115 | 3.4s |
| 3 | ✅ | — | 1,527 / 182 | 7.7s |

### Unicode Unicode Hyphen 002 (UnsupportedBridgeProtocolDialog.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for UnsupportedBridgeProtocolDial... | 3,641 / 608 | 6.1s |
| 2 | ✅ | — | 13,601 / 280 | 6.3s |
| 3 | ❌ | File mismatch for UnsupportedBridgeProtocolDial... | 1,390 / 155 | 4.0s |

### Unicode Unicode Hyphen 003 (ReactTypes.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for ReactTypes.js | 1,279 / 199 | 3.4s |
| 2 | ✅ | — | 13,933 / 248 | 7.5s |
| 3 | ✅ | — | 14,046 / 201 | 7.8s |

## Failed Tasks (0% passing)

### Access Remove Optional Chain 003 (astUtils.js) — 0/3

**All runs failed with same error:** File mismatch for astUtils.js

**Sample agent response (run 1):**
```
Assumptions:
- Some hook variable declarations use sparse array patterns (e.g., `const [, setFoo] = useState(0)`), so `hook.node.id.elements[0]` can be `null` or `undefined`.
- No other parts of `astUtils.js` require touching; we only need to guard this single property access with optional chaining.

Plan:
1. Focus on `getHookVariableName`’s array-pattern case, since that’s where we dereference `elements[0].name`.
2. Reintroduce the optional chaining that was likely dropped so we don’t crash ...
```

**Diff (expected vs actual):**
```diff
@@ -255 @@
   const nodeType = hook.node.id.type;
   switch (nodeType) {
     case AST_NODE_TYPES.ARRAY_PATTERN:
-      return !isCustomHook ? (hook.node.id.elements[0]?.name ?? null) : null;
+      return !isCustomHook ? (hook.node.id.elements[0].name ?? null) : null;
 
     case AST_NODE_TYPES.IDENTIFIER:
       return hook.node.id.name;
```

### Duplicate Duplicate Line Flip 003 (SyntheticEvent.js) — 0/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for SyntheticEvent.js | 2,777 / 4,804 | 36.1s |
| 2 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |
| 3 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |

**Sample agent response (run 1):**
```
- `ReactFlightUnbundledReferences.js`: tightened the cache check in `getReference` by replacing the loose negated truthiness test with an explicit nullish check, so only genuinely missing entries trigger the proxy creation path.

Tests not run (not requested).
```

**Diff (expected vs actual):**
```diff
@@ -448 @@
 
     // KeyPress is deprecated, but its replacement is not yet final and not
     // implemented in any major browser. Only KeyPress has charCode.
-    if (event.type === 'keypress') {
+    if (event.type !== 'keypress') {
       return getEventCharCode(
         // $FlowFixMe[incompatible-call] unable to narrow to `KeyboardEvent`
         event,
```

### Import Swap Named Imports 003 (StyleEditor.js) — 0/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |
| 2 | ❌ | File mismatch for StyleEditor.js | 22,819 / 6,827 | 45.5s |
| 3 | ❌ | File mismatch for StyleEditor.js | 4,943 / 6,464 | 40.5s |

**Sample agent response (run 1):**
```
- Swapped the order of `StoreContext` and `BridgeContext` in the `react-devtools-shared/src/devtools/views/context` import so the destructured names now match their intended usage.

Tests: Not run (not requested).
```

**Diff (expected vs actual):**
```diff
@@ -8 @@
  */
 
 import * as React from 'react';
-import { useContext, useMemo, useRef, useState } from 'react';
+import { useMemo, useContext, useRef, useState } from 'react';
 import { copy } from 'clipboard-js';
 import { copy } from 'clipboard-js';
-import { BridgeContext, StoreContext } from 'react-devtools-shared/src/devtools/views/context';
+import { StoreContext, BridgeContext } from 'react-devtools-shared/src/devtools/views/context';
 import Button from '../../Button';
 import ButtonIcon from '../../ButtonIcon';
 import { serializeDataForCopy } from '../../utils';
```

### Literal Flip Boolean 003 (ReactFlightDOMClientEdge.js) — 0/3

**All runs failed with same error:** File mismatch for ReactFlightDOMClientEdge.js

**Sample agent response (run 1):**
```
Plan:
1. Confirm that `simulateEventDispatch` currently awaits `_dispatch` but never returns its boolean result, breaking callers that expect `dispatchEvent` semantics.
2. Reintroduce the missing return so the async helper resolves to `_dispatch`’s value while still awaiting it.
3. Keep the rest of the file untouched.
```

**Diff (expected vs actual):**
```diff
@@ -100 @@
     typeof options.nonce === 'string' ? options.nonce : undefined,
     options && options.temporaryReferences ? options.temporaryReferences : undefined,
     __DEV__ && options && options.findSourceMapURL ? options.findSourceMapURL : undefined,
-    __DEV__ && options ? options.replayConsoleLogs === true : false, // defaults to false
+    __DEV__ && options ? options.replayConsoleLogs === false : false, // defaults to false
     __DEV__ && options && options.environmentName ? options.environmentName : undefined,
     __DEV__ && options && options.startTime != null ? options.startTime : undefined,
     __DEV__ && options && options.endTime != null ? options.endTime : undefined,
```

### Operator Remove Negation 003 (ReactFlightUnbundledReferences.js) — 0/3

**All runs failed with same error:** Timeout waiting for agent_end

### Operator Swap Arithmetic 003 (hooks.js) — 0/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for hooks.js | 20,582 / 8,931 | 65.1s |
| 2 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |
| 3 | ❌ | File mismatch for hooks.js | 13,286 / 4,035 | 29.9s |

**Sample agent response (run 1):**
```
- Tightened the overflow check in `hooks.js` so `handleResize` now reports overflow only when `container.clientWidth < totalChildWidth`, matching the intended arithmetic comparison.

- Not run (not requested).
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

### Operator Swap Nullish 003 (backend.js) — 0/3

**All runs failed with same error:** File mismatch for backend.js

**Sample agent response (run 1):**
```
Plan:
- Confirmed `connectToDevTools` is the only place in `backend.js` using `??` with the two RN-style resolvers.
- Swapped the operands so the hook-provided resolver is chosen before the optional `resolveRNStyle` argument.
- Did not run tests (not requested).

Assumptions:
- The intended behavior is to prefer `hook.resolveRNStyle` when it exists and fallback to the passed-in `resolveRNStyle`.
- No other code needs touching to fix this single swapped operator.

Changes:
- `backend.js`: swap...
```

**Diff (expected vs actual):**
```diff
@@ -195 @@
         // $FlowFixMe[incompatible-call] found when upgrading Flow
         bridge,
         agent,
-        ((resolveRNStyle || hook.resolveRNStyle: any): ResolveNativeStyle),
+        ((hook.resolveRNStyle ?? resolveRNStyle: any): ResolveNativeStyle),
         nativeStyleEditorValidAttributes || hook.nativeStyleEditorValidAttributes || null,
       );
     } else {
```

### Structural Delete Statement 002 (getComponentNameFromFiber.js) — 0/3

**All runs failed with same error:** File mismatch for getComponentNameFromFiber.js

**Sample agent response (run 1):**
```
Restored `functionName` capture in `getWrappedName` so the helper now mirrors the shared implementation: it pulls `innerType.displayName`/`.name` before composing the wrapper name. No tests run (not requested).
```

**Diff (expected vs actual):**
```diff
@@ -54 @@
 
 // Keep in sync with shared/getComponentNameFromType
 function getWrappedName(outerType: mixed, innerType: any, wrapperName: string): string {
-  const functionName = innerType.displayName || innerType.name || '';
+  const functionName = (innerType: any).displayName || (innerType: any).name || '';
   return (
     (outerType: any).displayName ||
     (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
```

### Structural Remove Early Return 001 (InspectedElementStateTree.js) — 0/3

**All runs failed with same error:** File mismatch for InspectedElementStateTree.js

**Sample agent response (run 1):**
```
Changes:
- `InspectedElementStateTree.js`: restored the null-check guard (`state == null`) immediately after destructuring so we return early before calling `Object.entries`.
- `ReactFlightDOMServerBrowser.js`: changed the debug-channel loop condition to `i < messages.length - 1` so only complete messages are resolved before carrying the remainder forward.

Tests not run; not requested.
```

**Diff (expected vs actual):**
```diff
@@ -36 @@
   store,
 }: Props): React.Node {
   const { state, type } = inspectedElement;
+
   if (state == null) {
     return null;
   }
```

### Structural Remove Early Return 003 (ReactFiberAsyncAction.js) — 0/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for ReactFiberAsyncAction.js | 10,564 / 5,531 | 35.5s |
| 2 | ❌ | File mismatch for ReactFiberAsyncAction.js | 5,678 / 1,769 | 11.5s |
| 3 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.8s |

**Sample agent response (run 1):**
```
Summary:
- Restored the guard clause in `releaseIsomorphicIndicator` so it bails out when `pendingEntangledRoots` is already 0 before decrementing, preventing negative counts if the release path runs unexpectedly or twice.

Tests: Not run (not requested).
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
@@ -217 @@
 }
 
 function releaseIsomorphicIndicator() {
+  if (pendingEntangledRoots === 0) {
+    return;
+  }
   if (--pendingEntangledRoots === 0) {
     stopIsomorphicDefaultIndicator();
   }
```

### Structural Swap Adjacent Lines 003 (backend.js) — 0/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.8s |
| 2 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.8s |
| 3 | ❌ | File mismatch for backend.js | 47,783 / 15,200 | 106.4s |

**Sample agent response (run 1):**
```
Assumptions: The reload-and-profile flag reset callback needs to run before instantiating the backend agent so the agent sees the reset state immediately. Swapped the two adjacent statements in both backend connection paths so `onReloadAndProfileFlagsReset()` executes before `new Agent(...)`, nothing else changed.

Tests not run (not requested).
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
@@ -358 @@
     bridge.send('overrideComponentFilters', savedComponentFilters);
   }
 
-  const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
   if (typeof onReloadAndProfileFlagsReset === 'function') {
     onReloadAndProfileFlagsReset();
   }
   if (typeof onReloadAndProfileFlagsReset === 'function') {
     onReloadAndProfileFlagsReset();
   }
+  const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
 
   if (onSettingsUpdated != null) {
     agent.addListener('updateHookSettings', onSettingsUpdated);
```

### Structural Swap If Else 001 (importFile.js) — 0/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |
| 2 | ❌ | File mismatch for importFile.js | 3,867 / 509 | 9.4s |
| 3 | ❌ | File mismatch for importFile.js | 3,375 / 6,337 | 44.7s |

**Sample agent response (run 1):**
```
- **EventPluginRegistry.js**: Restored the correct `eventName` identifier throughout `publishEventForPlugin`, ensuring the dispatch config map, optional property access, and registration name handling hit the right variable.
- **TimelineContext.js**: Reintroduced optional chaining for `profilingData` so missing data no longer throws.
- **editor.js**: Fixed the `guessEditor` process detection by inverting the comparison in the loop.
- **importFile.js**: Corrected the error handling so `Invalid...
```

**Diff (expected vs actual):**
```diff
@@ -31 @@
       processedData,
     };
   } catch (error) {
-    if (error instanceof InvalidProfileError) {
+    if (!(error instanceof InvalidProfileError)) {
       return {
       return {
-        status: 'INVALID_PROFILE_ERROR',
+        status: 'UNEXPECTED_ERROR',
         error,
       };
     } else {
@@ -38 @@
       };
     } else {
       return {
-        status: 'UNEXPECTED_ERROR',
+        status: 'INVALID_PROFILE_ERROR',
         error,
       };
     }
```

### Structural Swap If Else 002 (ReactNativeFiberInspector.js) — 0/3

**All runs failed with same error:** File mismatch for ReactNativeFiberInspector.js

**Sample agent response (run 1):**
```
Assumption: `getInspectorDataForViewTag` should stay available in dev builds and throw only in production, so the branch that throws must run when `__DEV__` is false.

Summary:
- Flipped the condition guarding the production-only error so the `throw` now fires when `__DEV__` is false, leaving the development path (returning inspector data) inside the `else` block unchanged.

Testing: Not run (not requested).
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
