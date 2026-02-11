# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-02-11T06:00:33.207Z |
| Model | openrouter/openrouter/google/gemini-3-flash |
| Thinking Level | default |
| Runs per task | 1 |
| Edit Variant | patch |
| Edit Fuzzy | auto |
| Edit Fuzzy Threshold | auto |
| Guided Mode | no |
| Max Attempts | 1 |
| Require Edit Tool | no |
| Require Read Tool | no |
| No-Edit Baseline | no |

## Summary

| Metric | Value |
|--------|-------|
| Total Tasks | 60 |
| Total Runs | 60 |
| Successful Runs | 44 |
| **Task Success Rate** | **73.3% (44/60)** |
| Verified Rate | 73.3% (44/60) |
| Edit Tool Usage Rate | 80.0% (48/60) |
| **Edit Success Rate** | **91.5%** |
| Timeout Runs | 0 |
| Mutation Intent Match Rate | 88.0% |
| Patch Failure Rate | 8.5% (5/59) |
| Tasks All Passing | 44 |
| Tasks Flaky/Failing | 16 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 139 | 2.3 |
| Edit | 59 | 1.0 |
| Write | 0 | 0.0 |
| **Tool Input Chars** | 23,319 | 389 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 2,100,270 | 35,005 |
| Output Tokens | 340,868 | 5,681 |
| Total Tokens | 4,298,332 | 71,639 |
| Duration | 3539.6s | 59.0s |
| **Avg Indent Score** | — | **2.20** |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Access Remove Optional Chain 001 | registerDevToolsEventLogger.js | 1/1 ✅ | 100.0% | 3/1/0 | 54,112/14,688 | 65.4s | 1.00 |
| Access Remove Optional Chain 002 | TimelineContext.js | 1/1 ✅ | 50.0% | 2/2/0 | 41,339/6,697 | 66.2s | 1.29 |
| Access Remove Optional Chain 003 | astUtils.js | 1/1 ✅ | 100.0% | 2/1/0 | 29,392/11,763 | 41.6s | 4.85 |
| Call Swap Call Args 001 | testHelpers.js | 1/1 ✅ | 100.0% | 1/1/0 | 19,439/2,068 | 23.8s | 1.33 |
| Call Swap Call Args 002 | FlamegraphChartBuilder.js | 1/1 ✅ | 100.0% | 2/1/0 | 26,496/5,447 | 24.2s | 3.79 |
| Call Swap Call Args 003 | SyntheticEvent.js | 1/1 ✅ | 100.0% | 2/1/0 | 34,852/13,173 | 49.3s | 3.76 |
| Duplicate Duplicate Line Flip 001 | index.js | 1/1 ✅ | 100.0% | 1/1/0 | 25,500/1,188 | 8.6s | 0.00 |
| Duplicate Duplicate Line Flip 002 | ActivityList.js | 1/1 ✅ | 100.0% | 2/1/0 | 28,154/3,283 | 17.5s | 3.61 |
| Duplicate Duplicate Line Flip 003 | SyntheticEvent.js | 1/1 ✅ | 100.0% | 2/1/0 | 36,612/6,987 | 60.0s | 1.02 |
| Identifier Identifier Multi Edit 001 | TabBar.js | 1/1 ✅ | 100.0% | 2/1/0 | 41,731/10,428 | 44.3s | 3.33 |
| Identifier Identifier Multi Edit 002 | EventPluginRegistry.js | 1/1 ✅ | 100.0% | 3/1/0 | 51,522/9,886 | 42.2s | 3.94 |
| Identifier Identifier Multi Edit 003 | ReactPerformanceTrackProperties.js | 1/1 ✅ | 100.0% | 3/1/0 | 61,358/4,639 | 69.2s | 9.95 |
| Import Swap Named Imports 001 | CommitFlamegraphListItem.js | 1/1 ✅ | 100.0% | 1/1/0 | 23,906/6,267 | 26.6s | 2.86 |
| Import Swap Named Imports 002 | ReactDOMTextarea.js | 1/1 ✅ | 100.0% | 4/1/0 | 28,833/10,025 | 102.2s | 2.41 |
| Import Swap Named Imports 003 | StyleEditor.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 120.5s | 0.00 |
| Literal Flip Boolean 001 | testHelpers.js | 1/1 ✅ | 100.0% | 1/1/0 | 15,792/1,414 | 36.6s | 1.33 |
| Literal Flip Boolean 002 | ReactNoopFlightServer.js | 1/1 ✅ | 100.0% | 3/1/0 | 35,850/9,038 | 100.9s | 1.11 |
| Literal Flip Boolean 003 | ReactFlightDOMClientEdge.js | 1/1 ✅ | 100.0% | 4/1/0 | 60,632/5,388 | 33.3s | 3.58 |
| Literal Off By One 001 | githubAPI.js | 1/1 ✅ | 100.0% | 1/1/0 | 18,934/1,173 | 9.1s | 0.67 |
| Literal Off By One 002 | code-path.js | 1/1 ✅ | 100.0% | 2/1/0 | 44,699/6,445 | 27.6s | 3.50 |
| Literal Off By One 003 | InspectedElement.js | 1/1 ✅ | 100.0% | 2/1/0 | 39,712/10,254 | 39.9s | 3.60 |
| Operator Remove Negation 001 | ReactDOMClient.js | 1/1 ✅ | 100.0% | 5/5/0 | 118,385/2,202 | 62.7s | 1.08 |
| Operator Remove Negation 002 | NativeEventsView.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 120.4s | 0.00 |
| Operator Remove Negation 003 | ReactFlightUnbundledReferences.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 120.6s | 0.00 |
| Operator Swap Arithmetic 001 | fallbackEvalContext.js | 1/1 ✅ | 50.0% | 1/2/0 | 17,796/3,936 | 39.0s | 0.00 |
| Operator Swap Arithmetic 002 | CSSShorthandProperty.js | 0/1 ❌ | 100.0% | 1/0/0 | 13,899/13 | 32.0s | 2.88 |
| Operator Swap Arithmetic 003 | hooks.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 120.6s | 0.00 |
| Operator Swap Comparison 001 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 29,977/5,487 | 91.8s | 0.00 |
| Operator Swap Comparison 002 | ReactFlightDOMServerBrowser.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 120.3s | 0.00 |
| Operator Swap Comparison 003 | ReactFlightDOMServerNode.js | 1/1 ✅ | 100.0% | 3/1/0 | 35,084/11,208 | 42.1s | 1.95 |
| Operator Swap Equality 001 | readInputData.js | 1/1 ✅ | 100.0% | 1/1/0 | 23,335/1,705 | 33.4s | 0.00 |
| Operator Swap Equality 002 | editor.js | 1/1 ✅ | 100.0% | 1/1/0 | 28,595/1,867 | 33.8s | 0.00 |
| Operator Swap Equality 003 | hooks.js | 1/1 ✅ | 100.0% | 2/1/0 | 44,770/3,949 | 26.3s | 2.25 |
| Operator Swap Increment Decrement 001 | ReactFlightDOMClientNode.js | 1/1 ✅ | 100.0% | 1/1/0 | 18,567/1,687 | 41.0s | 1.52 |
| Operator Swap Increment Decrement 002 | ReactFlightDOMClientNode.js | 1/1 ✅ | 25.0% | 3/4/0 | 75,149/4,852 | 39.5s | 1.92 |
| Operator Swap Increment Decrement 003 | loadSourceAndMetadata.js | 1/1 ✅ | 100.0% | 1/1/0 | 34,049/1,346 | 10.6s | 3.72 |
| Operator Swap Logical 001 | profiling.js | 1/1 ✅ | 100.0% | 1/1/0 | 18,853/1,613 | 10.1s | 0.00 |
| Operator Swap Logical 002 | SourceMapMetadataConsumer.js | 1/1 ✅ | 100.0% | 3/1/0 | 42,189/5,505 | 55.8s | 3.14 |
| Operator Swap Logical 003 | DevToolsFiberComponentStack.js | 1/1 ✅ | 100.0% | 2/1/0 | 33,058/4,836 | 36.3s | 4.13 |
| Operator Swap Nullish 001 | getBatchRange.js | 1/1 ✅ | 100.0% | 1/1/0 | 18,422/287 | 5.7s | 1.33 |
| Operator Swap Nullish 002 | EnterLeaveEventPlugin.js | 1/1 ✅ | 100.0% | 18/1/0 | 211,888/21,399 | 117.5s | 1.56 |
| Operator Swap Nullish 003 | backend.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 120.6s | 0.00 |
| Regex Swap Regex Quantifier 001 | githubAPI.js | 1/1 ✅ | 100.0% | 3/1/0 | 28,411/5,168 | 68.5s | 0.67 |
| Regex Swap Regex Quantifier 002 | ReactFlightStackConfigV8.js | 0/1 ❌ | 100.0% | 20/0/0 | 173,667/21,249 | 119.5s | 3.06 |
| Regex Swap Regex Quantifier 003 | utils.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 120.6s | 0.00 |
| Structural Delete Statement 001 | UnsupportedVersionDialog.js | 1/1 ✅ | 100.0% | 1/1/0 | 24,752/4,281 | 33.1s | 6.22 |
| Structural Delete Statement 002 | getComponentNameFromFiber.js | 1/1 ✅ | 100.0% | 3/1/0 | 35,126/3,562 | 53.0s | 0.62 |
| Structural Delete Statement 003 | simulateBrowserEventDispatch.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 120.6s | 0.00 |
| Structural Remove Early Return 001 | InspectedElementStateTree.js | 0/1 ❌ | 100.0% | 3/1/0 | 35,707/7,498 | 76.7s | 0.36 |
| Structural Remove Early Return 002 | useCommitFilteringAndNavigation.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 120.6s | 0.00 |
| Structural Remove Early Return 003 | ReactFiberAsyncAction.js | 0/1 ❌ | 100.0% | 2/1/0 | 35,182/18,863 | 62.7s | 1.46 |
| Structural Swap Adjacent Lines 001 | ReactServerConsoleConfigPlain.js | 1/1 ✅ | 100.0% | 3/1/0 | 33,442/4,247 | 21.7s | 1.00 |
| Structural Swap Adjacent Lines 002 | ReactNoopFlightServer.js | 1/1 ✅ | 100.0% | 2/1/0 | 26,293/6,051 | 46.1s | 1.11 |
| Structural Swap Adjacent Lines 003 | backend.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 120.4s | 0.00 |
| Structural Swap If Else 001 | importFile.js | 0/1 ❌ | 100.0% | 1/1/0 | 26,730/22,546 | 78.8s | 0.00 |
| Structural Swap If Else 002 | ReactNativeFiberInspector.js | 0/1 ❌ | 100.0% | 5/3/0 | 77,427/28,506 | 102.3s | 3.18 |
| Structural Swap If Else 003 | ReactDOMFizzStaticNode.js | 1/1 ✅ | 100.0% | 1/1/0 | 30,333/617 | 7.9s | 1.88 |
| Unicode Unicode Hyphen 001 | Rectangle.js | 1/1 ✅ | 100.0% | 2/1/0 | 27,562/1,131 | 35.4s | 3.00 |
| Unicode Unicode Hyphen 002 | UnsupportedBridgeProtocolDialog.js | 1/1 ✅ | 100.0% | 2/1/0 | 23,618/1,522 | 11.9s | 3.83 |
| Unicode Unicode Hyphen 003 | ReactTypes.js | 1/1 ✅ | 100.0% | 2/1/0 | 39,139/3,484 | 50.5s | 1.24 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 7 / 8.7 / 10 |
| call | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 6 / 7.7 / 10 |
| duplicate | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 7 / 9.7 / 12 |
| identifier | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 6 / 9.3 / 14 |
| import | 3 | 66.7% (2/3) | 66.7% (2/3) | 66.7% (2/3) | 2 / 4.7 / 6 |
| literal | 6 | 100.0% (6/6) | 100.0% (6/6) | 100.0% (6/6) | 4 / 6.2 / 9 |
| operator | 21 | 71.4% (15/21) | 71.4% (15/21) | 71.4% (15/21) | 1 / 6.5 / 13 |
| regex | 3 | 33.3% (1/3) | 33.3% (1/3) | 33.3% (1/3) | 6 / 7.3 / 8 |
| structural | 12 | 41.7% (5/12) | 75.0% (9/12) | 41.7% (5/12) | 4 / 7.6 / 15 |
| unicode | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 1 / 3.0 / 6 |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 3 | 66.7% (2/3) | 66.7% (2/3) | 66.7% (2/3) |
| duplicate-line-flip | duplicate | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| flip-boolean | literal | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| identifier-multi-edit | identifier | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| off-by-one | literal | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| remove-early-return | structural | 3 | 0.0% (0/3) | 66.7% (2/3) | 0.0% (0/3) |
| remove-negation | operator | 3 | 33.3% (1/3) | 33.3% (1/3) | 33.3% (1/3) |
| remove-optional-chain | access | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-adjacent-lines | structural | 3 | 66.7% (2/3) | 66.7% (2/3) | 66.7% (2/3) |
| swap-arithmetic | operator | 3 | 33.3% (1/3) | 33.3% (1/3) | 33.3% (1/3) |
| swap-call-args | call | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-comparison | operator | 3 | 66.7% (2/3) | 66.7% (2/3) | 66.7% (2/3) |
| swap-equality | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-if-else | structural | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) |
| swap-increment-decrement | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-logical | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-named-imports | import | 3 | 66.7% (2/3) | 66.7% (2/3) | 66.7% (2/3) |
| swap-nullish | operator | 3 | 66.7% (2/3) | 66.7% (2/3) | 66.7% (2/3) |
| swap-regex-quantifier | regex | 3 | 33.3% (1/3) | 33.3% (1/3) | 33.3% (1/3) |
| unicode-hyphen | unicode | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |

