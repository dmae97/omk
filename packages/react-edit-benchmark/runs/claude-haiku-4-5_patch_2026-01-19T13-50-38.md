# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-01-19T13:45:20.687Z |
| Model | anthropic/p-anthropic/claude-haiku-4-5 |
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
| Successful Runs | 101 |
| **Task Success Rate** | **56.1% (101/180)** |
| Verified Rate | 56.1% (101/180) |
| Edit Tool Usage Rate | 98.3% (177/180) |
| **Edit Success Rate** | **98.3%** |
| Patch Failure Rate | 1.7% (4/240) |
| Tasks All Passing | 20 |
| Tasks Flaky/Failing | 40 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 387 | 2.1 |
| Edit | 240 | 1.3 |
| Write | 5 | 0.0 |
| **Tool Input Chars** | 152,698 | 848 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 4,112 | 23 |
| Output Tokens | 181,227 | 1,007 |
| Total Tokens | 14,085,828 | 78,255 |
| Duration | 2680.8s | 14.9s |
| **Avg Indent Score** | — | **2.18** |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Access Remove Optional Chain 001 | registerDevToolsEventLogger.js | 3/3 ✅ | 100.0% | 2/1/0 | 18/841 | 12.6s | 1.00 |
| Access Remove Optional Chain 002 | TimelineContext.js | 0/3 ❌ | 100.0% | 1/1/0 | 14/582 | 9.9s | 1.29 |
| Access Remove Optional Chain 003 | astUtils.js | 0/3 ❌ | 100.0% | 8/3/0 | 64/4,873 | 52.1s | 4.85 |
| Call Swap Call Args 001 | testHelpers.js | 2/3 ⚠️ | 100.0% | 3/2/0 | 27/771 | 13.5s | 1.33 |
| Call Swap Call Args 002 | FlamegraphChartBuilder.js | 1/3 ⚠️ | 100.0% | 2/1/0 | 22/1,325 | 17.1s | 3.79 |
| Call Swap Call Args 003 | SyntheticEvent.js | 1/3 ⚠️ | 100.0% | 2/2/0 | 26/1,389 | 16.5s | 3.76 |
| Duplicate Duplicate Line Flip 001 | index.js | 3/3 ✅ | 100.0% | 1/1/0 | 16/443 | 9.2s | 0.00 |
| Duplicate Duplicate Line Flip 002 | ActivityList.js | 3/3 ✅ | 100.0% | 1/1/0 | 14/485 | 8.2s | 3.61 |
| Duplicate Duplicate Line Flip 003 | SyntheticEvent.js | 3/3 ✅ | 100.0% | 1/1/0 | 15/880 | 12.0s | 1.02 |
| Identifier Identifier Multi Edit 001 | TabBar.js | 2/3 ⚠️ | 100.0% | 3/3/0 | 37/1,175 | 17.6s | 3.27 |
| Identifier Identifier Multi Edit 002 | EventPluginRegistry.js | 3/3 ✅ | 100.0% | 1/2/0 | 19/901 | 12.6s | 3.94 |
| Identifier Identifier Multi Edit 003 | ReactPerformanceTrackProperties.js | 2/3 ⚠️ | 100.0% | 9/3/0 | 69/1,978 | 29.7s | 9.95 |
| Import Swap Named Imports 001 | CommitFlamegraphListItem.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 15/605 | 9.2s | 2.86 |
| Import Swap Named Imports 002 | ReactDOMTextarea.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 13/391 | 7.6s | 2.36 |
| Import Swap Named Imports 003 | StyleEditor.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 18/1,826 | 18.8s | 1.31 |
| Literal Flip Boolean 001 | testHelpers.js | 3/3 ✅ | 100.0% | 1/1/0 | 17/422 | 7.2s | 1.33 |
| Literal Flip Boolean 002 | ReactNoopFlightServer.js | 0/3 ❌ | 100.0% | 1/1/0 | 16/766 | 11.8s | 1.11 |
| Literal Flip Boolean 003 | ReactFlightDOMClientEdge.js | 1/3 ⚠️ | 75.0% | 2/1/0 | 19/788 | 12.3s | 3.58 |
| Literal Off By One 001 | githubAPI.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 14/442 | 7.2s | 0.47 |
| Literal Off By One 002 | code-path.js | 1/3 ⚠️ | 100.0% | 3/2/0 | 35/1,013 | 16.2s | 3.50 |
| Literal Off By One 003 | InspectedElement.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 16/581 | 10.0s | 1.20 |
| Operator Remove Negation 001 | ReactDOMClient.js | 1/3 ⚠️ | 100.0% | 2/1/0 | 16/693 | 51.1s | 1.08 |
| Operator Remove Negation 002 | NativeEventsView.js | 3/3 ✅ | 100.0% | 2/1/0 | 19/620 | 10.3s | 3.03 |
| Operator Remove Negation 003 | ReactFlightUnbundledReferences.js | 0/3 ❌ | 100.0% | 4/1/0 | 33/1,025 | 17.7s | 2.00 |
| Operator Swap Arithmetic 001 | fallbackEvalContext.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 13/5,318 | 5.8s | 0.00 |
| Operator Swap Arithmetic 002 | CSSShorthandProperty.js | 3/3 ✅ | 100.0% | 1/1/0 | 14/361 | 8.6s | 2.88 |
| Operator Swap Arithmetic 003 | hooks.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 15/1,080 | 15.1s | 1.50 |
| Operator Swap Comparison 001 | index.js | 3/3 ✅ | 100.0% | 1/1/0 | 16/365 | 7.9s | 0.00 |
| Operator Swap Comparison 002 | ReactFlightDOMServerBrowser.js | 0/3 ❌ | 100.0% | 1/1/0 | 15/571 | 9.3s | 1.57 |
| Operator Swap Comparison 003 | ReactFlightDOMServerNode.js | 1/3 ⚠️ | 100.0% | 2/1/0 | 22/757 | 11.7s | 1.95 |
| Operator Swap Equality 001 | readInputData.js | 3/3 ✅ | 100.0% | 1/1/0 | 16/482 | 7.3s | 0.00 |
| Operator Swap Equality 002 | editor.js | 2/3 ⚠️ | 75.0% | 1/1/0 | 17/506 | 8.1s | 0.00 |
| Operator Swap Equality 003 | hooks.js | 3/3 ✅ | 100.0% | 2/1/0 | 21/618 | 11.5s | 2.25 |
| Operator Swap Increment Decrement 001 | ReactFlightDOMClientNode.js | 3/3 ✅ | 100.0% | 1/1/0 | 14/414 | 7.4s | 1.52 |
| Operator Swap Increment Decrement 002 | ReactFlightDOMClientNode.js | 2/3 ⚠️ | 100.0% | 3/1/0 | 23/828 | 14.0s | 1.92 |
| Operator Swap Increment Decrement 003 | loadSourceAndMetadata.js | 3/3 ✅ | 100.0% | 3/1/0 | 29/738 | 14.3s | 3.72 |
| Operator Swap Logical 001 | profiling.js | 2/3 ⚠️ | 100.0% | 3/2/1 | 39/1,407 | 18.3s | 0.00 |
| Operator Swap Logical 002 | SourceMapMetadataConsumer.js | 0/3 ❌ | 100.0% | 1/2/0 | 20/1,056 | 13.8s | 3.11 |
| Operator Swap Logical 003 | DevToolsFiberComponentStack.js | 3/3 ✅ | 100.0% | 1/1/0 | 17/533 | 9.9s | 4.13 |
| Operator Swap Nullish 001 | getBatchRange.js | 3/3 ✅ | 100.0% | 1/1/0 | 15/524 | 8.3s | 1.33 |
| Operator Swap Nullish 002 | EnterLeaveEventPlugin.js | 1/3 ⚠️ | 100.0% | 4/2/0 | 34/1,938 | 22.5s | 1.56 |
| Operator Swap Nullish 003 | backend.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 15/698 | 10.8s | 3.15 |
| Regex Swap Regex Quantifier 001 | githubAPI.js | 3/3 ✅ | 100.0% | 1/1/0 | 16/443 | 7.9s | 0.67 |
| Regex Swap Regex Quantifier 002 | ReactFlightStackConfigV8.js | 1/3 ⚠️ | 100.0% | 4/3/0 | 39/1,902 | 24.9s | 3.06 |
| Regex Swap Regex Quantifier 003 | utils.js | 2/3 ⚠️ | 100.0% | 2/1/0 | 15/600 | 49.0s | 2.00 |
| Structural Delete Statement 001 | UnsupportedVersionDialog.js | 3/3 ✅ | 100.0% | 2/1/0 | 20/556 | 9.8s | 6.22 |
| Structural Delete Statement 002 | getComponentNameFromFiber.js | 0/3 ❌ | 100.0% | 2/1/0 | 19/566 | 10.8s | 0.62 |
| Structural Delete Statement 003 | simulateBrowserEventDispatch.js | 1/3 ⚠️ | 100.0% | 6/3/0 | 55/3,318 | 40.8s | 4.46 |
| Structural Remove Early Return 001 | InspectedElementStateTree.js | 0/3 ❌ | 100.0% | 3/1/0 | 26/904 | 13.6s | 0.36 |
| Structural Remove Early Return 002 | useCommitFilteringAndNavigation.js | 2/3 ⚠️ | 100.0% | 3/1/0 | 22/737 | 14.8s | 3.79 |
| Structural Remove Early Return 003 | ReactFiberAsyncAction.js | 0/3 ❌ | 100.0% | 1/1/0 | 14/645 | 8.7s | 1.45 |
| Structural Swap Adjacent Lines 001 | ReactServerConsoleConfigPlain.js | 3/3 ✅ | 100.0% | 3/2/0 | 35/1,408 | 20.0s | 1.00 |
| Structural Swap Adjacent Lines 002 | ReactNoopFlightServer.js | 0/3 ❌ | 100.0% | 2/1/0 | 17/550 | 9.9s | 0.74 |
| Structural Swap Adjacent Lines 003 | backend.js | 0/3 ❌ | 85.7% | 7/2/0 | 56/2,514 | 32.3s | 1.03 |
| Structural Swap If Else 001 | importFile.js | 1/3 ⚠️ | 100.0% | 2/1/0 | 21/582 | 10.8s | 0.00 |
| Structural Swap If Else 002 | ReactNativeFiberInspector.js | 0/3 ❌ | 100.0% | 1/1/0 | 16/540 | 8.2s | 3.18 |
| Structural Swap If Else 003 | ReactDOMFizzStaticNode.js | 2/3 ⚠️ | 80.0% | 3/2/0 | 25/912 | 13.7s | 1.26 |
| Unicode Unicode Hyphen 001 | Rectangle.js | 3/3 ✅ | 100.0% | 1/1/0 | 15/346 | 7.1s | 3.00 |
| Unicode Unicode Hyphen 002 | UnsupportedBridgeProtocolDialog.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 15/418 | 7.4s | 3.79 |
| Unicode Unicode Hyphen 003 | ReactTypes.js | 3/3 ✅ | 100.0% | 1/1/0 | 17/461 | 8.4s | 1.24 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 9 | 33.3% (3/9) | 100.0% (9/9) | 33.3% (3/9) | 7 / 8.7 / 10 |
| call | 9 | 44.4% (4/9) | 100.0% (9/9) | 44.4% (4/9) | 6 / 7.7 / 10 |
| duplicate | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) | 7 / 9.7 / 12 |
| identifier | 9 | 77.8% (7/9) | 100.0% (9/9) | 77.8% (7/9) | 6 / 9.3 / 14 |
| import | 9 | 55.6% (5/9) | 100.0% (9/9) | 55.6% (5/9) | 2 / 4.7 / 6 |
| literal | 18 | 44.4% (8/18) | 100.0% (18/18) | 44.4% (8/18) | 4 / 6.2 / 9 |
| operator | 63 | 61.9% (39/63) | 96.8% (61/63) | 61.9% (39/63) | 1 / 6.5 / 13 |
| regex | 9 | 66.7% (6/9) | 88.9% (8/9) | 66.7% (6/9) | 6 / 7.3 / 8 |
| structural | 36 | 33.3% (12/36) | 100.0% (36/36) | 33.3% (12/36) | 4 / 7.6 / 15 |
| unicode | 9 | 88.9% (8/9) | 100.0% (9/9) | 88.9% (8/9) | 1 / 3.0 / 6 |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 9 | 44.4% (4/9) | 100.0% (9/9) | 44.4% (4/9) |
| duplicate-line-flip | duplicate | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) |
| flip-boolean | literal | 9 | 44.4% (4/9) | 100.0% (9/9) | 44.4% (4/9) |
| identifier-multi-edit | identifier | 9 | 77.8% (7/9) | 100.0% (9/9) | 77.8% (7/9) |
| off-by-one | literal | 9 | 44.4% (4/9) | 100.0% (9/9) | 44.4% (4/9) |
| remove-early-return | structural | 9 | 22.2% (2/9) | 100.0% (9/9) | 22.2% (2/9) |
| remove-negation | operator | 9 | 44.4% (4/9) | 88.9% (8/9) | 44.4% (4/9) |
| remove-optional-chain | access | 9 | 33.3% (3/9) | 100.0% (9/9) | 33.3% (3/9) |
| swap-adjacent-lines | structural | 9 | 33.3% (3/9) | 100.0% (9/9) | 33.3% (3/9) |
| swap-arithmetic | operator | 9 | 55.6% (5/9) | 100.0% (9/9) | 55.6% (5/9) |
| swap-call-args | call | 9 | 44.4% (4/9) | 100.0% (9/9) | 44.4% (4/9) |
| swap-comparison | operator | 9 | 44.4% (4/9) | 100.0% (9/9) | 44.4% (4/9) |
| swap-equality | operator | 9 | 88.9% (8/9) | 100.0% (9/9) | 88.9% (8/9) |
| swap-if-else | structural | 9 | 33.3% (3/9) | 100.0% (9/9) | 33.3% (3/9) |
| swap-increment-decrement | operator | 9 | 88.9% (8/9) | 88.9% (8/9) | 88.9% (8/9) |
| swap-logical | operator | 9 | 55.6% (5/9) | 100.0% (9/9) | 55.6% (5/9) |
| swap-named-imports | import | 9 | 55.6% (5/9) | 100.0% (9/9) | 55.6% (5/9) |
| swap-nullish | operator | 9 | 55.6% (5/9) | 100.0% (9/9) | 55.6% (5/9) |
| swap-regex-quantifier | regex | 9 | 66.7% (6/9) | 88.9% (8/9) | 66.7% (6/9) |
| unicode-hyphen | unicode | 9 | 88.9% (8/9) | 100.0% (9/9) | 88.9% (8/9) |

