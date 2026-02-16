# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-02-16T13:29:28.142Z |
| Model | p-anthropic/p-anthropic/claude-opus-4-6 |
| Thinking Level | default |
| Runs per task | 1 |
| Edit Variant | hashline |
| Edit Fuzzy | auto |
| Edit Fuzzy Threshold | auto |
| Guided Mode | no |
| Max Attempts | 1 |
| No-op Retry Limit | 2 |
| Mutation Scope Window | 20 |
| Require Edit Tool | no |
| Require Read Tool | no |
| No-Edit Baseline | no |

## Summary

| Metric | Value |
|--------|-------|
| Total Tasks | 60 |
| Total Runs | 60 |
| Successful Runs | 51 |
| **Task Success Rate** | **85.0% (51/60)** |
| Verified Rate | 85.0% (51/60) |
| Edit Tool Usage Rate | 96.7% (58/60) |
| **Edit Success Rate** | **98.3%** |
| Timeout Runs | 0 |
| Mutation Intent Match Rate | 89.7% |
| Patch Failure Rate | 1.7% (1/59) |
| Tasks All Passing | 51 |
| Tasks Flaky/Failing | 9 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 155 | 2.6 |
| Edit | 59 | 1.0 |
| Write | 0 | 0.0 |
| **Tool Input Chars** | 29,950 | 499 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 381 | 6 |
| Output Tokens | 105,926 | 1,765 |
| Total Tokens | 2,839,550 | 47,326 |
| Duration | 3096.2s | 51.6s |
| **Avg Indent Score** | — | **2.27** |

### Hashline Edit Subtypes

