# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-02-11T06:03:30.437Z |
| Model | p-anthropic/p-anthropic/claude-haiku-4-5 |
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
| Successful Runs | 38 |
| **Task Success Rate** | **63.3% (38/60)** |
| Verified Rate | 63.3% (38/60) |
| Edit Tool Usage Rate | 100.0% (60/60) |
| **Edit Success Rate** | **97.8%** |
| Timeout Runs | 0 |
| Mutation Intent Match Rate | 70.0% |
| Patch Failure Rate | 2.2% (2/91) |
| Tasks All Passing | 38 |
| Tasks Flaky/Failing | 22 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 116 | 1.9 |
| Edit | 91 | 1.5 |
| Write | 2 | 0.0 |
| **Tool Input Chars** | 64,261 | 1,071 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 1,172 | 20 |
| Output Tokens | 66,639 | 1,111 |
| Total Tokens | 3,583,836 | 59,731 |
| Duration | 801.9s | 13.4s |
| **Avg Indent Score** | — | **2.24** |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Access Remove Optional Chain 001 | registerDevToolsEventLogger.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/423 | 6.4s | 1.00 |
| Access Remove Optional Chain 002 | TimelineContext.js | 0/1 ❌ | 100.0% | 2/1/0 | 16/555 | 7.9s | 1.29 |
| Access Remove Optional Chain 003 | astUtils.js | 0/1 ❌ | 100.0% | 7/2/0 | 48/1,707 | 20.8s | 4.85 |
| Call Swap Call Args 001 | testHelpers.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/475 | 6.9s | 1.33 |
| Call Swap Call Args 002 | FlamegraphChartBuilder.js | 0/1 ❌ | 100.0% | 2/1/0 | 16/657 | 9.0s | 3.79 |
| Call Swap Call Args 003 | SyntheticEvent.js | 0/1 ❌ | 100.0% | 2/2/0 | 21/2,069 | 21.2s | 3.76 |
| Duplicate Duplicate Line Flip 001 | index.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/416 | 6.3s | 0.00 |
| Duplicate Duplicate Line Flip 002 | ActivityList.js | 1/1 ✅ | 100.0% | 2/1/0 | 16/524 | 8.4s | 3.61 |
| Duplicate Duplicate Line Flip 003 | SyntheticEvent.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/839 | 10.2s | 1.02 |
| Identifier Identifier Multi Edit 001 | TabBar.js | 0/1 ❌ | 100.0% | 1/1/0 | 13/476 | 7.9s | 3.33 |
| Identifier Identifier Multi Edit 002 | EventPluginRegistry.js | 1/1 ✅ | 100.0% | 1/3/0 | 23/1,044 | 15.2s | 3.94 |
| Identifier Identifier Multi Edit 003 | ReactPerformanceTrackProperties.js | 0/1 ❌ | 100.0% | 1/1/0 | 13/508 | 7.2s | 9.95 |
| Import Swap Named Imports 001 | CommitFlamegraphListItem.js | 1/1 ✅ | 100.0% | 1/3/0 | 25/1,230 | 14.1s | 2.86 |
| Import Swap Named Imports 002 | ReactDOMTextarea.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/493 | 7.2s | 2.41 |
| Import Swap Named Imports 003 | StyleEditor.js | 1/1 ✅ | 100.0% | 2/1/0 | 16/1,018 | 13.1s | 1.31 |
| Literal Flip Boolean 001 | testHelpers.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/364 | 5.5s | 1.33 |
| Literal Flip Boolean 002 | ReactNoopFlightServer.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/696 | 9.7s | 1.11 |
| Literal Flip Boolean 003 | ReactFlightDOMClientEdge.js | 1/1 ✅ | 100.0% | 2/1/0 | 16/852 | 11.5s | 3.58 |
| Literal Off By One 001 | githubAPI.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/452 | 7.2s | 0.75 |
| Literal Off By One 002 | code-path.js | 1/1 ✅ | 100.0% | 2/3/0 | 31/2,618 | 28.8s | 3.50 |
| Literal Off By One 003 | InspectedElement.js | 1/1 ✅ | 100.0% | 3/2/0 | 24/1,079 | 14.6s | 3.60 |
| Operator Remove Negation 001 | ReactDOMClient.js | 0/1 ❌ | 100.0% | 4/3/0 | 38/2,790 | 32.0s | 1.08 |
| Operator Remove Negation 002 | NativeEventsView.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/572 | 8.1s | 3.03 |
| Operator Remove Negation 003 | ReactFlightUnbundledReferences.js | 0/1 ❌ | 100.0% | 5/2/1 | 34/7,371 | 65.1s | 2.00 |
| Operator Swap Arithmetic 001 | fallbackEvalContext.js | 1/1 ✅ | 50.0% | 1/2/0 | 19/542 | 7.0s | 0.00 |
| Operator Swap Arithmetic 002 | CSSShorthandProperty.js | 1/1 ✅ | 100.0% | 4/1/0 | 25/808 | 14.9s | 2.88 |
| Operator Swap Arithmetic 003 | hooks.js | 0/1 ❌ | 100.0% | 2/3/0 | 28/1,981 | 23.2s | 2.25 |
| Operator Swap Comparison 001 | index.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/398 | 5.6s | 0.00 |
| Operator Swap Comparison 002 | ReactFlightDOMServerBrowser.js | 0/1 ❌ | 100.0% | 1/1/0 | 13/680 | 8.9s | 1.57 |
| Operator Swap Comparison 003 | ReactFlightDOMServerNode.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/811 | 12.0s | 1.95 |
| Operator Swap Equality 001 | readInputData.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/397 | 6.1s | 0.00 |
| Operator Swap Equality 002 | editor.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/380 | 7.6s | 0.17 |
| Operator Swap Equality 003 | hooks.js | 1/1 ✅ | 100.0% | 2/2/0 | 23/873 | 12.5s | 2.25 |
| Operator Swap Increment Decrement 001 | ReactFlightDOMClientNode.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/391 | 6.9s | 1.50 |
| Operator Swap Increment Decrement 002 | ReactFlightDOMClientNode.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/414 | 6.5s | 1.92 |
| Operator Swap Increment Decrement 003 | loadSourceAndMetadata.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/483 | 7.4s | 3.72 |
| Operator Swap Logical 001 | profiling.js | 1/1 ✅ | 100.0% | 4/3/0 | 35/1,293 | 16.1s | 0.00 |
| Operator Swap Logical 002 | SourceMapMetadataConsumer.js | 0/1 ❌ | 100.0% | 1/1/0 | 13/539 | 7.1s | 3.07 |
| Operator Swap Logical 003 | DevToolsFiberComponentStack.js | 1/1 ✅ | 100.0% | 2/2/0 | 24/966 | 14.7s | 4.13 |
| Operator Swap Nullish 001 | getBatchRange.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/419 | 5.6s | 1.33 |
| Operator Swap Nullish 002 | EnterLeaveEventPlugin.js | 1/1 ✅ | 100.0% | 7/4/0 | 41/3,392 | 36.2s | 1.56 |
| Operator Swap Nullish 003 | backend.js | 0/1 ❌ | 100.0% | 1/1/0 | 13/506 | 6.7s | 3.15 |
| Regex Swap Regex Quantifier 001 | githubAPI.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/439 | 6.5s | 0.67 |
| Regex Swap Regex Quantifier 002 | ReactFlightStackConfigV8.js | 1/1 ✅ | 100.0% | 2/1/0 | 16/2,418 | 25.4s | 3.06 |
| Regex Swap Regex Quantifier 003 | utils.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/994 | 12.1s | 1.95 |
| Structural Delete Statement 001 | UnsupportedVersionDialog.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/489 | 7.6s | 6.22 |
| Structural Delete Statement 002 | getComponentNameFromFiber.js | 0/1 ❌ | 100.0% | 1/1/0 | 13/489 | 8.0s | 0.62 |
| Structural Delete Statement 003 | simulateBrowserEventDispatch.js | 0/1 ❌ | 100.0% | 3/3/0 | 28/1,775 | 21.1s | 4.46 |
| Structural Remove Early Return 001 | InspectedElementStateTree.js | 0/1 ❌ | 100.0% | 1/1/0 | 13/477 | 6.8s | 0.36 |
| Structural Remove Early Return 002 | useCommitFilteringAndNavigation.js | 0/1 ❌ | 100.0% | 1/1/0 | 13/532 | 8.0s | 3.73 |
| Structural Remove Early Return 003 | ReactFiberAsyncAction.js | 0/1 ❌ | 100.0% | 2/1/0 | 16/967 | 12.5s | 1.46 |
| Structural Swap Adjacent Lines 001 | ReactServerConsoleConfigPlain.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/614 | 10.8s | 1.00 |
| Structural Swap Adjacent Lines 002 | ReactNoopFlightServer.js | 0/1 ❌ | 100.0% | 2/1/0 | 16/724 | 9.4s | 0.00 |
| Structural Swap Adjacent Lines 003 | backend.js | 0/1 ❌ | 50.0% | 1/2/0 | 19/1,322 | 13.6s | 3.15 |
| Structural Swap If Else 001 | importFile.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/455 | 6.6s | 0.00 |
| Structural Swap If Else 002 | ReactNativeFiberInspector.js | 0/1 ❌ | 100.0% | 1/1/0 | 13/531 | 8.4s | 3.18 |
| Structural Swap If Else 003 | ReactDOMFizzStaticNode.js | 1/1 ✅ | 100.0% | 13/7/1 | 107/8,615 | 75.2s | 1.88 |
| Unicode Unicode Hyphen 001 | Rectangle.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/328 | 6.1s | 3.00 |
| Unicode Unicode Hyphen 002 | UnsupportedBridgeProtocolDialog.js | 0/1 ❌ | 100.0% | 1/1/0 | 13/380 | 5.8s | 3.72 |
| Unicode Unicode Hyphen 003 | ReactTypes.js | 0/1 ❌ | 100.0% | 2/1/0 | 16/589 | 9.4s | 0.00 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) | 7 / 8.7 / 10 |
| call | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) | 6 / 7.7 / 10 |
| duplicate | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 7 / 9.7 / 12 |
| identifier | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) | 6 / 9.3 / 14 |
| import | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 2 / 4.7 / 6 |
| literal | 6 | 100.0% (6/6) | 100.0% (6/6) | 100.0% (6/6) | 4 / 6.2 / 9 |
| operator | 21 | 71.4% (15/21) | 100.0% (21/21) | 71.4% (15/21) | 1 / 6.5 / 13 |
| regex | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 6 / 7.3 / 8 |
| structural | 12 | 33.3% (4/12) | 100.0% (12/12) | 33.3% (4/12) | 4 / 7.6 / 15 |
| unicode | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) | 1 / 3.0 / 6 |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) |
| duplicate-line-flip | duplicate | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| flip-boolean | literal | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| identifier-multi-edit | identifier | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) |
| off-by-one | literal | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| remove-early-return | structural | 3 | 0.0% (0/3) | 100.0% (3/3) | 0.0% (0/3) |
| remove-negation | operator | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) |
| remove-optional-chain | access | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) |
| swap-adjacent-lines | structural | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) |
| swap-arithmetic | operator | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| swap-call-args | call | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) |
| swap-comparison | operator | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| swap-equality | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-if-else | structural | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| swap-increment-decrement | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-logical | operator | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| swap-named-imports | import | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-nullish | operator | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| swap-regex-quantifier | regex | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| unicode-hyphen | unicode | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) |