## Difficulty Summary

| Difficulty Score | Runs | Verified | Edit Used | Success |
|------------------|------|----------|-----------|---------|
| 0-2 | 18 | 66.7% (12/18) | 94.4% (17/18) | 66.7% (12/18) |
| 3-5 | 36 | 52.8% (19/36) | 97.2% (35/36) | 52.8% (19/36) |
| 6-8 | 72 | 61.1% (44/72) | 98.6% (71/72) | 61.1% (44/72) |
| 9+ | 54 | 48.1% (26/54) | 100.0% (54/54) | 48.1% (26/54) |

## Edit Tool Errors

Failures where the edit tool returned an error or failed to apply the patch.

### Literal Flip Boolean 003 (ReactFlightDOMClientEdge.js)

#### Run 3

##### Attempt 1

- Path: ./ReactFlightDOMClientEdge.js
- Operation: —

**Tool error**

```
Diff contains no hunks
```

**Patch args**

```diff
@@ __DEV__ && options ? options.replayConsoleLogs === false : false, // defaults to false
```

### Operator Swap Equality 002 (editor.js)

#### Run 3

##### Attempt 1

- Path: editor.js
- Operation: —

**Tool error**

```
Failed to find expected lines in editor.js:
          return [COMMON_EDITORS[processName]];
        }
```
```

**Patch args**

```diff
@@ if (output.indexOf(processName) !== -1) {
           return [COMMON_EDITORS[processName]];
         }
