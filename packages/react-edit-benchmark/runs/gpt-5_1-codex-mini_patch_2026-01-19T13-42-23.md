# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-01-19T13:32:02.567Z |
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
| Successful Runs | 93 |
| **Task Success Rate** | **51.7% (93/180)** |
| Verified Rate | 51.7% (93/180) |
| Edit Tool Usage Rate | 71.7% (129/180) |
| **Edit Success Rate** | **85.5%** |
| Patch Failure Rate | 14.5% (25/173) |
| Tasks All Passing | 14 |
| Tasks Flaky/Failing | 46 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 311 | 1.7 |
| Edit | 173 | 1.0 |
| Write | 3 | 0.0 |
| **Tool Input Chars** | 89,450 | 497 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 2,624,440 | 14,580 |
| Output Tokens | 461,573 | 2,564 |
| Total Tokens | 11,333,309 | 62,963 |
| Duration | 5809.5s | 32.3s |
| **Avg Indent Score** | — | **2.31** |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Access Remove Optional Chain 001 | registerDevToolsEventLogger.js | 2/3 ⚠️ | 100.0% | 2/1/0 | 13,227/1,814 | 17.1s | 0.67 |
| Access Remove Optional Chain 002 | TimelineContext.js | 0/3 ❌ | 100.0% | 2/1/0 | 10,310/2,258 | 19.1s | 1.29 |
| Access Remove Optional Chain 003 | astUtils.js | 2/3 ⚠️ | 100.0% | 4/1/0 | 42,240/4,378 | 36.3s | 4.81 |
| Call Swap Call Args 001 | testHelpers.js | 3/3 ✅ | 100.0% | 4/1/0 | 19,329/2,255 | 25.1s | 1.33 |
| Call Swap Call Args 002 | FlamegraphChartBuilder.js | 2/3 ⚠️ | 80.0% | 2/2/0 | 24,704/3,134 | 33.6s | 3.79 |
| Call Swap Call Args 003 | SyntheticEvent.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 8,295/1,606 | 13.7s | 3.76 |
| Duplicate Duplicate Line Flip 001 | index.js | 3/3 ✅ | 100.0% | 1/1/0 | 6,764/493 | 8.8s | 0.00 |
| Duplicate Duplicate Line Flip 002 | ActivityList.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 8,052/367 | 7.5s | 3.61 |
| Duplicate Duplicate Line Flip 003 | SyntheticEvent.js | 0/3 ❌ | 100.0% | 0/0/0 | 0/0 | 120.0s | 0.00 |
| Identifier Identifier Multi Edit 001 | TabBar.js | 2/3 ⚠️ | 100.0% | 3/1/0 | 13,140/1,558 | 17.9s | 3.25 |
| Identifier Identifier Multi Edit 002 | EventPluginRegistry.js | 2/3 ⚠️ | 100.0% | 3/1/0 | 19,047/1,224 | 14.4s | 3.94 |
| Identifier Identifier Multi Edit 003 | ReactPerformanceTrackProperties.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 15,250/6,997 | 41.6s | 9.95 |
| Import Swap Named Imports 001 | CommitFlamegraphListItem.js | 1/3 ⚠️ | 66.7% | 5/2/0 | 35,024/4,049 | 39.6s | 2.86 |
| Import Swap Named Imports 002 | ReactDOMTextarea.js | 2/3 ⚠️ | 100.0% | 2/1/0 | 12,701/991 | 15.5s | 2.41 |
| Import Swap Named Imports 003 | StyleEditor.js | 0/3 ❌ | 100.0% | 3/1/0 | 18,632/5,679 | 87.3s | 1.31 |
| Literal Flip Boolean 001 | testHelpers.js | 0/3 ❌ | 100.0% | 1/0/0 | 4,627/560 | 7.8s | 0.67 |
| Literal Flip Boolean 002 | ReactNoopFlightServer.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 16,708/5,098 | 30.6s | 1.11 |
| Literal Flip Boolean 003 | ReactFlightDOMClientEdge.js | 2/3 ⚠️ | 100.0% | 3/1/0 | 15,401/2,135 | 23.0s | 3.58 |
| Literal Off By One 001 | githubAPI.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 4,309/166 | 45.2s | 0.67 |
| Literal Off By One 002 | code-path.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 10,158/5,841 | 46.9s | 3.50 |
| Literal Off By One 003 | InspectedElement.js | 2/3 ⚠️ | 100.0% | 2/1/0 | 18,424/2,350 | 22.7s | 3.60 |
| Operator Remove Negation 001 | ReactDOMClient.js | 0/3 ❌ | 100.0% | 2/0/0 | 6,086/4,439 | 72.9s | 1.08 |
| Operator Remove Negation 002 | NativeEventsView.js | 3/3 ✅ | 42.9% | 4/2/0 | 19,505/8,046 | 60.3s | 3.03 |
| Operator Remove Negation 003 | ReactFlightUnbundledReferences.js | 0/3 ❌ | 100.0% | 0/0/0 | 4,691/1,509 | 41.7s | 2.00 |
| Operator Swap Arithmetic 001 | fallbackEvalContext.js | 1/3 ⚠️ | 100.0% | 1/0/0 | 7,517/461 | 6.2s | 0.00 |
| Operator Swap Arithmetic 002 | CSSShorthandProperty.js | 3/3 ✅ | 100.0% | 3/2/0 | 37,888/2,773 | 26.7s | 2.88 |
| Operator Swap Arithmetic 003 | hooks.js | 0/3 ❌ | 100.0% | 1/0/0 | 16,895/1,229 | 52.3s | 2.25 |
| Operator Swap Comparison 001 | index.js | 3/3 ✅ | 100.0% | 1/1/0 | 5,828/608 | 10.9s | 0.00 |
| Operator Swap Comparison 002 | ReactFlightDOMServerBrowser.js | 1/3 ⚠️ | 0.0% | 2/2/0 | 11,455/2,688 | 31.9s | 1.57 |
| Operator Swap Comparison 003 | ReactFlightDOMServerNode.js | 0/3 ❌ | 100.0% | 1/0/0 | 6,932/542 | 6.6s | 1.94 |
| Operator Swap Equality 001 | readInputData.js | 3/3 ✅ | 83.3% | 3/2/0 | 23,539/2,422 | 28.2s | 0.00 |
| Operator Swap Equality 002 | editor.js | 3/3 ✅ | 25.0% | 2/3/0 | 19,169/2,527 | 24.5s | 0.00 |
| Operator Swap Equality 003 | hooks.js | 3/3 ✅ | 100.0% | 1/1/0 | 23,614/1,073 | 11.3s | 2.25 |
| Operator Swap Increment Decrement 001 | ReactFlightDOMClientNode.js | 2/3 ⚠️ | 100.0% | 3/2/0 | 36,452/1,466 | 17.1s | 1.52 |
| Operator Swap Increment Decrement 002 | ReactFlightDOMClientNode.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 4,414/363 | 45.5s | 1.92 |
| Operator Swap Increment Decrement 003 | loadSourceAndMetadata.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 10,021/414 | 8.9s | 3.72 |
| Operator Swap Logical 001 | profiling.js | 3/3 ✅ | 100.0% | 1/1/0 | 9,066/945 | 9.8s | 0.00 |
| Operator Swap Logical 002 | SourceMapMetadataConsumer.js | 3/3 ✅ | 100.0% | 2/1/0 | 7,519/3,037 | 26.8s | 3.14 |
| Operator Swap Logical 003 | DevToolsFiberComponentStack.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 29,281/8,351 | 64.5s | 4.13 |
| Operator Swap Nullish 001 | getBatchRange.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 5,158/1,386 | 52.9s | 1.33 |
| Operator Swap Nullish 002 | EnterLeaveEventPlugin.js | 2/3 ⚠️ | 28.6% | 2/2/0 | 15,194/2,745 | 27.8s | 1.56 |
| Operator Swap Nullish 003 | backend.js | 0/3 ❌ | 100.0% | 2/1/0 | 44,089/3,247 | 19.9s | 3.15 |
| Regex Swap Regex Quantifier 001 | githubAPI.js | 3/3 ✅ | 100.0% | 1/1/0 | 8,552/1,083 | 14.4s | 0.67 |
| Regex Swap Regex Quantifier 002 | ReactFlightStackConfigV8.js | 3/3 ✅ | 100.0% | 1/1/0 | 18,897/2,242 | 19.6s | 3.06 |
| Regex Swap Regex Quantifier 003 | utils.js | 0/3 ❌ | 100.0% | 2/0/0 | 9,631/3,427 | 105.3s | 2.00 |
| Structural Delete Statement 001 | UnsupportedVersionDialog.js | 3/3 ✅ | 100.0% | 1/1/0 | 8,591/662 | 10.5s | 6.22 |
| Structural Delete Statement 002 | getComponentNameFromFiber.js | 1/3 ⚠️ | 100.0% | 2/1/0 | 19,558/1,588 | 18.4s | 0.68 |
| Structural Delete Statement 003 | simulateBrowserEventDispatch.js | 0/3 ❌ | 100.0% | 3/2/0 | 19,231/5,438 | 42.8s | 4.46 |
| Structural Remove Early Return 001 | InspectedElementStateTree.js | 0/3 ❌ | 100.0% | 2/1/0 | 9,530/2,253 | 19.9s | 0.36 |
| Structural Remove Early Return 002 | useCommitFilteringAndNavigation.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 8,274/1,973 | 17.9s | 3.72 |
| Structural Remove Early Return 003 | ReactFiberAsyncAction.js | 0/3 ❌ | 100.0% | 1/1/0 | 12,184/2,760 | 24.9s | 1.03 |
| Structural Swap Adjacent Lines 001 | ReactServerConsoleConfigPlain.js | 1/3 ⚠️ | 100.0% | 1/0/0 | 7,067/757 | 9.4s | 0.33 |
| Structural Swap Adjacent Lines 002 | ReactNoopFlightServer.js | 1/3 ⚠️ | 100.0% | 2/2/0 | 23,795/7,543 | 28.1s | 0.74 |
| Structural Swap Adjacent Lines 003 | backend.js | 0/3 ❌ | 100.0% | 3/1/0 | 22,421/9,717 | 90.9s | 3.15 |
| Structural Swap If Else 001 | importFile.js | 0/3 ❌ | 100.0% | 1/1/0 | 3,987/4,900 | 76.5s | 0.38 |
| Structural Swap If Else 002 | ReactNativeFiberInspector.js | 0/3 ❌ | 100.0% | 0/1/0 | 9,308/2,963 | 19.6s | 3.18 |
| Structural Swap If Else 003 | ReactDOMFizzStaticNode.js | 2/3 ⚠️ | 100.0% | 2/1/0 | 21,589/2,623 | 63.6s | 1.88 |
| Unicode Unicode Hyphen 001 | Rectangle.js | 3/3 ✅ | 100.0% | 1/1/0 | 5,301/127 | 4.5s | 3.00 |
| Unicode Unicode Hyphen 002 | UnsupportedBridgeProtocolDialog.js | 1/3 ⚠️ | 100.0% | 0/0/0 | 4,027/201 | 4.5s | 3.83 |
| Unicode Unicode Hyphen 003 | ReactTypes.js | 1/3 ⚠️ | 100.0% | 1/0/0 | 2,214/376 | 45.6s | 1.24 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 9 | 44.4% (4/9) | 88.9% (8/9) | 44.4% (4/9) | 7 / 8.7 / 10 |
| call | 9 | 77.8% (7/9) | 88.9% (8/9) | 77.8% (7/9) | 6 / 7.7 / 10 |
| duplicate | 9 | 55.6% (5/9) | 55.6% (5/9) | 55.6% (5/9) | 7 / 9.7 / 12 |
| identifier | 9 | 55.6% (5/9) | 88.9% (8/9) | 55.6% (5/9) | 6 / 9.3 / 14 |
| import | 9 | 33.3% (3/9) | 77.8% (7/9) | 33.3% (3/9) | 2 / 4.7 / 6 |
| literal | 18 | 55.6% (10/18) | 66.7% (12/18) | 55.6% (10/18) | 4 / 6.2 / 9 |
| operator | 63 | 60.3% (38/63) | 68.3% (43/63) | 60.3% (38/63) | 1 / 6.5 / 13 |
| regex | 9 | 66.7% (6/9) | 66.7% (6/9) | 66.7% (6/9) | 6 / 7.3 / 8 |
| structural | 36 | 27.8% (10/36) | 75.0% (27/36) | 27.8% (10/36) | 4 / 7.6 / 15 |
| unicode | 9 | 55.6% (5/9) | 55.6% (5/9) | 55.6% (5/9) | 1 / 3.0 / 6 |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 9 | 44.4% (4/9) | 88.9% (8/9) | 44.4% (4/9) |
| duplicate-line-flip | duplicate | 9 | 55.6% (5/9) | 55.6% (5/9) | 55.6% (5/9) |
| flip-boolean | literal | 9 | 44.4% (4/9) | 66.7% (6/9) | 44.4% (4/9) |
| identifier-multi-edit | identifier | 9 | 55.6% (5/9) | 88.9% (8/9) | 55.6% (5/9) |
| off-by-one | literal | 9 | 66.7% (6/9) | 66.7% (6/9) | 66.7% (6/9) |
| remove-early-return | structural | 9 | 22.2% (2/9) | 88.9% (8/9) | 22.2% (2/9) |
| remove-negation | operator | 9 | 33.3% (3/9) | 33.3% (3/9) | 33.3% (3/9) |
| remove-optional-chain | access | 9 | 44.4% (4/9) | 88.9% (8/9) | 44.4% (4/9) |
| swap-adjacent-lines | structural | 9 | 22.2% (2/9) | 55.6% (5/9) | 22.2% (2/9) |
| swap-arithmetic | operator | 9 | 44.4% (4/9) | 55.6% (5/9) | 44.4% (4/9) |
| swap-call-args | call | 9 | 77.8% (7/9) | 88.9% (8/9) | 77.8% (7/9) |
| swap-comparison | operator | 9 | 44.4% (4/9) | 55.6% (5/9) | 44.4% (4/9) |
| swap-equality | operator | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) |
| swap-if-else | structural | 9 | 22.2% (2/9) | 66.7% (6/9) | 22.2% (2/9) |
| swap-increment-decrement | operator | 9 | 66.7% (6/9) | 77.8% (7/9) | 66.7% (6/9) |
| swap-logical | operator | 9 | 88.9% (8/9) | 88.9% (8/9) | 88.9% (8/9) |
| swap-named-imports | import | 9 | 33.3% (3/9) | 77.8% (7/9) | 33.3% (3/9) |
| swap-nullish | operator | 9 | 44.4% (4/9) | 66.7% (6/9) | 44.4% (4/9) |
| swap-regex-quantifier | regex | 9 | 66.7% (6/9) | 66.7% (6/9) | 66.7% (6/9) |
| unicode-hyphen | unicode | 9 | 55.6% (5/9) | 55.6% (5/9) | 55.6% (5/9) |