## Difficulty Summary

| Difficulty Score | Runs | Verified | Edit Used | Success |
|------------------|------|----------|-----------|---------|
| 0-2 | 6 | 100.0% (6/6) | 100.0% (6/6) | 100.0% (6/6) |
| 3-5 | 12 | 75.0% (9/12) | 83.3% (10/12) | 75.0% (9/12) |
| 6-8 | 24 | 70.8% (17/24) | 79.2% (19/24) | 70.8% (17/24) |
| 9+ | 18 | 66.7% (12/18) | 72.2% (13/18) | 66.7% (12/18) |

## Edit Tool Errors

Failures where the edit tool returned an error or failed to apply the patch.

### Access Remove Optional Chain 002 (TimelineContext.js)

#### Run 1

##### Attempt 1

- Path: TimelineContext.js
- Operation: —

**Tool error**

```
Failed to find context '91:lzl|     function getState() {' in /tmp/reach-benchmark-IqxycH/batch-f4ea738e-6bc2-4d4b-8c63-cba06a2aff36/TimelineContext.js
```

**Patch args**

```diff
@@ 91:lzl|     function getState() {
-92:1r8|       return store.profilerStore.profilingData.timelineData || null;
+92:1r8|       return store.profilerStore.profilingData?.timelineData || null;
 93:83a|     },

```