```

```

### Structural Swap Adjacent Lines 003 (backend.js)

#### Run 2

##### Attempt 1

- Path: backend.js
- Operation: —

**Tool error**

```
Found 2 matches for context 'const agent = new Agent(bridge, isProfiling, onReloadAndProfile);' in backend.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
   if (onSettingsUpdated != null) {
     agent.addListener('updateHookSettings', onSettingsUpdated);
   }
   agent.addListener('shutdown', () => {
     if (onSettingsUpdated != null) {
       agent.removeListener('updateHookSettings', onSettingsUpdated);
     }
 
     // If we received 'shutdown' from `agent`, we assume the `bridge` is already shutting down,
     // and that caused the 'shutdown' event on the `agent`, so we don't need to call `bridge.shutdown()` here.
     hook.emit('shutdown');
   });
-
-  const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
-  if (typeof onReloadAndProfileFlagsReset === 'function') {
-    onReloadAndProfileFlagsReset();
-  } @@
+  const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
+  if (typeof onReloadAndProfileFlagsReset === 'function') {
+    onReloadAndProfileFlagsReset();
+  }
+
   if (onSettingsUpdated != null) {
     agent.addListener('updateHookSettings', onSettingsUpdated);
   }
   agent.addListener('shutdown', () => {
     if (onSettingsUpdated != null) {
       agent.removeListener('updateHookSettings', onSettingsUpdated);
     }
 
     // If we received 'shutdown' from `agent`, we assume the `bridge` is already shutting down,
     // and that caused the 'shutdown' event on the `agent`, so we don't need to call `bridge.shutdown()` here.
     hook.emit('shutdown');
   });

```