## Difficulty Summary

| Difficulty Score | Runs | Verified | Edit Used | Success |
|------------------|------|----------|-----------|---------|
| 0-2 | 18 | 50.0% (9/18) | 55.6% (10/18) | 50.0% (9/18) |
| 3-5 | 36 | 72.2% (26/36) | 88.9% (32/36) | 72.2% (26/36) |
| 6-8 | 72 | 48.6% (35/72) | 72.2% (52/72) | 48.6% (35/72) |
| 9+ | 54 | 42.6% (23/54) | 64.8% (35/54) | 42.6% (23/54) |

## Edit Tool Errors

Failures where the edit tool returned an error or failed to apply the patch.

### Call Swap Call Args 002 (FlamegraphChartBuilder.js)

#### Run 3

##### Attempt 1

- Path: FlamegraphChartBuilder.js
- Operation: —

**Tool error**

```
Failed to find expected lines in FlamegraphChartBuilder.js:
  const commitDatum = profilerStore.getCommitData(rootID, commitIndex);
}
```

**Patch args**

```diff
@@
-  const commitDatum = profilerStore.getCommitData(rootID, commitIndex);
+  const commitDatum = profilerStore.getCommitData(commitIndex, rootID);
 }

```

### Import Swap Named Imports 001 (CommitFlamegraphListItem.js)