## Difficulty Summary

| Difficulty Score | Runs | Verified | Edit Used | Success |
|------------------|------|----------|-----------|---------|
| 0-2 | 6 | 66.7% (4/6) | 100.0% (6/6) | 66.7% (4/6) |
| 3-5 | 12 | 75.0% (9/12) | 100.0% (12/12) | 75.0% (9/12) |
| 6-8 | 24 | 66.7% (16/24) | 100.0% (24/24) | 66.7% (16/24) |
| 9+ | 18 | 50.0% (9/18) | 100.0% (18/18) | 50.0% (9/18) |

## Edit Tool Errors

Failures where the edit tool returned an error or failed to apply the patch.

### Operator Swap Arithmetic 001 (fallbackEvalContext.js)

#### Run 1

##### Attempt 1

- Path: fallbackEvalContext.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/reach-benchmark-bCL61b/batch-f3d7705f-7fb4-4194-b2f8-a9dd81bbd570/fallbackEvalContext.js:
3:g67|  *
4:kcg|  / This source code is licensed under the MIT license found in the
5:2l3|  * LICENSE file in the root directory of this source tree.

Closest match (64% similar) near line 3:
  1 | /**
  2 |  * Copyright (c) Meta Platforms, Inc. and affiliates.
  3 |  *
  4 |  / This source code is licensed under the MIT license found in the
  5 |  * LICENSE file in the root directory of this source tree.
```

**Patch args**

```diff
@@ 2:3ar|  * Copyright (c) Meta Platforms, Inc. and affiliates.
 3:g67|  *
-4:kcg|  / This source code is licensed under the MIT license found in the
+4:kcg|  * This source code is licensed under the MIT license found in the
 5:2l3|  * LICENSE file in the root directory of this source tree.
```

### Structural Swap Adjacent Lines 003 (backend.js)

#### Run 1

##### Attempt 1

- Path: backend.js
- Operation: —

**Tool error**

```
Found 2 matches for context 'const agent = new Agent(bridge, isProfiling, onReloadAndProfile);' in /tmp/reach-benchmark-bCL61b/batch-7bdace9f-cde6-4285-939b-9e7f6bb7e0ea/backend.js. Matching strategy: trim.

  190 |     // TODO (npm-packages) Warn if "isBackendStorageAPISupported"
  191 |     // $FlowFixMe[incompatible-call] found when upgrading Flow
  192 |     const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
  193 |     if (typeof onReloadAndProfileFlagsReset === 'function') {
  194 |       onReloadAndProfileFlagsReset();

  386 |   }
  387 | 
  388 |   const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
  389 |   if (typeof onReloadAndProfileFlagsReset === 'function') {
  390 |     onReloadAndProfileFlagsReset();

Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
+   if (typeof onReloadAndProfileFlagsReset === 'function') {
+     onReloadAndProfileFlagsReset();
+   }
+
+   const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
-   if (typeof onReloadAndProfileFlagsReset === 'function') {
-     onReloadAndProfileFlagsReset();
-   }
 
   if (onSettingsUpdated != null) {

```

## Failed Tasks (0% passing)

### Access Remove Optional Chain 002 (TimelineContext.js) — 0/1

**All runs failed with same error:** File mismatch for TimelineContext.js

**Sample agent response (run 1):**
```
Done. The optional chaining operator (`?.`) has been restored at line 92 in the `TimelineContextController` function's `getState()` callback where it safely accesses the nested `store.profilerStore.profilingData.timelineData` property chain.
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

### Access Remove Optional Chain 003 (astUtils.js) — 0/1

**All runs failed with same error:** File mismatch for astUtils.js

**Sample agent response (run 1):**
```
Perfect! The fix is complete. On line 431, I've restored the optional chaining operator:

**Changed:**
```javascript
const referencePath = referencePaths[i];
```

**To:**
```javascript
const referencePath = referencePaths?.[i];
```

This ensures that when the loop counter `i` exceeds `referencePaths.length` (which happens on the last iteration due to the `<=` condition), accessing `referencePaths[i]` safely returns `undefined` instead of throwing an error. The subsequent null check on line 43...
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
@@ -394 @@
           // and for each, we do the following:
           let declaredVariableName = null;
           for (let i = 0; i <= referencePaths.length; i++) {
-            const referencePath = referencePaths[i];
+            const referencePath = referencePaths?.[i];
             if (declaredVariableName != null) {
               break;
             }
```

### Call Swap Call Args 002 (FlamegraphChartBuilder.js) — 0/1

**All runs failed with same error:** File mismatch for FlamegraphChartBuilder.js

**Sample agent response (run 1):**
```
Done. I've swapped the two arguments in the `walkTree` call within the `getChartData` function. The second and third arguments were reversed—`rightOffset` and `currentDepth + 1` are now in their correct order to match the function signature `walkTree(id, rightOffset, currentDepth)`.
```

**Diff (expected vs actual):**
```diff
@@ -64 @@
 
   // Generate flame graph structure using tree base durations.
   const walkTree = (id: number, rightOffset: number, currentDepth: number): ChartNode => {
-    idToDepthMap.set(id, currentDepth);
+    idToDepthMap.set(currentDepth, id);
 
     const node = nodes.get(id);
     if (node == null) {
@@ -115 @@
 
     for (let i = children.length - 1; i >= 0; i--) {
       const childID = children[i];
-      const childChartNode: $FlowFixMe = walkTree(childID, rightOffset, currentDepth + 1);
+      const childChartNode: $FlowFixMe = walkTree(childID, currentDepth + 1, rightOffset);
       rightOffset -= childChartNode.treeBaseDuration;
     }
 
```

### Call Swap Call Args 003 (SyntheticEvent.js) — 0/1

**All runs failed with same error:** File mismatch for SyntheticEvent.js

**Sample agent response (run 1):**
```
Done. I've identified and fixed the bug: in the `createOrGetPooledEvent` function, the 3rd and 4th arguments (`nativeEvent` and `nativeInst`) were swapped when calling `EventConstructor.call()` and `new EventConstructor()`. 

The constructor signature expects `(dispatchConfig, targetInst, nativeEvent, nativeEventTarget)`, but the function was passing them as `(dispatchConfig, targetInst, nativeEvent, nativeInst)` when they should have been `(dispatchConfig, targetInst, nativeInst, nativeEvent...
```

**Diff (expected vs actual):**
```diff
@@ -250 @@
 function getPooledWarningPropertyDefinition(propName, getVal) {
   function set(val) {
     const action = isFunction ? 'setting the method' : 'setting the property';
-    warn(action, 'This is effectively a no-op');
+    warn('This is effectively a no-op', action);
     return val;
   }
 
@@ -286 @@
   const EventConstructor = this;
   if (EventConstructor.eventPool.length) {
     const instance = EventConstructor.eventPool.pop();
-    EventConstructor.call(instance, dispatchConfig, targetInst, nativeEvent, nativeInst);
+    EventConstructor.call(instance, dispatchConfig, targetInst, nativeInst, nativeEvent);
     return instance;
   }
     return instance;
   }
-  return new EventConstructor(dispatchConfig, targetInst, nativeEvent, nativeInst);
+  return new EventConstructor(dispatchConfig, targetInst, nativeInst, nativeEvent);
 }
 
 function releasePooledEvent(event) {
```

### Identifier Identifier Multi Edit 001 (TabBar.js) — 0/1

**All runs failed with same error:** File mismatch for TabBar.js

**Sample agent response (run 1):**
```
Done. The misspelled identifier `di` on line 96 has been corrected to `id`. This fixes all the downstream references to `id` on lines 103, 105, 106, 108, 115, and 130, which were previously undefined.
```

**Diff (expected vs actual):**
```diff
@@ -18 @@
 
 type TabInfo = {
   icon: IconType,
-  id: string,
+  di: string,
   label: string,
   title?: string,
 };
@@ -110 @@
             <input
               type="radio"
               className={styles.Input}
-              checked={currentTab === id}
+              checked={currentTab === di}
               disabled={disabled}
               name={groupName}
               value={id}
```

### Identifier Identifier Multi Edit 003 (ReactPerformanceTrackProperties.js) — 0/1

**All runs failed with same error:** File mismatch for ReactPerformanceTrackProperties.js

**Sample agent response (run 1):**
```
Done. The misspelled identifier `DADED` on line 281 has been fixed to `ADDED`, which matches all the other usages throughout the file (lines 336, 361, 427, and 431).
```

**Diff (expected vs actual):**
```diff
@@ -305 @@
               const typeName = getComponentNameFromType(nextValue.type) || '\u2026';
               const line = '\xa0\xa0'.repeat(indent) + key;
               const desc = '<' + typeName + ' \u2026 />';
-              properties.push([REMOVED + line, desc], [ADDED + line, desc]);
+              properties.push([REMOVED + line, desc], [DADED + line, desc]);
               isDeeplyEqual = false;
               continue;
             }
@@ -373 @@
         isDeeplyEqual = false;
       }
     } else {
-      properties.push([ADDED + '\xa0\xa0'.repeat(indent) + key, '\u2026']);
+      properties.push([DADED + '\xa0\xa0'.repeat(indent) + key, '\u2026']);
       isDeeplyEqual = false;
     }
 
```

### Operator Remove Negation 001 (ReactDOMClient.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMClient.js

**Sample agent response (run 1):**
```
✓ Fixed. Line 57 now correctly reads:
```javascript
if (foundDevTools && canUseDOM && window.top === window.self) {
```

The stray negation operator (`!`) has been removed from `canUseDOM`. The condition now properly checks that DevTools were found, we can use the DOM, and we're in the top window before showing the DevTools download message.
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

### Operator Remove Negation 003 (ReactFlightUnbundledReferences.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightUnbundledReferences.js

**Sample agent response (run 1):**
```
Perfect! Now I've corrected the bug. The negation operator was on line 296 in the original code:

```javascript
let cachedReference = target[name];
if (!cachedReference) {  // ❌ BUG: negation is inverted
  // create and cache...
}
return cachedReference;
```

The fix changes it to:

```javascript
let cachedReference = target[name];
if (cachedReference) {  // ✅ FIXED: removed negation
  return cachedReference;
}
// create and cache...
return cachedReference;
```

The bug was that the code shou...
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
@@ -288 @@
     );
   }
   let cachedReference = target[name];
-  if (!cachedReference) {
-    const reference: ClientReference<any> = registerClientReferenceImpl(
-      (function () {
-        throw new Error(
-          // eslint-disable-next-line react-internal/safe-string-coercion
-          `Attempted to call ${String(name)}() from the server but ${String(
-            name,
-          )} is on the client. ` +
-            `It's not possible to invoke a client function from the server, it can ` +
-            `only be rendered as a Component or passed to props of a Client Component.`,
-        );
-      }: any),
-      target.$$id + '#' + name,
-      target.$$async,
-    );
-    Object.defineProperty((reference: any), 'name', { value: name });
-    cachedReference = target[name] = new Proxy(reference, deepProxyHandlers);
+  if (cachedReference) {
+    return cachedReference;
   }
   }
+  const reference: ClientReference<any> = registerClientReferenceImpl(
+    (function () {
+      throw new Error(
+        // eslint-disable-next-line react-internal/safe-string-coercion
+        `Attempted to call ${String(name)}() from the server but ${String(
+          name,
+        )} is on the client. ` +
+          `It's not possible to invoke a client function from the server, it can ` +
+          `only be rendered as a Component or passed to props of a Client Component.`,
+      );
+    }: any),
+    target.$$id + '#' + name,
+    target.$$async,
+  );
+  Object.defineProperty((reference: any), 'name', { value: name });
+  cachedReference = target[name] = new Proxy(reference, deepProxyHandlers);
   return cachedReference;
 }
 
```

### Operator Swap Arithmetic 003 (hooks.js) — 0/1

**All runs failed with same error:** File mismatch for hooks.js

**Sample agent response (run 1):**
```
Perfect. I've fixed the bug on line 129. The arithmetic operator was changed from `<=` to `<`, which correctly represents the overflow condition: the container is overflowing when its width is strictly less than the total child width (not equal to).

The fix is complete and minimal - only the comparison operator was changed on line 129.
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

### Operator Swap Comparison 002 (ReactFlightDOMServerBrowser.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightDOMServerBrowser.js

**Sample agent response (run 1):**
```
Done. Changed the comparison operator from `<=` to `<` on line 89, and simplified the right operand from `messages.length - 1` to `messages.length` for the standard loop idiom.
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

### Operator Swap Logical 002 (SourceMapMetadataConsumer.js) — 0/1

**All runs failed with same error:** File mismatch for SourceMapMetadataConsumer.js

**Sample agent response (run 1):**
```
Done. I fixed the boolean operator precedence issue on line 51. The condition now correctly uses parentheses to ensure the check `sourceRoot != null && (util.isAbsolute(sourceRoot) || util.isAbsolute(source))` evaluates as intended—using the relative path resolution only when sourceRoot exists AND at least one of the paths is absolute.
```

**Diff (expected vs actual):**
```diff
@@ -45 @@
   // be particularly problematic when the source root is a prefix of the
   // source (valid, but why??). See github issue #199 and bugzil.la/1188982.
   source =
-    sourceRoot != null && util.isAbsolute(sourceRoot) && util.isAbsolute(source)
+    sourceRoot != null && (util.isAbsolute(sourceRoot) || util.isAbsolute(source))
       ? util.relative(sourceRoot, source)
       : source;
   return util.computeSourceURL(sourceRoot, source);
```

### Operator Swap Nullish 003 (backend.js) — 0/1

**All runs failed with same error:** File mismatch for backend.js

**Sample agent response (run 1):**
```
Done. The bug was on line 414 where the logical OR operator (`||`) was incorrectly used instead of the nullish coalescing operator (`??`). This has been fixed to match the correct pattern used elsewhere in the file (e.g., line 218).
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

### Structural Delete Statement 002 (getComponentNameFromFiber.js) — 0/1

**All runs failed with same error:** File mismatch for getComponentNameFromFiber.js

**Sample agent response (run 1):**
```
Done. The deleted statement `const functionName = getComponentNameFromType(innerType) || '';` has been restored in the `getWrappedName` function. This defines the `functionName` variable that was being referenced on line 63 but had no declaration, which would have caused a runtime error.
```

**Diff (expected vs actual):**
```diff
@@ -54 @@
 
 // Keep in sync with shared/getComponentNameFromType
 function getWrappedName(outerType: mixed, innerType: any, wrapperName: string): string {
-  const functionName = innerType.displayName || innerType.name || '';
+  const functionName = getComponentNameFromType(innerType) || '';
   return (
     (outerType: any).displayName ||
     (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
```

### Structural Delete Statement 003 (simulateBrowserEventDispatch.js) — 0/1

**All runs failed with same error:** File mismatch for simulateBrowserEventDispatch.js

**Sample agent response (run 1):**
```
Perfect. The bug was that the `simulateEventDispatch` function was missing a `return` statement. The function is async and calls `_dispatch.call(this, eventImpl)`, which returns a boolean indicating whether the event was not canceled. Without the `return` statement, the function would return `undefined` instead of the actual result from `_dispatch`.

The critical missing statement was: `return` before `await _dispatch.call(this, eventImpl);`
```

**Diff (expected vs actual):**
```diff
@@ -56 @@
 
   eventImpl.isTrusted = false;
 
-  await _dispatch.call(this, eventImpl);
+  return await _dispatch.call(this, eventImpl);
 }
 
 async function _dispatch(eventImpl, legacyTargetOverrideFlag) {
@@ -82 @@
     const isActivationEvent = false; // TODO Not ported in fork.
 
     if (isActivationEvent && targetImpl._hasActivationBehavior) {
-      activationTarget = targetImpl;
     }
 
     let slotInClosedTree = false;
```

### Structural Remove Early Return 001 (InspectedElementStateTree.js) — 0/1

**All runs failed with same error:** File mismatch for InspectedElementStateTree.js

**Sample agent response (run 1):**
```
Perfect. I've restored the missing guard clause. The fix adds a 3-line pattern immediately after the destructuring:
- **Line 40-42**: `if (!state) { return null; }`

This guard ensures that if `state` is null or undefined, the function returns early before attempting to call `Object.entries(state)` on line 44, which would otherwise throw an error. This is the minimal change required to fix the bug while preserving the exact code structure.
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
 
```

### Structural Remove Early Return 002 (useCommitFilteringAndNavigation.js) — 0/1

**All runs failed with same error:** File mismatch for useCommitFilteringAndNavigation.js

**Sample agent response (run 1):**
```
Done. The missing guard clause has been restored. The `findFilteredIndex` function now:

1. Returns `null` early if `commitIndex` is `null` (line 62)
2. Loops through the filtered indices array (line 63)
3. **Returns the filtered index `i` if a match is found** (line 64 — the restored guard clause)
4. Returns `null` if no match is found (line 65)

This allows the function to correctly map a commit index from the unfiltered list to its position in the filtered list, which is essential for the ...
```

**Diff (expected vs actual):**
```diff
@@ -63 @@
     (commitIndex: number | null, filtered: Array<number>): number | null => {
       if (commitIndex === null) return null;
       for (let i = 0; i < filtered.length; i++) {
-        if (filtered[i] === commitIndex) {
-          return i;
-        }
+        if (filtered[i] === commitIndex) return i;
       }
       return null;
     },
```

### Structural Remove Early Return 003 (ReactFiberAsyncAction.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFiberAsyncAction.js

**Sample agent response (run 1):**
```
Done. The missing guard clause has been restored to `releaseIsomorphicIndicator()`. The function now returns early if `enableDefaultTransitionIndicator` is not enabled, matching the pattern used in `startIsomorphicDefaultIndicatorIfNeeded()` and `stopIsomorphicDefaultIndicator()`.
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
+  if (!enableDefaultTransitionIndicator) {
+    return;
+  }
   if (--pendingEntangledRoots === 0) {
     stopIsomorphicDefaultIndicator();
   }
```

### Structural Swap Adjacent Lines 002 (ReactNoopFlightServer.js) — 0/1

**All runs failed with same error:** File mismatch for ReactNoopFlightServer.js

**Sample agent response (run 1):**
```
Done. The two adjacent lines (46 and 47) have been swapped back to their correct order. The `return` statement now properly belongs inside the `stringToChunk` function, and `flushBuffered` is in its correct position as a separate method in the object.
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

### Structural Swap Adjacent Lines 003 (backend.js) — 0/1

**All runs failed with same error:** File mismatch for backend.js

**Sample agent response (run 1):**
```
Perfect! I've identified and fixed the bug. The two adjacent statements were in the wrong order in the `connectWithCustomMessagingProtocol` function:

**The fix:** The `if (typeof onReloadAndProfileFlagsReset === 'function')` block (lines 389-391) needed to be moved **before** the `const agent = new Agent(...)` statement (line 388).

This ensures that `onReloadAndProfileFlagsReset()` is called before the Agent is instantiated, which is the correct logical order.
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
@@ -358 @@
     bridge.send('overrideComponentFilters', savedComponentFilters);
   }
 
-  const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
   if (typeof onReloadAndProfileFlagsReset === 'function') {
     onReloadAndProfileFlagsReset();
   }
@@ -363 @@
     onReloadAndProfileFlagsReset();
   }
 
+  const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
+
   if (onSettingsUpdated != null) {
     agent.addListener('updateHookSettings', onSettingsUpdated);
   }
```

### Structural Swap If Else 002 (ReactNativeFiberInspector.js) — 0/1

**All runs failed with same error:** File mismatch for ReactNativeFiberInspector.js

**Sample agent response (run 1):**
```
Done. The bug is fixed. The condition is now negated (`!__DEV__`), which correctly:
- Throws an error in production when `__DEV__` is false
- Executes the inspector logic in development when `__DEV__` is true
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

### Unicode Unicode Hyphen 002 (UnsupportedBridgeProtocolDialog.js) — 0/1

**All runs failed with same error:** File mismatch for UnsupportedBridgeProtocolDialog.js

**Sample agent response (run 1):**
```
Done. Replaced the unicode en-dash (–) with a plain ASCII hyphen (-) on line 19 in the import path from `react–devtools-shared` to `react-devtools-shared`.
```

**Diff (expected vs actual):**
```diff
@@ -16 @@
 import ButtonIcon from './ButtonIcon';
 import { copy } from 'clipboard-js';
 import styles from './UnsupportedBridgeProtocolDialog.css';
+import { withPermissionsCheck } from 'react–devtools-shared/src/frontend/utils/withPermissionsCheck';
 import { withPermissionsCheck } from 'react-devtools-shared/src/frontend/utils/withPermissionsCheck';
 
 import type { BridgeProtocol } from 'react-devtools-shared/src/bridge';
```

### Unicode Unicode Hyphen 003 (ReactTypes.js) — 0/1

**All runs failed with same error:** File mismatch for ReactTypes.js

**Sample agent response (run 1):**
```
Done. Fixed the unicode en-dash (–) on line 347 to a regular hyphen-minus (-) in the string `'unstable_legacy-backwards'`, making it consistent with the same value on line 328.
```

**Diff (expected vs actual):**
```diff
@@ -7 @@
  * @flow
  */
 