### Operator Swap Arithmetic 001 (fallbackEvalContext.js)

#### Run 1

##### Attempt 1

- Path: fallbackEvalContext.js
- Operation: —

**Tool error**

```
Diff contains no hunks
```

**Patch args**

```diff
@@\n  *\n- / This source code is licensed under the MIT license found in the\n+ * This source code is licensed under the MIT license found in the\n  * LICENSE file in the root directory of this source tree.\n
```

### Operator Swap Increment Decrement 002 (ReactFlightDOMClientNode.js)

#### Run 1

##### Attempt 1

- Path: ReactFlightDOMClientNode.js
- Operation: —

**Tool error**

```
Diff contains no hunks
```

**Patch args**

```diff
@@\n     const handleEnd = () => {\n-      if (--streamEndedCount === 2) {\n+      if (++streamEndedCount === 2) {\n         close(response);\n\n
```

##### Attempt 2

- Path: ReactFlightDOMClientNode.js
- Operation: —

**Tool error**

```
Diff contains no hunks
```

**Patch args**

```diff
@@ const handleEnd = () => {\n     const handleEnd = () => {\n-      if (--streamEndedCount === 2) {\n+      if (++streamEndedCount === 2) {\n         close(response);\n
```

##### Attempt 3

- Path: ReactFlightDOMClientNode.js
- Operation: —