#### Run 2

##### Attempt 1

- Path: ReactFlightDOMServerNode.js
- Operation: —

**Tool error**

```
Line 11: Hunk does not contain any lines
```

**Patch args**

```diff
@@
-  if (pendingFiles >= 0) {
+  if (pendingFiles > 0) {
@@
           for (let i = 0; i < queuedFields.length; i += 2) {
             resolveField(response, queuedFields[i], queuedFields[i + 1]);
           }
           queuedFields.length = 0;
         }
@@

```

##### Attempt 2

- Path: ReactTypes.js
- Operation: —

**Tool error**

```
Could not find a close enough match in ReactTypes.js. Closest match (65% similar) at line 347.
```

**Patch args**

```diff
@@
-  revealOrder: 'forwards' | 'backwards' | 'unstable_legacy–backwards' | 'together' | 'independent' | void;
+  revealOrder: 'forwards' | 'backwards' | 'unstable_legacy-backwards' | 'together' | 'independent' | void;

```

### Operator Remove Negation 002 (NativeEventsView.js)

#### Run 1

##### Attempt 1

- Path: NativeEventsView.js
- Operation: —

**Tool error**

```
Line 7: Hunk does not contain any lines
```

**Patch args**

```diff
@@
-    if (rectIntersectsRect(eventRect, rect)) {
+    if (!rectIntersectsRect(eventRect, rect)) {
       return; // Not in view
     }
@@

```

##### Attempt 2

- Path: NativeEventsView.js
- Operation: —

**Tool error**

```
Line 7: Hunk does not contain any lines
```

**Patch args**

```diff
@@
-    if (rectIntersectsRect(eventRect, rect)) {
+    if (!rectIntersectsRect(eventRect, rect)) {
       return; // Not in view
     }
@@

```

##### Attempt 3

- Path: NativeEventsView.js
- Operation: —

**Tool error**

```
Line 9: Hunk does not contain any lines
```

**Patch args**

```diff
@@
     size: {width: xStop - xStart, height: NATIVE_EVENT_HEIGHT},
   };
-    if (rectIntersectsRect(eventRect, rect)) {
+    if (!rectIntersectsRect(eventRect, rect)) {
       return; // Not in view
     }
@@

```

##### Attempt 4

- Path: NativeEventsView.js
- Operation: —

**Tool error**

```
Line 9: Hunk does not contain any lines
```

**Patch args**

```diff
@@
       size: {width: xStop - xStart, height: NATIVE_EVENT_HEIGHT},
     };
-    if (rectIntersectsRect(eventRect, rect)) {
+    if (!rectIntersectsRect(eventRect, rect)) {
       return; // Not in view
     }
@@

```