-import type { ReactOptimisticKey } from './ReactSymbols';
+import type {ReactOptimisticKey} from './ReactSymbols';
 
 
-export type { ReactOptimisticKey };
+export type {ReactOptimisticKey};
 
 export type ReactKey = null | string | ReactOptimisticKey;
 
@@ -89 @@
 
 export type ReactScopeQuery = (
   type: string,
-  props: { [string]: mixed },
+  props: {[string]: mixed},
   instance: mixed,
 ) => boolean;
 
@@ -110 @@
 // This doesn't require a return value neither from the handler nor the
 // then function.
 interface ThenableImpl<T> {
-  then(onFulfill: (value: T) => mixed, onReject: (error: mixed) => mixed): void | Wakeable;
+  then(
+    onFulfill: (value: T) => mixed,
+    onReject: (error: mixed) => mixed,
+  ): void | Wakeable;
   displayName?: string;
 }
 interface UntrackedThenable<T> extends ThenableImpl<T> {
@@ -178 @@
 export type Awaited<T> = T extends null | void
   ? T // special case for `null | undefined` when not in `--strictNullChecks` mode
   : T extends Object // `await` only unwraps object types with a callable then. Non-object types are not unwrapped.
-    ? T extends { then(onfulfilled: infer F): any } // thenable, extracts the first argument to `then()`
+    ? T extends {then(onfulfilled: infer F): any} // thenable, extracts the first argument to `then()`
       ? F extends (value: infer V) => any // if the argument to `then` is callable, extracts the argument
         ? Awaited<V> // recursively unwrap the value
         : empty // the argument to `then` was not callable.
@@ -210 @@
   +key?: ReactKey,
   +owner?: null | ReactComponentInfo,
   +stack?: null | ReactStackTrace,
-  +props?: null | { [name: string]: mixed },
+  +props?: null | {[name: string]: mixed},
   // Stashed Data for the Specific Execution Environment. Not part of the transport protocol
   +debugStack?: null | Error,
   +debugTask?: null | ConsoleTask,
@@ -281 @@
   [transitionType: 'default' | string]: 'none' | 'auto' | string,
 };
 
-ex...
```