**Tool error**

```
Diff contains no hunks
```

**Patch args**

```diff
@@ if (--streamEndedCount === 2) {\n-      if (--streamEndedCount === 2) {\n+      if (++streamEndedCount === 2) {\n
```

## Failed Tasks (0% passing)

### Import Swap Named Imports 003 (StyleEditor.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 120.5s |

### Operator Remove Negation 002 (NativeEventsView.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 120.4s |

### Operator Remove Negation 003 (ReactFlightUnbundledReferences.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 120.6s |

### Operator Swap Arithmetic 002 (CSSShorthandProperty.js) — 0/1

**All runs failed with same error:** File mismatch for CSSShorthandProperty.js

**Diff (expected vs actual):**
```diff
@@ -2 @@
  * Copyright (c) Meta Platforms, Inc. and affiliates.
  *
  * This source code is licensed under the MIT license found in the
- * LICENSE file in the root directory of this source tree.
+ / LICENSE file in the root directory of this source tree.
  */
 
 // List derived from Gecko source code:
```

### Operator Swap Arithmetic 003 (hooks.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 120.6s |

### Operator Swap Comparison 002 (ReactFlightDOMServerBrowser.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 120.3s |

### Operator Swap Nullish 003 (backend.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 120.6s |

### Regex Swap Regex Quantifier 002 (ReactFlightStackConfigV8.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightStackConfigV8.js