### Operator Swap Comparison 002 (ReactFlightDOMServerBrowser.js)

#### Run 2

##### Attempt 1

- Path: ReactFlightDOMServerBrowser.js
- Operation: —

**Tool error**

```
Line 7: Hunk does not contain any lines
```

**Patch args**

```diff
@@
-    for (let i = 0; i <= messages.length - 1; i++) {
+    for (let i = 0; i < messages.length - 1; i++) {
       resolveDebugMessage(request, messages[i]);
     }
@@

```

##### Attempt 2

- Path: ReactFlightDOMServerBrowser.js
- Operation: —

**Tool error**

```
Line 7: Hunk does not contain any lines
```

**Patch args**

```diff
@@
-    for (let i = 0; i <= messages.length - 1; i++) {
+    for (let i = 0; i < messages.length - 1; i++) {
       resolveDebugMessage(request, messages[i]);
     }
@@

```

##### Attempt 3

- Path: ReactFlightDOMServerBrowser.js
- Operation: —

**Tool error**

```
Line 9: Hunk does not contain any lines
```

**Patch args**

```diff
@@
-    const messages = stringBuffer.split('\n');
-    for (let i = 0; i <= messages.length - 1; i++) {
+    const messages = stringBuffer.split('\n');
+    for (let i = 0; i < messages.length - 1; i++) {
       resolveDebugMessage(request, messages[i]);
     }
@@

```

##### Attempt 4

- Path: ReactFlightDOMServerBrowser.js
- Operation: —

**Tool error**

```
Line 7: Hunk does not contain any lines
```

**Patch args**

```diff
@@
-    for (let i = 0; i <= messages.length - 1; i++) {
+    for (let i = 0; i < messages.length - 1; i++) {
       resolveDebugMessage(request, messages[i]);
     }
@@

```

##### Attempt 5

- Path: ReactFlightDOMServerBrowser.js
- Operation: —

**Tool error**

```
Line 9: Hunk does not contain any lines
```

**Patch args**

```diff
@@
-    const messages = stringBuffer.split('\n');
-    for (let i = 0; i <= messages.length - 1; i++) {
+    const messages = stringBuffer.split('\n');
+    for (let i = 0; i < messages.length - 1; i++) {
       resolveDebugMessage(request, messages[i]);
     }
@@

```

##### Attempt 6

- Path: ReactFlightDOMServerBrowser.js
- Operation: —

**Tool error**

```
Line 11: Hunk does not contain any lines
```

**Patch args**

```diff
@@
-    const messages = stringBuffer.split('\n');
-    for (let i = 0; i <= messages.length - 1; i++) {
-      resolveDebugMessage(request, messages[i]);
-    }
+    const messages = stringBuffer.split('\n');
+    for (let i = 0; i < messages.length - 1; i++) {
+      resolveDebugMessage(request, messages[i]);
+    }
@@

```

### Operator Swap Equality 001 (readInputData.js)

#### Run 2

##### Attempt 1

- Path: ReactFlightDOMServerNode.js
- Operation: —

**Tool error**

```
Line 10: Hunk does not contain any lines
```

**Patch args**

```diff
@@
-  busboyStream.on('field', (name, value) => {
-    if (pendingFiles >= 0) {
+  busboyStream.on('field', (name, value) => {
+    if (pendingFiles > 0) {
@@
-      } else {
+      } else {
@@

```

### Operator Swap Equality 002 (editor.js)

#### Run 3

##### Attempt 1

- Path: editor.js
- Operation: —

**Tool error**

```
Failed to find expected lines in editor.js:
      for (let i = 0; i < processNames.length; i++) {
        const processName = processNames[i];
        if (output.indexOf(processName) === -1) {
          return [COMMON_EDITORS[processName]];
        }
      }
    }
  }
```

**Patch args**

```diff
@@
-      for (let i = 0; i < processNames.length; i++) {
-        const processName = processNames[i];
-        if (output.indexOf(processName) === -1) {
-          return [COMMON_EDITORS[processName]];
-        }
-      }
+      for (let i = 0; i < processNames.length; i++) {
+        const processName = processNames[i];
+        if (output.indexOf(processName) !== -1) {
+          return [COMMON_EDITORS[processName]];
+        }
+      }
     }
   }

```

##### Attempt 2

- Path: editor.js
- Operation: —

**Tool error**

```
Failed to find expected lines in editor.js:
      for (let i = 0; i < processNames.length; i++) {
        const processName = processNames[i];
        if (output.indexOf(processName) === -1) {
          return [COMMON_EDITORS[processName]];
        }
      }
    }
  }
```

**Patch args**

```diff
@@
-      for (let i = 0; i < processNames.length; i++) {
-        const processName = processNames[i];
-        if (output.indexOf(processName) === -1) {
-          return [COMMON_EDITORS[processName]];
-        }
-      }
+      for (let i = 0; i < processNames.length; i++) {
+        const processName = processNames[i];
+        if (output.indexOf(processName) !== -1) {
+          return [COMMON_EDITORS[processName]];
+        }
+      }
     }
   }

```

##### Attempt 3

- Path: editor.js
- Operation: —

**Tool error**

```
Failed to find expected lines in editor.js:
      const processNames = Object.keys(COMMON_EDITORS);
      for (let i = 0; i < processNames.length; i++) {
        const processName = processNames[i];
        if (output.indexOf(processName) === -1) {
          return [COMMON_EDITORS[processName]];
        }
      }
    }
  }
```

**Patch args**

```diff
@@
-      const processNames = Object.keys(COMMON_EDITORS);
-      for (let i = 0; i < processNames.length; i++) {
-        const processName = processNames[i];
-        if (output.indexOf(processName) === -1) {
-          return [COMMON_EDITORS[processName]];
-        }
-      }
+      const processNames = Object.keys(COMMON_EDITORS);
+      for (let i = 0; i < processNames.length; i++) {
+        const processName = processNames[i];
+        if (output.indexOf(processName) !== -1) {
+          return [COMMON_EDITORS[processName]];
+        }
+      }
     }
   }

```

##### Attempt 4

- Path: editor.js
- Operation: —

**Tool error**

```
Failed to find expected lines in editor.js:
        if (output.indexOf(processName) === -1) {
          return [COMMON_EDITORS[processName]];
        }
      }
    }
  }
```

**Patch args**