### Structural Swap If Else 003 (ReactDOMFizzStaticNode.js)

#### Run 3

##### Attempt 1

- Path: ./ReactDOMFizzStaticNode.js
- Operation: —

**Tool error**

```
Found 4 matches for context 'if (options && options.signal) {' in ./ReactDOMFizzStaticNode.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ if (options && options.signal) {
-    if (options && options.signal) {
+    if (options && options.signal) {
+      const signal = options.signal;
+      if (signal.aborted) {
+        abort(request, (signal: any).reason);
+      } else {
         const listener = () => {
           abort(request, (signal: any).reason);
           signal.removeEventListener('abort', listener);
         };
         signal.addEventListener('abort', listener);
       }
-      } else {
-      const signal = options.signal;
-      if (signal.aborted) {
-        abort(request, (signal: any).reason);
-      }
     }

```

## Flaky Tasks (partial passing)

### Call Swap Call Args 001 (testHelpers.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 29 / 719 | 14.0s |
| 2 | ✅ | — | 19 / 625 | 10.2s |
| 3 | ❌ | File mismatch for testHelpers.js | 33 / 968 | 16.4s |

### Call Swap Call Args 002 (FlamegraphChartBuilder.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for FlamegraphChartBuilder.js | 31 / 1,850 | 23.0s |
| 2 | ❌ | File mismatch for FlamegraphChartBuilder.js | 15 / 1,082 | 12.4s |
| 3 | ✅ | — | 19 / 1,044 | 16.0s |