| Operation | Count | % |
|-----------|-------|---|
| set_line | 63 | 91.3% |
| replace_lines | 1 | 1.4% |
| insert_after | 5 | 7.2% |
| replace | 0 | 0.0% |
| **Total** | **69** | 100% |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Access Remove Optional Chain 001 | registerDevToolsEventLogger.js | 1/1 ✅ | 100.0% | 5/1/0 | 9/5,778 | 105.3s | 1.00 |
| Access Remove Optional Chain 002 | TimelineContext.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/783 | 17.6s | 1.29 |
| Access Remove Optional Chain 003 | astUtils.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/3,554 | 67.2s | 4.85 |
| Call Swap Call Args 001 | testHelpers.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/407 | 12.9s | 1.33 |
| Call Swap Call Args 002 | FlamegraphChartBuilder.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/825 | 23.3s | 3.79 |
| Call Swap Call Args 003 | SyntheticEvent.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/1,102 | 26.9s | 3.76 |
| Duplicate Duplicate Line Flip 001 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/391 | 14.7s | 0.00 |
| Duplicate Duplicate Line Flip 002 | ActivityList.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/844 | 21.3s | 3.61 |
| Duplicate Duplicate Line Flip 003 | SyntheticEvent.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/1,534 | 37.4s | 1.02 |
| Identifier Identifier Multi Edit 001 | TabBar.js | 0/1 ❌ | 100.0% | 4/1/0 | 8/937 | 24.4s | 3.33 |
| Identifier Identifier Multi Edit 002 | EventPluginRegistry.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/1,157 | 24.8s | 3.94 |
| Identifier Identifier Multi Edit 003 | ReactPerformanceTrackProperties.js | 1/1 ✅ | 100.0% | 4/1/0 | 8/1,078 | 27.6s | 9.95 |
| Import Swap Named Imports 001 | CommitFlamegraphListItem.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/636 | 20.3s | 2.86 |
| Import Swap Named Imports 002 | ReactDOMTextarea.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/1,295 | 27.8s | 2.41 |
| Import Swap Named Imports 003 | StyleEditor.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/2,857 | 55.3s | 1.31 |
| Literal Flip Boolean 001 | testHelpers.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/355 | 13.8s | 1.33 |
| Literal Flip Boolean 002 | ReactNoopFlightServer.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/462 | 14.2s | 1.11 |
| Literal Flip Boolean 003 | ReactFlightDOMClientEdge.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/1,214 | 31.3s | 3.58 |
| Literal Off By One 001 | githubAPI.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/435 | 14.5s | 0.67 |
| Literal Off By One 002 | code-path.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/1,240 | 29.0s | 3.50 |
| Literal Off By One 003 | InspectedElement.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/1,376 | 34.6s | 3.60 |
| Operator Remove Negation 001 | ReactDOMClient.js | 1/1 ✅ | 100.0% | 5/1/0 | 9/4,780 | 98.5s | 1.08 |
| Operator Remove Negation 002 | NativeEventsView.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/5,407 | 99.8s | 3.03 |
| Operator Remove Negation 003 | ReactFlightUnbundledReferences.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 360.0s | 0.00 |
| Operator Swap Arithmetic 001 | fallbackEvalContext.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/377 | 14.4s | 0.00 |
| Operator Swap Arithmetic 002 | CSSShorthandProperty.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/580 | 18.5s | 2.88 |
| Operator Swap Arithmetic 003 | hooks.js | 0/1 ❌ | 50.0% | 2/2/0 | 5/15,249 | 283.6s | 2.25 |
| Operator Swap Comparison 001 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/618 | 18.0s | 0.00 |
| Operator Swap Comparison 002 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/943 | 22.0s | 1.57 |
| Operator Swap Comparison 003 | ReactFlightDOMServerNode.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/889 | 24.9s | 1.95 |
| Operator Swap Equality 001 | readInputData.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/399 | 13.1s | 0.00 |
| Operator Swap Equality 002 | editor.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/411 | 15.5s | 0.00 |
| Operator Swap Equality 003 | hooks.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/666 | 19.5s | 2.25 |
| Operator Swap Increment Decrement 001 | ReactFlightDOMClientNode.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/438 | 15.1s | 1.52 |
| Operator Swap Increment Decrement 002 | ReactFlightDOMClientNode.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/826 | 19.5s | 1.92 |
| Operator Swap Increment Decrement 003 | loadSourceAndMetadata.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/838 | 25.7s | 3.72 |
| Operator Swap Logical 001 | profiling.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/417 | 14.5s | 0.00 |
| Operator Swap Logical 002 | SourceMapMetadataConsumer.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/916 | 24.3s | 3.14 |
| Operator Swap Logical 003 | DevToolsFiberComponentStack.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/1,142 | 27.1s | 4.13 |
| Operator Swap Nullish 001 | getBatchRange.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/428 | 14.6s | 1.33 |
| Operator Swap Nullish 002 | EnterLeaveEventPlugin.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/987 | 25.7s | 1.56 |
| Operator Swap Nullish 003 | backend.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/4,876 | 88.5s | 3.15 |
| Regex Swap Regex Quantifier 001 | githubAPI.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/445 | 14.9s | 0.67 |
| Regex Swap Regex Quantifier 002 | ReactFlightStackConfigV8.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/1,678 | 36.3s | 3.06 |
| Regex Swap Regex Quantifier 003 | utils.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/3,062 | 66.3s | 2.00 |
| Structural Delete Statement 001 | UnsupportedVersionDialog.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/616 | 20.7s | 6.22 |
| Structural Delete Statement 002 | getComponentNameFromFiber.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/545 | 15.4s | 0.62 |
| Structural Delete Statement 003 | simulateBrowserEventDispatch.js | 0/1 ❌ | 100.0% | 1/1/0 | 3/5,906 | 260.3s | 4.46 |
| Structural Remove Early Return 001 | InspectedElementStateTree.js | 0/1 ❌ | 100.0% | 2/1/0 | 6/664 | 18.6s | 0.36 |
| Structural Remove Early Return 002 | useCommitFilteringAndNavigation.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/997 | 23.1s | 3.73 |
| Structural Remove Early Return 003 | ReactFiberAsyncAction.js | 0/1 ❌ | 100.0% | 3/1/0 | 7/4,830 | 77.5s | 1.46 |
| Structural Swap Adjacent Lines 001 | ReactServerConsoleConfigPlain.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/373 | 14.0s | 1.00 |
| Structural Swap Adjacent Lines 002 | ReactNoopFlightServer.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/698 | 17.7s | 1.11 |
| Structural Swap Adjacent Lines 003 | backend.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 360.0s | 0.00 |
| Structural Swap If Else 001 | importFile.js | 0/1 ❌ | 100.0% | 2/1/0 | 6/624 | 18.2s | 0.00 |
| Structural Swap If Else 002 | ReactNativeFiberInspector.js | 0/1 ❌ | 100.0% | 3/1/0 | 7/846 | 23.7s | 3.18 |
| Structural Swap If Else 003 | ReactDOMFizzStaticNode.js | 1/1 ✅ | 100.0% | 3/1/0 | 4/12,914 | 180.9s | 1.88 |
| Unicode Unicode Hyphen 001 | Rectangle.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/394 | 13.7s | 3.00 |
| Unicode Unicode Hyphen 002 | UnsupportedBridgeProtocolDialog.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/928 | 22.4s | 3.83 |
| Unicode Unicode Hyphen 003 | ReactTypes.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/959 | 25.2s | 1.24 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 7 / 8.7 / 10 |
| call | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 6 / 7.7 / 10 |
| duplicate | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 7 / 9.7 / 12 |
| identifier | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) | 6 / 9.3 / 14 |
| import | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 2 / 4.7 / 6 |
| literal | 6 | 100.0% (6/6) | 100.0% (6/6) | 100.0% (6/6) | 4 / 6.2 / 9 |
| operator | 21 | 90.5% (19/21) | 95.2% (20/21) | 90.5% (19/21) | 1 / 6.5 / 13 |
| regex | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 6 / 7.3 / 8 |
| structural | 12 | 50.0% (6/12) | 91.7% (11/12) | 50.0% (6/12) | 4 / 7.6 / 15 |
| unicode | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 1 / 3.0 / 6 |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| duplicate-line-flip | duplicate | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| flip-boolean | literal | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| identifier-multi-edit | identifier | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| off-by-one | literal | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| remove-early-return | structural | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) |
| remove-negation | operator | 3 | 66.7% (2/3) | 66.7% (2/3) | 66.7% (2/3) |
| remove-optional-chain | access | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-adjacent-lines | structural | 3 | 66.7% (2/3) | 66.7% (2/3) | 66.7% (2/3) |
| swap-arithmetic | operator | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| swap-call-args | call | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-comparison | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-equality | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-if-else | structural | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) |
| swap-increment-decrement | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-logical | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-named-imports | import | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-nullish | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-regex-quantifier | regex | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| unicode-hyphen | unicode | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |

## Difficulty Summary

| Difficulty Score | Runs | Verified | Edit Used | Success |
|------------------|------|----------|-----------|---------|
| 0-2 | 6 | 100.0% (6/6) | 100.0% (6/6) | 100.0% (6/6) |
| 3-5 | 12 | 91.7% (11/12) | 100.0% (12/12) | 91.7% (11/12) |
| 6-8 | 24 | 83.3% (20/24) | 100.0% (24/24) | 83.3% (20/24) |
| 9+ | 18 | 77.8% (14/18) | 88.9% (16/18) | 77.8% (14/18) |

## Edit Tool Errors

Failures where the edit tool returned an error or failed to apply the patch.

### Operator Swap Arithmetic 003 (hooks.js)

#### Run 1

##### Attempt 1

- Path: /private/var/folders/06/v170cl6d5gjftkvfr7hzxynw0000gn/T/reach-benchmark-IqnOT4/batch-acc6fc93-cec2-4996-947c-e531c00b7c7a/hooks.js
- Operation: —

**Tool error**

```
No changes made to /private/var/folders/06/v170cl6d5gjftkvfr7hzxynw0000gn/T/reach-benchmark-IqnOT4/batch-acc6fc93-cec2-4996-947c-e531c00b7c7a/hooks.js. The edits produced identical content.
Edit 0: replacement for 129:44 is identical to current content:
  129:44|       setIsOverflowing(container.clientWidth <= totalChildWidth);
Your content must differ from what the file already contains. Re-read the file to see the current state.
```