```diff
@@
-        if (output.indexOf(processName) === -1) {
+        if (output.indexOf(processName) !== -1) {
           return [COMMON_EDITORS[processName]];
         }
       }
     }
   }

```

##### Attempt 5

- Path: editor.js
- Operation: —

**Tool error**

```
Failed to find expected lines in editor.js:
        if (output.indexOf(processName) === -1) {
          return [COMMON_EDITORS[processName]];
        }
      }
    }
  }
```

**Patch args**

```diff
@@
-        if (output.indexOf(processName) === -1) {
+        if (output.indexOf(processName) !== -1) {
           return [COMMON_EDITORS[processName]];
         }
       }
     }
   }

```

##### Attempt 6

- Path: editor.js
- Operation: —

**Tool error**

```
Failed to find expected lines in editor.js:
        if (output.indexOf(processName) === -1) {
          return [COMMON_EDITORS[processName]];
        }
      }
    }
  }
```

**Patch args**

```diff
@@
-        if (output.indexOf(processName) === -1) {
+        if (output.indexOf(processName) !== -1) {
           return [COMMON_EDITORS[processName]];
         }
       }
     }
   }

```

### Operator Swap Nullish 002 (EnterLeaveEventPlugin.js)

#### Run 1

##### Attempt 1

- Path: EnterLeaveEventPlugin.js
- Operation: —

**Tool error**

```
Line 5: Hunk does not contain any lines
```

**Patch args**

```diff
@@
-      win = doc.defaultView ?? doc.parentWindow;
+      win = doc.defaultView || doc.parentWindow;
@@

```

##### Attempt 2

- Path: EnterLeaveEventPlugin.js
- Operation: —

**Tool error**

```
Line 12: Hunk does not contain any lines
```

**Patch args**

```diff
@@
-    if (doc) {
-      win = doc.defaultView ?? doc.parentWindow;
-    } else {
+    if (doc) {
+      win = doc.defaultView || doc.parentWindow;
+    } else {
       win = window;
     }
   }
@@

```

##### Attempt 3

- Path: EnterLeaveEventPlugin.js
- Operation: —

**Tool error**

```
Line 21: Hunk does not contain any lines
```

**Patch args**

```diff
@@
-  } else {
-    // TODO: Figure out why `ownerDocument` is sometimes undefined in IE8.
-    const doc = (nativeEventTarget: any).ownerDocument;
-    if (doc) {
-      win = doc.defaultView ?? doc.parentWindow;
-    } else {
-      win = window;
-    }
-  }
+  } else {
+    // TODO: Figure out why `ownerDocument` is sometimes undefined in IE8.
+    const doc = (nativeEventTarget: any).ownerDocument;
+    if (doc) {
+      win = doc.defaultView || doc.parentWindow;
+    } else {
+      win = window;
+    }
+  }
@@

```

##### Attempt 4

- Path: EnterLeaveEventPlugin.js
- Operation: —

**Tool error**

```
Line 7: Hunk does not contain any lines
```

**Patch args**

```diff
@@
-    if (doc) {
-      win = doc.defaultView ?? doc.parentWindow;
+    if (doc) {
+      win = doc.defaultView || doc.parentWindow;
@@

```

##### Attempt 5

- Path: EnterLeaveEventPlugin.js
- Operation: —

**Tool error**

```
Line 5: Hunk does not contain any lines
```

**Patch args**

```diff
@@
-      win = doc.defaultView ?? doc.parentWindow;
+      win = doc.defaultView || doc.parentWindow;
@@

```

## Flaky Tasks (partial passing)

### Access Remove Optional Chain 001 (registerDevToolsEventLogger.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for registerDevToolsEventLogger.js | 15,733 / 2,130 | 21.7s |
| 2 | ✅ | — | 10,887 / 2,669 | 19.6s |
| 3 | ✅ | — | 13,062 / 644 | 10.2s |

### Access Remove Optional Chain 003 (astUtils.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 51,935 / 5,337 | 46.6s |
| 2 | ❌ | File mismatch for astUtils.js | 23,627 / 6,126 | 44.5s |
| 3 | ✅ | — | 51,157 / 1,671 | 17.9s |

### Call Swap Call Args 002 (FlamegraphChartBuilder.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 31,094 / 2,263 | 23.2s |
| 2 | ✅ | — | 20,262 / 2,202 | 21.1s |
| 3 | ❌ | File mismatch for FlamegraphChartBuilder.js | 22,757 / 4,936 | 56.6s |

### Call Swap Call Args 003 (SyntheticEvent.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for SyntheticEvent.js | 8,057 / 1,052 | 9.2s |
| 2 | ✅ | — | 8,211 / 2,011 | 18.1s |
| 3 | ✅ | — | 8,618 / 1,756 | 13.9s |

### Duplicate Duplicate Line Flip 002 (ActivityList.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 14,213 / 488 | 7.8s |
| 2 | ✅ | — | 8,650 / 598 | 10.4s |
| 3 | ❌ | File mismatch for ActivityList.js | 1,293 / 16 | 4.3s |

### Identifier Identifier Multi Edit 001 (TabBar.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for TabBar.js | 3,306 / 725 | 9.5s |
| 2 | ✅ | — | 25,886 / 1,524 | 22.2s |
| 3 | ✅ | — | 10,229 / 2,424 | 21.9s |

### Identifier Identifier Multi Edit 002 (EventPluginRegistry.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 33,876 / 1,386 | 21.8s |
| 2 | ✅ | — | 19,410 / 1,329 | 12.5s |
| 3 | ❌ | File mismatch for EventPluginRegistry.js | 3,854 / 956 | 8.8s |

### Identifier Identifier Multi Edit 003 (ReactPerformanceTrackProperties.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 7,067 / 2,482 | 24.6s |
| 2 | ❌ | File mismatch for ReactPerformanceTrackProperti... | 25,542 / 16,390 | 85.4s |
| 3 | ❌ | File mismatch for ReactPerformanceTrackProperti... | 13,142 / 2,119 | 15.0s |

### Import Swap Named Imports 001 (CommitFlamegraphListItem.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for CommitFlamegraphListItem.js | 28,062 / 2,414 | 20.1s |
| 2 | ✅ | — | 67,706 / 8,262 | 81.4s |
| 3 | ❌ | File mismatch for CommitFlamegraphListItem.js | 9,305 / 1,470 | 17.3s |