### Call Swap Call Args 003 (SyntheticEvent.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for SyntheticEvent.js | 45 / 2,399 | 27.2s |
| 2 | ✅ | — | 19 / 835 | 11.8s |
| 3 | ❌ | File mismatch for SyntheticEvent.js | 15 / 933 | 10.5s |

### Identifier Identifier Multi Edit 001 (TabBar.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 33 / 848 | 13.9s |
| 2 | ✅ | — | 65 / 1,700 | 27.2s |
| 3 | ❌ | File mismatch for TabBar.js | 13 / 978 | 11.7s |

### Identifier Identifier Multi Edit 003 (ReactPerformanceTrackProperties.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for ReactPerformanceTrackProperti... | 20 / 562 | 10.5s |
| 2 | ✅ | — | 122 / 3,600 | 51.2s |
| 3 | ✅ | — | 64 / 1,771 | 27.5s |

### Import Swap Named Imports 001 (CommitFlamegraphListItem.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 15 / 449 | 7.9s |
| 2 | ✅ | — | 15 / 725 | 10.6s |
| 3 | ❌ | File mismatch for CommitFlamegraphListItem.js | 14 / 640 | 9.2s |

### Import Swap Named Imports 002 (ReactDOMTextarea.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 12 / 408 | 9.6s |
| 2 | ❌ | File mismatch for ReactDOMTextarea.js | 13 / 380 | 6.3s |
| 3 | ❌ | File mismatch for ReactDOMTextarea.js | 13 / 385 | 6.9s |

### Import Swap Named Imports 003 (StyleEditor.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 15 / 660 | 9.0s |
| 2 | ✅ | — | 15 / 3,705 | 30.1s |
| 3 | ❌ | File mismatch for StyleEditor.js | 24 / 1,114 | 17.4s |

### Literal Flip Boolean 003 (ReactFlightDOMClientEdge.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for ReactFlightDOMClientEdge.js | 13 / 399 | 7.0s |
| 2 | ❌ | File mismatch for ReactFlightDOMClientEdge.js | 15 / 577 | 9.9s |
| 3 | ✅ | — | 30 / 1,388 | 20.1s |

### Literal Off By One 001 (githubAPI.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 15 / 468 | 7.4s |
| 2 | ❌ | File mismatch for githubAPI.js | 15 / 358 | 6.6s |
| 3 | ✅ | — | 13 / 501 | 7.6s |

### Literal Off By One 002 (code-path.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 15 / 491 | 7.6s |
| 2 | ❌ | File mismatch for code-path.js | 75 / 2,070 | 33.2s |
| 3 | ❌ | File mismatch for code-path.js | 15 / 478 | 7.9s |

### Literal Off By One 003 (InspectedElement.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for InspectedElement.js | 13 / 462 | 8.5s |
| 2 | ✅ | — | 15 / 667 | 10.6s |
| 3 | ❌ | File mismatch for InspectedElement.js | 19 / 613 | 10.9s |

### Operator Remove Negation 001 (ReactDOMClient.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 13 / 1,078 | 12.8s |
| 2 | ❌ | File mismatch for ReactDOMClient.js | 36 / 1,000 | 19.6s |
| 3 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.8s |

### Operator Swap Arithmetic 001 (fallbackEvalContext.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 15 / 311 | 6.1s |
| 2 | ❌ | File mismatch for fallbackEvalContext.js | 12 / 15,299 | 4.8s |
| 3 | ❌ | File mismatch for fallbackEvalContext.js | 12 / 344 | 6.4s |

### Operator Swap Arithmetic 003 (hooks.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for hooks.js | 15 / 1,855 | 24.5s |
| 2 | ❌ | File mismatch for hooks.js | 15 / 1,036 | 13.0s |
| 3 | ✅ | — | 15 / 350 | 7.9s |

### Operator Swap Comparison 003 (ReactFlightDOMServerNode.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 37 / 1,082 | 16.8s |
| 2 | ❌ | File mismatch for ReactFlightDOMServerNode.js | 13 / 510 | 8.7s |
| 3 | ❌ | File mismatch for ReactFlightDOMServerNode.js | 15 / 680 | 9.5s |

### Operator Swap Equality 002 (editor.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 15 / 421 | 6.5s |
| 2 | ❌ | File mismatch for editor.js | 13 / 400 | 7.1s |
| 3 | ✅ | — | 22 / 696 | 10.8s |