**Patch args**

```diff
{
  "path": "/private/var/folders/06/v170cl6d5gjftkvfr7hzxynw0000gn/T/reach-benchmark-IqnOT4/batch-acc6fc93-cec2-4996-947c-e531c00b7c7a/hooks.js",
  "edits": [
    {
      "set_line": {
        "anchor": "129:44",
        "new_text": "      setIsOverflowing(container.clientWidth <= totalChildWidth);"
      }
    }
  ]
}
```

## Failed Tasks (0% passing)

### Identifier Identifier Multi Edit 001 (TabBar.js) — 0/1

**All runs failed with same error:** File mismatch for TabBar.js

**Sample agent response (run 1):**
```
Fixed. Changed `di` → `id` on both line 21 (type definition) and line 96 (destructuring). No other lines touched.
```

**Diff (expected vs actual):**
```diff
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

### Operator Remove Negation 003 (ReactFlightUnbundledReferences.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 360.0s |

### Operator Swap Arithmetic 003 (hooks.js) — 0/1

**All runs failed with same error:** File mismatch for hooks.js

**Sample agent response (run 1):**
```
Fixed. Line 129: `<=` → `<`. The `useIsOverflowing` hook should report overflow only when `totalChildWidth` strictly exceeds `container.clientWidth`. When they're equal, everything fits — no overflow.
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

### Structural Delete Statement 003 (simulateBrowserEventDispatch.js) — 0/1

**All runs failed with same error:** File mismatch for simulateBrowserEventDispatch.js

**Sample agent response (run 1):**
```
Fix confirmed. Line 59 now returns the result of `_dispatch`, which is `!eventImpl._canceledFlag`—the boolean indicating whether the event was not canceled. This matches the DOM spec contract for `dispatchEvent()` and the original jsdom implementation this fork is based on.
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
The guard clause is restored. The 3-line pattern `if (state == null) { return null; }` is inserted after the destructuring on line 38 and before the host component check, protecting against `state` being `null`/`undefined` before `Object.entries(state)` is called on line 46.
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

### Structural Remove Early Return 003 (ReactFiberAsyncAction.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFiberAsyncAction.js

**Sample agent response (run 1):**
```
The guard clause is correctly inserted. The fix adds an early return at the top of `pingEngtangledActionScope` when `currentEntangledListeners === null`, preventing the function from decrementing `currentEntangledPendingCount` when there's no active entangled async action scope.
```

**Diff (expected vs actual):**
```diff
@@ -85 @@
 }
 
 function pingEngtangledActionScope() {
+  if (currentEntangledListeners === null) {
+    return;
+  }
   if (--currentEntangledPendingCount === 0) {
     if (enableProfilerTimer && enableComponentPerformanceTrack) {
       if (!hasScheduledTransitionWork()) {
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
| 1 | ❌ | — | 0 / 0 | 360.0s |

### Structural Swap If Else 001 (importFile.js) — 0/1

**All runs failed with same error:** File mismatch for importFile.js

**Sample agent response (run 1):**
```
Correct. Now when `error instanceof InvalidProfileError` is **false** (i.e., NOT an `InvalidProfileError`), the `if` branch fires and returns `UNEXPECTED_ERROR`. When it **is** an `InvalidProfileError`, the `else` branch fires and returns `INVALID_PROFILE_ERROR`. The only change was negating the condition on line 34 — the branch bodies stayed in place, which is the minimal fix.
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

**Sample agent response (run 1):**
```
Fixed. The only change: `if (__DEV__)` → `if (!__DEV__)` on line 160. Now the throw fires in production and the actual logic runs in dev, matching the error message and the pattern used by `getInspectorDataForViewAtPoint`.
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