### Import Swap Named Imports 002 (ReactDOMTextarea.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 6,530 / 565 | 17.5s |
| 2 | ❌ | File mismatch for ReactDOMTextarea.js | 19,875 / 1,036 | 14.7s |
| 3 | ✅ | — | 11,698 / 1,371 | 14.1s |

### Literal Flip Boolean 002 (ReactNoopFlightServer.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 29,149 / 1,053 | 12.0s |
| 2 | ❌ | File mismatch for ReactNoopFlightServer.js | 12,265 / 12,033 | 58.4s |
| 3 | ✅ | — | 8,709 / 2,208 | 21.6s |

### Literal Flip Boolean 003 (ReactFlightDOMClientEdge.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 8,935 / 2,109 | 22.8s |
| 2 | ✅ | — | 21,408 / 2,720 | 25.2s |
| 3 | ❌ | File mismatch for ReactFlightDOMClientEdge.js | 15,861 / 1,577 | 20.9s |

### Literal Off By One 001 (githubAPI.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |
| 2 | ✅ | — | 9,056 / 209 | 11.0s |
| 3 | ✅ | — | 3,872 / 289 | 4.6s |

### Literal Off By One 002 (code-path.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 5,602 / 7,395 | 57.1s |
| 2 | ❌ | File mismatch for code-path.js | 1,413 / 214 | 4.6s |
| 3 | ✅ | — | 23,458 / 9,913 | 79.1s |

### Literal Off By One 003 (InspectedElement.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 13,091 / 1,840 | 15.2s |
| 2 | ✅ | — | 30,602 / 3,973 | 37.3s |
| 3 | ❌ | File mismatch for InspectedElement.js | 11,579 / 1,238 | 15.5s |

### Operator Swap Arithmetic 001 (fallbackEvalContext.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for fallbackEvalContext.js | 9,454 / 458 | 7.7s |
| 2 | ❌ | File mismatch for fallbackEvalContext.js | 5,409 / 717 | 6.6s |
| 3 | ✅ | — | 7,688 / 209 | 4.4s |

### Operator Swap Comparison 002 (ReactFlightDOMServerBrowser.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for ReactFlightDOMServerBrowser.js | 2,668 / 399 | 9.5s |
| 2 | ✅ | — | 30,400 / 7,484 | 81.5s |
| 3 | ❌ | File mismatch for ReactFlightDOMServerBrowser.js | 1,298 / 181 | 4.6s |

### Operator Swap Increment Decrement 001 (ReactFlightDOMClientNode.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 22,824 / 345 | 5.0s |
| 2 | ✅ | — | 13,022 / 390 | 6.5s |
| 3 | ❌ | File mismatch for ReactFlightDOMClientNode.js | 73,509 / 3,663 | 39.7s |

### Operator Swap Increment Decrement 002 (ReactFlightDOMClientNode.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 4,473 / 855 | 9.0s |
| 2 | ✅ | — | 8,770 / 234 | 6.6s |
| 3 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.8s |

### Operator Swap Increment Decrement 003 (loadSourceAndMetadata.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 11,075 / 264 | 5.4s |
| 2 | ✅ | — | 7,193 / 642 | 9.6s |
| 3 | ❌ | File mismatch for loadSourceAndMetadata.js | 11,794 / 336 | 11.6s |

### Operator Swap Logical 003 (DevToolsFiberComponentStack.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for DevToolsFiberComponentStack.js | 19,630 / 4,346 | 40.0s |
| 2 | ✅ | — | 18,109 / 13,452 | 95.3s |
| 3 | ✅ | — | 50,105 / 7,254 | 58.2s |

### Operator Swap Nullish 001 (getBatchRange.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 3,409 / 763 | 9.5s |
| 2 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |
| 3 | ✅ | — | 12,064 / 3,395 | 29.2s |

### Operator Swap Nullish 002 (EnterLeaveEventPlugin.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 37,478 / 4,698 | 51.5s |
| 2 | ❌ | File mismatch for EnterLeaveEventPlugin.js | 1,294 / 418 | 5.7s |
| 3 | ✅ | — | 6,811 / 3,118 | 26.1s |

### Structural Delete Statement 002 (getComponentNameFromFiber.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for getComponentNameFromFiber.js | 32,249 / 1,601 | 23.1s |
| 2 | ✅ | — | 19,628 / 1,831 | 16.8s |
| 3 | ❌ | File mismatch for getComponentNameFromFiber.js | 6,797 / 1,333 | 15.2s |

### Structural Remove Early Return 002 (useCommitFilteringAndNavigation.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 8,068 / 2,737 | 24.3s |
| 2 | ❌ | File mismatch for useCommitFilteringAndNavigati... | 7,403 / 1,193 | 10.2s |
| 3 | ✅ | — | 9,350 / 1,990 | 19.1s |

### Structural Swap Adjacent Lines 001 (ReactServerConsoleConfigPlain.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for ReactServerConsoleConfigPlain.js | 6,160 / 267 | 5.8s |
| 2 | ✅ | — | 12,758 / 341 | 6.8s |
| 3 | ❌ | File mismatch for ReactServerConsoleConfigPlain.js | 2,284 / 1,663 | 15.6s |

### Structural Swap Adjacent Lines 002 (ReactNoopFlightServer.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for ReactNoopFlightServer.js | 58,077 / 5,083 | 57.4s |
| 2 | ✅ | — | 13,162 / 1,512 | 15.5s |
| 3 | ❌ | File mismatch for ReactNoopFlightServer.js | 146 / 16,035 | 11.5s |

### Structural Swap If Else 003 (ReactDOMFizzStaticNode.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 6,280 / 5,483 | 44.3s |
| 2 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |
| 3 | ✅ | — | 58,486 / 2,386 | 26.4s |

### Unicode Unicode Hyphen 002 (UnsupportedBridgeProtocolDialog.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 7,895 / 276 | 7.6s |
| 2 | ❌ | File mismatch for UnsupportedBridgeProtocolDial... | 1,297 / 136 | 3.2s |
| 3 | ❌ | File mismatch for UnsupportedBridgeProtocolDial... | 2,888 / 190 | 2.6s |

### Unicode Unicode Hyphen 003 (ReactTypes.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 3,984 / 336 | 6.6s |
| 2 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |
| 3 | ❌ | File mismatch for ReactTypes.js | 2,657 / 792 | 10.3s |

## Failed Tasks (0% passing)