### Operator Swap Increment Decrement 002 (ReactFlightDOMClientNode.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 19 / 579 | 15.1s |
| 2 | ❌ | File mismatch for ReactFlightDOMClientNode.js | 17 / 900 | 11.4s |
| 3 | ✅ | — | 34 / 1,004 | 15.6s |

### Operator Swap Logical 001 (profiling.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 63 / 2,530 | 34.0s |
| 2 | ✅ | — | 27 / 974 | 11.0s |
| 3 | ❌ | File mismatch for profiling.js | 27 / 716 | 9.8s |

### Operator Swap Nullish 002 (EnterLeaveEventPlugin.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 51 / 1,515 | 23.5s |
| 2 | ❌ | File mismatch for EnterLeaveEventPlugin.js | 13 / 3,244 | 28.3s |
| 3 | ❌ | File mismatch for EnterLeaveEventPlugin.js | 38 / 1,054 | 15.6s |

### Operator Swap Nullish 003 (backend.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for backend.js | 15 / 526 | 7.5s |
| 2 | ✅ | — | 15 / 733 | 10.2s |
| 3 | ❌ | File mismatch for backend.js | 15 / 836 | 14.8s |

### Regex Swap Regex Quantifier 002 (ReactFlightStackConfigV8.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for ReactFlightStackConfigV8.js | 82 / 3,238 | 43.9s |
| 2 | ✅ | — | 15 / 878 | 11.1s |
| 3 | ❌ | File mismatch for ReactFlightStackConfigV8.js | 20 / 1,589 | 19.7s |

### Regex Swap Regex Quantifier 003 (utils.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.8s |
| 2 | ✅ | — | 15 / 458 | 7.9s |
| 3 | ✅ | — | 30 / 1,343 | 18.4s |

### Structural Delete Statement 003 (simulateBrowserEventDispatch.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for simulateBrowserEventDispatch.js | 136 / 8,950 | 103.1s |
| 2 | ✅ | — | 15 / 474 | 8.7s |
| 3 | ❌ | File mismatch for simulateBrowserEventDispatch.js | 15 / 531 | 10.5s |

### Structural Remove Early Return 002 (useCommitFilteringAndNavigation.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for useCommitFilteringAndNavigati... | 24 / 699 | 15.6s |
| 2 | ✅ | — | 18 / 689 | 12.6s |
| 3 | ✅ | — | 24 / 822 | 16.2s |

### Structural Swap If Else 001 (importFile.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for importFile.js | 21 / 575 | 11.3s |
| 2 | ✅ | — | 21 / 522 | 10.6s |
| 3 | ❌ | File mismatch for importFile.js | 21 / 650 | 10.5s |

### Structural Swap If Else 003 (ReactDOMFizzStaticNode.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 15 / 533 | 7.6s |
| 2 | ✅ | — | 24 / 838 | 14.4s |
| 3 | ❌ | File mismatch for ReactDOMFizzStaticNode.js | 37 / 1,364 | 19.2s |

### Unicode Unicode Hyphen 002 (UnsupportedBridgeProtocolDialog.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 15 / 421 | 8.0s |
| 2 | ✅ | — | 15 / 466 | 7.7s |
| 3 | ❌ | File mismatch for UnsupportedBridgeProtocolDial... | 15 / 367 | 6.6s |

## Failed Tasks (0% passing)

### Access Remove Optional Chain 002 (TimelineContext.js) — 0/3

**All runs failed with same error:** File mismatch for TimelineContext.js

**Sample agent response (run 1):**
```
Done. I've restored the optional chaining operators (`?.`) at line 87 in the `getState` function within `inMemoryTimelineData`. The property access now safely chains through `store.profilerStore?.profilingData?.timelineData` instead of the unsafe direct access that was there.
```

**Diff (expected vs actual):**
```diff
@@ -80 @@
       };
     },
     function getState() {
-      return store.profilerStore.profilingData?.timelineData || null;
+      return store.profilerStore?.profilingData?.timelineData || null;
     },
   );
 
```

### Access Remove Optional Chain 003 (astUtils.js) — 0/3

**All runs failed with same error:** File mismatch for astUtils.js

**Sample agent response (run 1):**
```
Perfect! The fix is in place. The optional chaining has been restored on line 420:

**Before (buggy):**
```javascript
? path.scope.bindings[hookDeclaredVariableName]?.referencePaths
```

**After (fixed):**
```javascript
? path.scope.bindings?.[hookDeclaredVariableName]?.referencePaths
```

The issue was that `path.scope.bindings[hookDeclaredVariableName]` could be null/undefined, but optional chaining was only applied to the `.referencePaths` property access. Now it's applied to the computed ...
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
@@ -383 @@
           // declared variable name as the Hook name.
           const referencePaths =
             hookDeclaredVariableName != null
-              ? path.scope.bindings[hookDeclaredVariableName]?.referencePaths
+              ? path.scope.bindings?.[hookDeclaredVariableName]?.referencePaths
               : null;
           if (referencePaths == null) {
             pushFrame(hookDeclaredVariableName, callExpressionNode);
```