**Diff (expected vs actual):**
```diff
@@ -126 @@
 //     at filename:0:0
 //     at async filename:0:0
 const frameRegExp =
-  /^ {3} at (?:(.+) \((?:(.+):(\d+):(\d+)|\<anonymous\>)\)|(?:async )?(.+):(\d+):(\d+)|\<anonymous\>)$/;
+  /^ {3} at (?:(.+) \((?:(.+):(\d*):(\d+)|\<anonymous\>)\)|(?:async )?(.+):(\d+):(\d+)|\<anonymous\>)$/;
 
 // DEV-only cache of parsed and filtered stack frames.
 const stackTraceCache: WeakMap<Error, ReactStackTrace> = __DEV__ ? new WeakMap() : (null: any);
```

### Regex Swap Regex Quantifier 003 (utils.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 120.6s |

### Structural Delete Statement 003 (simulateBrowserEventDispatch.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 120.6s |

### Structural Remove Early Return 001 (InspectedElementStateTree.js) — 0/1

**All runs failed with same error:** File mismatch for InspectedElementStateTree.js

**Sample agent response (run 1):**
```
Restored the missing guard clause in `InspectedElementStateTree.js` to prevent a crash when `state` is null. Added the 3-line early return pattern starting at line 40, immediately following the `state` destructuring.

```javascript
  const {state, type} = inspectedElement;

  if (state === null) {
    return null;
  }
```

This prevents `Object.entries(state)` from throwing an error when an element has no state attached.
```

**Diff (expected vs actual):**
```diff
@@ -36 @@
   store,
 }: Props): React.Node {
   const { state, type } = inspectedElement;
-  if (state == null) {
+
+  if (state === null) {
     return null;
   }
 
```

### Structural Remove Early Return 002 (useCommitFilteringAndNavigation.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 120.6s |

### Structural Remove Early Return 003 (ReactFiberAsyncAction.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFiberAsyncAction.js

**Sample agent response (run 1):**
```
The bug in `ReactFiberAsyncAction.js` was caused by a missing guard clause in the `entangleAsyncAction` function. When an action scope returns a non-thenable value (like a synchronous return or `undefined`), the function would attempt to call `.then()` on it, leading to a runtime error.

According to the request, I have restored the early return guard clause at the beginning of `entangleAsyncAction` to handle cases where the provided `thenable` is `null` or does not have a `then` method.

```...
```

**Diff (expected vs actual):**
```diff
@@ -56 @@
 let needsIsomorphicIndicator: boolean = false;
 
 export function entangleAsyncAction<S>(transition: Transition, thenable: Thenable<S>): Thenable<S> {
+  if (thenable === null || typeof thenable.then !== 'function') {
+    return thenable;
+  }
   // `thenable` is the return value of the async action scope function. Create
   // a combined thenable that resolves once every entangled scope function
   // has finished.
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

### Structural Swap Adjacent Lines 003 (backend.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 120.4s |

### Structural Swap If Else 001 (importFile.js) — 0/1

**All runs failed with same error:** File mismatch for importFile.js

**Sample agent response (run 1):**
```
The provided bug description indicates that the `if` and `else` branches in `importFile.js` are swapped and the condition is incorrectly identifying the error types. 

Specifically, the current code returns `UNEXPECTED_ERROR` when the error is an instance of `InvalidProfileError`, and `INVALID_PROFILE_ERROR` otherwise. To fix this according to the instructions ("Swap the if and else branch bodies back to their original positions. The condition should be negated to match."), we negate the cond...
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

### Structural Swap If Else 002 (ReactNativeFiberInspector.js) — 0/1

**All runs failed with same error:** File mismatch for ReactNativeFiberInspector.js

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