### Access Remove Optional Chain 002 (TimelineContext.js) — 0/3

**All runs failed with same error:** File mismatch for TimelineContext.js

**Sample agent response (run 1):**
```
Plan:
- Assume `store.profilerStore` isn’t guaranteed to exist, so reintroducing the missing optional chaining is necessary to avoid uncaught property access errors.
- Focus on the `getState` callback inside `TimelineContextController`’s `useSyncExternalStore` for `inMemoryTimelineData`, since that’s where `store.profilerStore` is dereferenced.
- Restore the single optional chaining operator at that exact property access—no other changes.
```

**Diff (expected vs actual):**
```diff
@@ -80 @@
       };
     },
     function getState() {
-      return store.profilerStore.profilingData?.timelineData || null;
+      return store.profilerStore.profilingData.timelineData || null;
     },
   );
 
```

### Duplicate Duplicate Line Flip 003 (SyntheticEvent.js) — 0/3

**All runs failed with same error:** Timeout waiting for agent_end

### Import Swap Named Imports 003 (StyleEditor.js) — 0/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for StyleEditor.js | 42,133 / 8,637 | 71.5s |
| 2 | ❌ | File mismatch for StyleEditor.js | 13,763 / 8,401 | 70.3s |
| 3 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |

**Sample agent response (run 1):**
```
Summary:
- ReactFlightDOMServerBrowser.js: stopped resolving the trailing partial message by iterating only while `i < messages.length - 1` inside `startReadingFromDebugChannelReadableStream`.
- editor.js: corrected the macOS editor-detection loop to return the first running editor by checking `output.indexOf(processName) !== -1`.
- StyleEditor.js: reordered the `StoreContext`/`BridgeContext` named imports so each useContext call receives the right context reference.

Testing:
- Not run (not ...
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

### Literal Flip Boolean 001 (testHelpers.js) — 0/3

**All runs failed with same error:** File mismatch for testHelpers.js

**Sample agent response (run 1):**
```
Change:
- Flipped the boolean for `fallback` in `describeWithPointerEvent` so only the primary pointer type entry is `true`, and the fallback is `false`, matching the intended behavior while touching no other code.
```

**Diff (expected vs actual):**
```diff
@@ -9 @@
 
 'use strict';
 