### Literal Flip Boolean 002 (ReactNoopFlightServer.js) — 0/3

**All runs failed with same error:** File mismatch for ReactNoopFlightServer.js

**Sample agent response (run 1):**
```
Fixed. The boolean literal at line 97 was inverted. The condition `options.debugChannel !== undefined` should be `options.debugChannel === undefined` to properly indicate when the debug channel is NOT available (the intended inverted value).
```

**Diff (expected vs actual):**
```diff
@@ -37 @@
   },
   writeChunkAndReturn(destination: Destination, chunk: string): boolean {
     destination.push(chunk);
-    return true;
+    return false;
   },
   completeWriting(destination: Destination): void {},
   close(destination: Destination): void {},
@@ -83 @@
     undefined,
     __DEV__ && options ? options.environmentName : undefined,
     __DEV__ && options ? options.filterStackFrame : undefined,
-    __DEV__ && options && options.debugChannel !== undefined,
+    __DEV__ && options && options.debugChannel === undefined,
   );
   const signal = options ? options.signal : undefined;
   if (signal) {
```

### Operator Remove Negation 003 (ReactFlightUnbundledReferences.js) — 0/3

**All runs failed with same error:** File mismatch for ReactFlightUnbundledReferences.js

**Sample agent response (run 1):**
```
Perfect. The negation operator has been fixed. Changed from `if (!descriptor)` to `if (descriptor)`, so now the logic correctly:
- Returns the existing descriptor immediately if it exists
- Only creates and defines a new descriptor if one doesn't exist
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

### Operator Swap Comparison 002 (ReactFlightDOMServerBrowser.js) — 0/3

**All runs failed with same error:** File mismatch for ReactFlightDOMServerBrowser.js

**Sample agent response (run 1):**
```
Perfect. The comparison operator has been fixed. Changed from `<=` (less than or equal to) with `messages.length - 1` to `<` (less than) with `messages.length`, which is the correct and idiomatic way to iterate through array elements.
```

**Diff (expected vs actual):**
```diff
@@ -69 @@
       ? readFinalStringChunk(stringDecoder, new Uint8Array(0))
       : readPartialStringChunk(stringDecoder, buffer);
     const messages = stringBuffer.split('\n');