-import { hasPointerEvent, setPointerEvent } from './domEnvironment';
+import {hasPointerEvent, setPointerEvent} from './domEnvironment';
 
 export function describeWithPointerEvent(message, describeFn) {
   const pointerEvent = 'PointerEvent';
@@ -18 @@
     value    | name
     ${true}  | ${pointerEvent}
     ${false} | ${fallback}
-  `(`${message}: $name`, (entry) => {
+
     const hasPointerEvents = entry.value;
     setPointerEvent(hasPointerEvents);
     describeFn(hasPointerEvents);
@@ -26 @@
 }
 
 export function testWithPointerType(message, testFn) {
-  const table = hasPointerEvent() ? ['mouse', 'touch', 'pen'] : ['mouse', 'touch'];
-  test.each(table)(`${message}: %s`, (pointerType) => {
+  const table = hasPointerEvent()
+    ? ['mouse', 'touch', 'pen']
+    : ['mouse', 'touch'];
+  test.each(table)(`${message}: %s`, pointerType => {
     testFn(pointerType);
   });
 }
```

### Operator Remove Negation 001 (ReactDOMClient.js) — 0/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for ReactDOMClient.js | 518 / 412 | 6.6s |
| 2 | ❌ | File mismatch for ReactDOMClient.js | 17,739 / 12,906 | 92.0s |
| 3 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |

**Sample agent response (run 1):**
```
Plan:
1. Inspect `ReactDOMClient.js` to understand the context around line 57 and confirm the stray negation.
2. Locate the specific expression with the accidental `!` and verify no other similar changes are needed.
3. Apply the minimal edit: remove only the erroneous logical negation.

Assumptions:
- Line 57 uniquely contains the accidental negation; the rest of the file should remain untouched.
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
| 1 | ❌ | File mismatch for ReactFlightUnbundledReference... | 1,380 / 86 | 4.7s |
| 2 | ❌ | File mismatch for ReactFlightUnbundledReference... | 12,692 / 4,442 | 473ms |
| 3 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |

**Sample agent response (run 1):**
```
Plan:
1. Read `ReactFlightUnbundledReferences.js` to understand context and identify the misplaced negation operator.
2. Determine the precise location that needs correction while ensuring minimal change.
3. Apply a surgical fix reverting the incorrect logical negation without altering surrounding code.
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
```

### Operator Swap Arithmetic 003 (hooks.js) — 0/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for hooks.js | 32,057 / 3,145 | 29.1s |
| 2 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |
| 3 | ❌ | File mismatch for hooks.js | 18,627 / 543 | 7.8s |

**Sample agent response (run 1):**
```
Summary:
- Corrected the comparison in `useIsOverflowing` so overflow is reported only when `totalChildWidth` actually exceeds the container, switching `<=` back to `<`.

Tests:
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

### Operator Swap Comparison 003 (ReactFlightDOMServerNode.js) — 0/3

**All runs failed with same error:** File mismatch for ReactFlightDOMServerNode.js

**Sample agent response (run 1):**
```
Summary:
- Corrected the field-queueing condition in `decodeReplyFromBusboy` so fields are only deferred while files are pending by changing `pendingFiles >= 0` to `pendingFiles > 0`.

Testing:
- Not run (not requested).

Assumptions:
- The intention is to process queued fields immediately once all files have finished; the previous `>=` made the `else` branch unreachable, so `resolveField` never ran while no files were pending.
```

**Diff (expected vs actual):**
```diff
@@ -539 @@
   const queuedFields: Array<string> = [];
   busboyStream.on('field', (name, value) => {
     if (pendingFiles > 0) {
-      // Because the 'end' event fires two microtasks after the next 'field'
       // we would resolve files and fields out of order. To handle this properly
       // we queue any fields we receive until the previous file is done.
       queuedFields.push(name, value);
```

### Operator Swap Nullish 003 (backend.js) — 0/3

**All runs failed with same error:** File mismatch for backend.js

**Sample agent response (run 1):**
```
Summary:
- Updated `handleEnd` in `createFromNodeStream` so `streamEndedCount` increments instead of decrements, ensuring the response closes after both streams finish.

Testing:
- Not run (not requested).
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
```

### Regex Swap Regex Quantifier 003 (utils.js) — 0/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.8s |
| 2 | ❌ | File mismatch for utils.js | 28,894 / 10,280 | 74.3s |
| 3 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.8s |

**Sample agent response (run 1):**
```
Plan:
- Confirm the regex that governs the `pluralize` guard (the only place I can find a quantifier in this file affecting letter-only input).
- Recognize the quantifier should require at least one alphabetical character, so whitespace-only or empty strings fail the check.
- Apply the minimal change—swap `*` for `+` in that regex—and leave everything else untouched.

Assumption: The intention is to forbid empty or whitespace-only words as “single a-z words,” so the leading `if` should use `+...
```

**Diff (expected vs actual):**
```diff
@@ -188 @@
 }
 
 export function pluralize(word: string): string {
-  if (!/^[a-z]+$/i.test(word)) {
+  if (!/^[a-z]*$/i.test(word)) {
     // If it's not a single a-z word, give up.
     return word;
   }
```

### Structural Delete Statement 003 (simulateBrowserEventDispatch.js) — 0/3

**All runs failed with same error:** File mismatch for simulateBrowserEventDispatch.js

**Sample agent response (run 1):**
```
Summary:
- In `simulateBrowserEventDispatch.js`, restored the return value from `simulateEventDispatch` so that it now propagates the `_dispatch` result (whether the event was canceled).

Testing:
- Not run (not requested).
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

### Structural Remove Early Return 001 (InspectedElementStateTree.js) — 0/3

**All runs failed with same error:** File mismatch for InspectedElementStateTree.js

**Sample agent response (run 1):**
```
Restored the early return guard in `InspectedElementStateTree.js` to handle `null`/`undefined` state before calling `Object.entries`, preventing the crash around line 39.
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

**All runs failed with same error:** File mismatch for ReactFiberAsyncAction.js

**Sample agent response (run 1):**
```
Summary:
- Reintroduced the guard at the start of `pingEngtangledActionScope` so it returns immediately if there is no active listener, preventing extra decrements after the entangled scope closes.

Testing:
- Not run (not requested).
```

**Diff (expected vs actual):**
```diff
@@ -7 @@
  * @flow
  */
 
-import type { Thenable, FulfilledThenable, RejectedThenable } from 'shared/ReactTypes';
-import type { Lane } from './ReactFiberLane';
-import type { Transition } from 'react/src/ReactStartTransition';
+import type {
+  Thenable,
+  FulfilledThenable,
+  RejectedThenable,
+} from 'shared/ReactTypes';
+import type {Lane} from './ReactFiberLane';
+import type {Transition} from 'react/src/ReactStartTransition';
 
 
-import { requestTransitionLane, ensureScheduleIsScheduled } from './ReactFiberRootScheduler';
-import { NoLane } from './ReactFiberLane';
-import { hasScheduledTransitionWork, clearAsyncTransitionTimer } from './ReactProfilerTimer';
 import {
 import {
+  requestTransitionLane,
+  ensureScheduleIsScheduled,
+} from './ReactFiberRootScheduler';
+import {NoLane} from './ReactFiberLane';
+import {
+  hasScheduledTransitionWork,
+  clearAsyncTransitionTimer,
+} from './ReactProfilerTimer';
+import {
   enableComponentPerformanceTrack,
   enableProfilerTimer,
   enableDefaultTransitionIndicator,
@@ -19 @@
   enableProfilerTimer,
   enableDefaultTransitionIndicator,
 } from 'shared/ReactFeatureFlags';
-import { clearEntangledAsyncTransitionTypes } from './ReactFiberTransitionTypes';
+import {clearEntangledAsyncTransitionTypes} from './ReactFiberTransitionTypes';
 
 import noop from 'shared/noop';
 import reportGlobalError from 'shared/reportGlobalError';
@@ -47 @@
 // had any roots registered yet. null means there's more than one callback.
 // If there's more than one callback we bailout to not supporting isomorphic
 // default indicators.
-let isomorphicDefaultTransitionIndicator: void | null | (() => void | (() => void)) = undefined;
+let isomorphicDefaultTransitionIndicator:
+  | void
+  | null
+  | (() => void | (() => void)) = undefined;
 // The clean up function for the currently running indicator.
 let pendingIsomorphicIndicator: null | (() => void) = null;
 // The number of roots that have pending Transitions that depend on t...
```

### Structural Swap Adjacent Lines 003 (backend.js) — 0/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.9s |
| 2 | ❌ | File mismatch for backend.js | 39,342 / 18,188 | 77.6s |
| 3 | ❌ | File mismatch for backend.js | 27,921 / 10,962 | 74.2s |

**Sample agent response (run 1):**
```
Assumed `selectedActivityID` should match exactly one entry in `activities`, so the ArrowUp handler must search for the selected ID rather than every other ID; ArrowDown already did the right equality check, so changed the ArrowUp `findIndex` predicate from `!==` to `===` to keep keyboard navigation in sync.

Assumed `useIsOverflowing` should only report overflow when the summed child width actually exceeds the container’s width, so tightened the comparison from `<=` to `<` to avoid falsely f...
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
```

### Structural Swap If Else 001 (importFile.js) — 0/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for importFile.js | 3,379 / 1,099 | 13.8s |
| 2 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |
| 3 | ❌ | File mismatch for importFile.js | 8,583 / 13,602 | 95.7s |

**Sample agent response (run 1):**
```
Assumed the only incorrect logic was the catch branch pairing in `importFile.js` and that no additional runtime verification was required beyond inspecting the status strings.

- Negated the `instanceof` check in the `catch` block so the previously swapped `if/else` bodies now align: invalid profiles return `INVALID_PROFILE_ERROR`, all other errors return `UNEXPECTED_ERROR`.
- No automated tests were run; please execute the relevant suite if desired.
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
Plan:
1. Assume the repo uses standard JS formatting and the bug is limited to a swapped `if/else` in the targeted function.
2. Read `ReactNativeFiberInspector.js` to confirm the current logic of `getInspectorDataForViewTag` and identify which branch bodies need to swap and negate.
3. Apply a minimal edit swapping the branch bodies and negating the condition without touching other logic.
```

**Diff (expected vs actual):**
```diff
@@ -146 @@
 
 function getInspectorDataForViewTag(viewTag: number): InspectorData {
   if (__DEV__) {
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