-    for (let i = 0; i < messages.length - 1; i++) {
+    for (let i = 0; i < messages.length; i++) {
       resolveDebugMessage(request, messages[i]);
     }
     stringBuffer = messages[messages.length - 1];
```

### Operator Swap Logical 002 (SourceMapMetadataConsumer.js) — 0/3

**All runs failed with same error:** File mismatch for SourceMapMetadataConsumer.js

**Sample agent response (run 1):**
```
Fixed. Changed the first `&&` to `||` on line 50. The condition now correctly checks: "if sourceRoot exists OR (sourceRoot is absolute AND source is absolute)" before making the source relative.
```

**Diff (expected vs actual):**
```diff
@@ -45 @@
   // be particularly problematic when the source root is a prefix of the
   // source (valid, but why??). See github issue #199 and bugzil.la/1188982.
   source =
-    sourceRoot != null && util.isAbsolute(sourceRoot) && util.isAbsolute(source)
+    sourceRoot != null || (util.isAbsolute(sourceRoot) && util.isAbsolute(source))
       ? util.relative(sourceRoot, source)
       : source;
   return util.computeSourceURL(sourceRoot, source);
```

### Structural Delete Statement 002 (getComponentNameFromFiber.js) — 0/3

**All runs failed with same error:** File mismatch for getComponentNameFromFiber.js

**Sample agent response (run 1):**
```
Done. Restored the missing statement that defines `functionName` by calling `getComponentNameFromType(innerType)` in the `getWrappedName` function.
```

**Diff (expected vs actual):**
```diff
@@ -54 @@
 
 // Keep in sync with shared/getComponentNameFromType
 function getWrappedName(outerType: mixed, innerType: any, wrapperName: string): string {
-  const functionName = innerType.displayName || innerType.name || '';
+  const functionName = getComponentNameFromType(innerType);
   return (
     (outerType: any).displayName ||
     (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
```

### Structural Remove Early Return 001 (InspectedElementStateTree.js) — 0/3

**All runs failed with same error:** File mismatch for InspectedElementStateTree.js

**Sample agent response (run 1):**
```
Perfect. The guard clause has been restored. The fix adds the missing 3-line pattern:
- Line 41: `if (!state) {`
- Line 42: `return null;`
- Line 43: `}`

This ensures that if `state` is null or undefined, the component returns early before attempting to use it on subsequent lines. The fix is minimal and preserves all existing code structure and formatting.
```

**Diff (expected vs actual):**
```diff
@@ -36 @@
   store,
 }: Props): React.Node {
   const { state, type } = inspectedElement;
-  if (state == null) {
+
+  if (!state) {
     return null;
   }
     return null;
   }
-
   // HostSingleton and HostHoistable may have state that we don't want to expose to users
   const isHostComponent = type === ElementTypeHostComponent;
   const entries = Object.entries(state);
```

### Structural Remove Early Return 003 (ReactFiberAsyncAction.js) — 0/3

**All runs failed with same error:** File mismatch for ReactFiberAsyncAction.js

**Sample agent response (run 1):**
```
Done. Added the missing guard clause to return early if `isomorphicDefaultTransitionIndicator === null`. This prevents attempting to call `null` as a function on line 193.
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
@@ -195 @@
   if (!needsIsomorphicIndicator) {
     return;
   }
+  if (isomorphicDefaultTransitionIndicator === null) {
+    return;
+  }
   if (isomorphicDefaultTransitionIndicator != null && pendingIsomorphicIndicator === null) {
     try {
       pendingIsomorphicIndicator = isomorphicDefaultTransitionIndicator() || noop;
```

### Structural Swap Adjacent Lines 002 (ReactNoopFlightServer.js) — 0/3

**All runs failed with same error:** File mismatch for ReactNoopFlightServer.js

**Sample agent response (run 1):**
```
Perfect. The two adjacent lines have been swapped. The `return textEncoder.encode(content);` statement now comes before the `flushBuffered` method definition, which restores the correct order. The `stringToChunk` method is now properly closed, and `flushBuffered` follows as a separate method definition.
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
I see the issue - my previous edit created a duplicate. Let me undo this and do it correctly. I need to reverse the order of the two statements. Let me read the exact current state:
```

**Diff (expected vs actual):**
```diff
@@ -9 @@
 
 import Agent from 'react-devtools-shared/src/backend/agent';
 import Bridge from 'react-devtools-shared/src/bridge';
-import { installHook } from 'react-devtools-shared/src/hook';
-import { initBackend } from 'react-devtools-shared/src/backend';
-import { __DEBUG__ } from 'react-devtools-shared/src/constants';
+import {installHook} from 'react-devtools-shared/src/hook';
+import {initBackend} from 'react-devtools-shared/src/backend';
+import {__DEBUG__} from 'react-devtools-shared/src/constants';
 import setupNativeStyleEditor from 'react-devtools-shared/src/backend/NativeStyleEditor/setupNativeStyleEditor';
 import {
   getDefaultComponentFilters,
@@ -18 @@
   getIsReloadAndProfileSupported,
 } from 'react-devtools-shared/src/utils';
 
-import type { BackendBridge } from 'react-devtools-shared/src/bridge';
-import type { ComponentFilter, Wall } from 'react-devtools-shared/src/frontend/types';
+import type {BackendBridge} from 'react-devtools-shared/src/bridge';
 import type {
 import type {
+  ComponentFilter,
+  Wall,
+} from 'react-devtools-shared/src/frontend/types';
+import type {
   DevToolsHook,
   DevToolsHookSettings,
   ProfilingSettings,
@@ -25 @@
   DevToolsHookSettings,
   ProfilingSettings,
 } from 'react-devtools-shared/src/backend/types';
-import type { ResolveNativeStyle } from 'react-devtools-shared/src/backend/NativeStyleEditor/setupNativeStyleEditor';
+import type {ResolveNativeStyle} from 'react-devtools-shared/src/backend/NativeStyleEditor/setupNativeStyleEditor';
 
 type ConnectOptions = {
   host?: string,
@@ -43 @@
   onReloadAndProfileFlagsReset?: () => void,
 };
 
-let savedComponentFilters: Array<ComponentFilter> = getDefaultComponentFilters();
+let savedComponentFilters: Array<ComponentFilter> =
+  getDefaultComponentFilters();
 
 function debug(methodName: string, ...args: Array<mixed>) {
   if (__DEBUG__) {
@@ -57 @@
 }
 
 export function initialize(
-  maybeSettingsOrSettingsPromise?: DevToolsHookSettings | Promise<DevTo...
```

### Structural Swap If Else 002 (ReactNativeFiberInspector.js) — 0/3

**All runs failed with same error:** File mismatch for ReactNativeFiberInspector.js

**Sample agent response (run 1):**
```
Fixed. Negated the condition from `if (__DEV__)` to `if (!__DEV__)` so that the error is thrown in production (where it should be unavailable) and the inspector data is returned in development mode.
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
