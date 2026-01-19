# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-01-19T13:29:53.869Z |
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
| Successful Runs | 111 |
| **Task Success Rate** | **61.7% (111/180)** |
| Verified Rate | 61.7% (111/180) |
| Edit Tool Usage Rate | 100.0% (180/180) |
| **Edit Success Rate** | **93.7%** |
| Patch Failure Rate | 6.3% (16/252) |
| Tasks All Passing | 28 |
| Tasks Flaky/Failing | 32 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 371 | 2.1 |
| Edit | 252 | 1.4 |
| Write | 1 | 0.0 |
| **Tool Input Chars** | 123,304 | 685 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 4,069 | 23 |
| Output Tokens | 162,773 | 904 |
| Total Tokens | 13,449,592 | 74,720 |
| Duration | 2415.8s | 13.4s |
| **Avg Indent Score** | — | **2.26** |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Access Remove Optional Chain 001 | registerDevToolsEventLogger.js | 3/3 ✅ | 100.0% | 2/1/0 | 23/650 | 13.2s | 1.00 |
| Access Remove Optional Chain 002 | TimelineContext.js | 1/3 ⚠️ | 100.0% | 3/2/0 | 32/922 | 14.4s | 1.29 |
| Access Remove Optional Chain 003 | astUtils.js | 0/3 ❌ | 100.0% | 2/1/0 | 24/1,364 | 17.1s | 4.85 |
| Call Swap Call Args 001 | testHelpers.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 16/750 | 11.9s | 1.33 |
| Call Swap Call Args 002 | FlamegraphChartBuilder.js | 0/3 ❌ | 87.5% | 2/3/0 | 33/1,945 | 23.2s | 3.79 |
| Call Swap Call Args 003 | SyntheticEvent.js | 1/3 ⚠️ | 100.0% | 2/1/0 | 18/1,403 | 15.3s | 3.76 |
| Duplicate Duplicate Line Flip 001 | index.js | 3/3 ✅ | 100.0% | 2/1/0 | 19/440 | 8.6s | 0.00 |
| Duplicate Duplicate Line Flip 002 | ActivityList.js | 3/3 ✅ | 100.0% | 1/1/0 | 17/540 | 9.6s | 3.61 |
| Duplicate Duplicate Line Flip 003 | SyntheticEvent.js | 2/3 ⚠️ | 100.0% | 3/1/0 | 25/954 | 16.9s | 1.02 |
| Identifier Identifier Multi Edit 001 | TabBar.js | 1/3 ⚠️ | 85.7% | 2/2/0 | 27/1,171 | 15.6s | 3.33 |
| Identifier Identifier Multi Edit 002 | EventPluginRegistry.js | 2/3 ⚠️ | 100.0% | 1/2/0 | 20/793 | 12.1s | 3.94 |
| Identifier Identifier Multi Edit 003 | ReactPerformanceTrackProperties.js | 3/3 ✅ | 100.0% | 9/4/0 | 77/2,198 | 37.5s | 9.95 |
| Import Swap Named Imports 001 | CommitFlamegraphListItem.js | 3/3 ✅ | 100.0% | 2/1/0 | 25/891 | 13.6s | 2.86 |
| Import Swap Named Imports 002 | ReactDOMTextarea.js | 3/3 ✅ | 100.0% | 1/1/0 | 15/515 | 8.6s | 2.41 |
| Import Swap Named Imports 003 | StyleEditor.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 14/772 | 11.5s | 1.31 |
| Literal Flip Boolean 001 | testHelpers.js | 3/3 ✅ | 100.0% | 1/1/0 | 15/374 | 6.6s | 1.33 |
| Literal Flip Boolean 002 | ReactNoopFlightServer.js | 3/3 ✅ | 100.0% | 1/1/0 | 16/556 | 10.5s | 1.11 |
| Literal Flip Boolean 003 | ReactFlightDOMClientEdge.js | 0/3 ❌ | 66.7% | 1/2/0 | 23/761 | 13.3s | 3.57 |
| Literal Off By One 001 | githubAPI.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 15/446 | 7.5s | 0.67 |
| Literal Off By One 002 | code-path.js | 0/3 ❌ | 75.0% | 1/1/0 | 17/967 | 12.0s | 3.50 |
| Literal Off By One 003 | InspectedElement.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 18/603 | 10.5s | 2.40 |
| Operator Remove Negation 001 | ReactDOMClient.js | 0/3 ❌ | 100.0% | 2/2/0 | 22/1,565 | 20.7s | 1.08 |
| Operator Remove Negation 002 | NativeEventsView.js | 3/3 ✅ | 87.5% | 5/3/0 | 46/2,030 | 26.1s | 3.03 |
| Operator Remove Negation 003 | ReactFlightUnbundledReferences.js | 0/3 ❌ | 100.0% | 2/1/0 | 19/1,507 | 19.0s | 2.00 |
| Operator Swap Arithmetic 001 | fallbackEvalContext.js | 3/3 ✅ | 100.0% | 1/1/0 | 14/353 | 6.2s | 0.00 |
| Operator Swap Arithmetic 002 | CSSShorthandProperty.js | 3/3 ✅ | 100.0% | 2/1/0 | 17/467 | 8.8s | 2.88 |
| Operator Swap Arithmetic 003 | hooks.js | 0/3 ❌ | 66.7% | 3/2/0 | 34/1,062 | 16.4s | 2.25 |
| Operator Swap Comparison 001 | index.js | 3/3 ✅ | 100.0% | 1/1/0 | 16/403 | 7.8s | 0.00 |
| Operator Swap Comparison 002 | ReactFlightDOMServerBrowser.js | 1/3 ⚠️ | 100.0% | 3/2/0 | 29/1,099 | 17.0s | 1.57 |
| Operator Swap Comparison 003 | ReactFlightDOMServerNode.js | 3/3 ✅ | 100.0% | 2/2/0 | 22/909 | 14.3s | 1.95 |
| Operator Swap Equality 001 | readInputData.js | 3/3 ✅ | 100.0% | 1/1/0 | 14/361 | 6.4s | 0.00 |
| Operator Swap Equality 002 | editor.js | 3/3 ✅ | 100.0% | 1/1/0 | 15/506 | 8.6s | 0.00 |
| Operator Swap Equality 003 | hooks.js | 3/3 ✅ | 100.0% | 3/1/0 | 30/670 | 12.9s | 2.25 |
| Operator Swap Increment Decrement 001 | ReactFlightDOMClientNode.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 15/512 | 8.7s | 1.52 |
| Operator Swap Increment Decrement 002 | ReactFlightDOMClientNode.js | 3/3 ✅ | 75.0% | 1/1/0 | 18/680 | 10.1s | 1.92 |
| Operator Swap Increment Decrement 003 | loadSourceAndMetadata.js | 3/3 ✅ | 100.0% | 1/1/0 | 15/414 | 7.6s | 3.72 |
| Operator Swap Logical 001 | profiling.js | 1/3 ⚠️ | 100.0% | 2/2/0 | 23/677 | 11.1s | 0.00 |
| Operator Swap Logical 002 | SourceMapMetadataConsumer.js | 2/3 ⚠️ | 85.7% | 4/2/0 | 36/1,446 | 19.9s | 3.05 |
| Operator Swap Logical 003 | DevToolsFiberComponentStack.js | 3/3 ✅ | 100.0% | 1/1/0 | 14/462 | 8.5s | 4.13 |
| Operator Swap Nullish 001 | getBatchRange.js | 3/3 ✅ | 100.0% | 1/1/0 | 15/410 | 7.0s | 1.33 |
| Operator Swap Nullish 002 | EnterLeaveEventPlugin.js | 2/3 ⚠️ | 87.5% | 4/3/0 | 41/1,467 | 21.9s | 1.56 |
| Operator Swap Nullish 003 | backend.js | 1/3 ⚠️ | 80.0% | 4/2/0 | 34/926 | 15.8s | 3.15 |
| Regex Swap Regex Quantifier 001 | githubAPI.js | 3/3 ✅ | 100.0% | 2/1/0 | 17/549 | 8.8s | 0.67 |
| Regex Swap Regex Quantifier 002 | ReactFlightStackConfigV8.js | 3/3 ✅ | 100.0% | 1/1/0 | 17/1,326 | 16.5s | 3.06 |
| Regex Swap Regex Quantifier 003 | utils.js | 2/3 ⚠️ | 100.0% | 2/1/0 | 23/1,059 | 14.2s | 2.00 |
| Structural Delete Statement 001 | UnsupportedVersionDialog.js | 3/3 ✅ | 100.0% | 1/1/0 | 15/416 | 7.5s | 6.22 |
| Structural Delete Statement 002 | getComponentNameFromFiber.js | 0/3 ❌ | 100.0% | 3/1/0 | 25/832 | 14.2s | 0.62 |
| Structural Delete Statement 003 | simulateBrowserEventDispatch.js | 0/3 ❌ | 100.0% | 3/1/0 | 27/3,509 | 36.6s | 4.45 |
| Structural Remove Early Return 001 | InspectedElementStateTree.js | 1/3 ⚠️ | 100.0% | 2/1/0 | 18/692 | 10.9s | 0.36 |
| Structural Remove Early Return 002 | useCommitFilteringAndNavigation.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 14/473 | 7.9s | 3.84 |
| Structural Remove Early Return 003 | ReactFiberAsyncAction.js | 0/3 ❌ | 80.0% | 3/2/0 | 23/1,476 | 17.5s | 2.05 |
| Structural Swap Adjacent Lines 001 | ReactServerConsoleConfigPlain.js | 3/3 ✅ | 100.0% | 1/1/0 | 16/599 | 10.3s | 1.00 |
| Structural Swap Adjacent Lines 002 | ReactNoopFlightServer.js | 0/3 ❌ | 100.0% | 2/1/0 | 21/633 | 10.5s | 0.37 |
| Structural Swap Adjacent Lines 003 | backend.js | 0/3 ❌ | 57.1% | 4/2/0 | 40/1,760 | 21.1s | 3.15 |
| Structural Swap If Else 001 | importFile.js | 0/3 ❌ | 100.0% | 1/1/0 | 17/565 | 7.6s | 0.00 |
| Structural Swap If Else 002 | ReactNativeFiberInspector.js | 0/3 ❌ | 100.0% | 2/1/0 | 20/699 | 11.1s | 3.18 |
| Structural Swap If Else 003 | ReactDOMFizzStaticNode.js | 3/3 ✅ | 100.0% | 1/1/0 | 13/758 | 10.7s | 1.89 |
| Unicode Unicode Hyphen 001 | Rectangle.js | 3/3 ✅ | 100.0% | 1/1/0 | 16/343 | 7.4s | 3.00 |
| Unicode Unicode Hyphen 002 | UnsupportedBridgeProtocolDialog.js | 3/3 ✅ | 100.0% | 2/1/0 | 22/612 | 10.3s | 3.83 |
| Unicode Unicode Hyphen 003 | ReactTypes.js | 3/3 ✅ | 100.0% | 4/2/0 | 33/1,016 | 18.0s | 1.24 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 9 | 44.4% (4/9) | 100.0% (9/9) | 44.4% (4/9) | 7 / 8.7 / 10 |
| call | 9 | 22.2% (2/9) | 100.0% (9/9) | 22.2% (2/9) | 6 / 7.7 / 10 |
| duplicate | 9 | 88.9% (8/9) | 100.0% (9/9) | 88.9% (8/9) | 7 / 9.7 / 12 |
| identifier | 9 | 66.7% (6/9) | 100.0% (9/9) | 66.7% (6/9) | 6 / 9.3 / 14 |
| import | 9 | 77.8% (7/9) | 100.0% (9/9) | 77.8% (7/9) | 2 / 4.7 / 6 |
| literal | 18 | 55.6% (10/18) | 100.0% (18/18) | 55.6% (10/18) | 4 / 6.2 / 9 |
| operator | 63 | 71.4% (45/63) | 100.0% (63/63) | 71.4% (45/63) | 1 / 6.5 / 13 |
| regex | 9 | 88.9% (8/9) | 100.0% (9/9) | 88.9% (8/9) | 6 / 7.3 / 8 |
| structural | 36 | 33.3% (12/36) | 100.0% (36/36) | 33.3% (12/36) | 4 / 7.6 / 15 |
| unicode | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) | 1 / 3.0 / 6 |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 9 | 33.3% (3/9) | 100.0% (9/9) | 33.3% (3/9) |
| duplicate-line-flip | duplicate | 9 | 88.9% (8/9) | 100.0% (9/9) | 88.9% (8/9) |
| flip-boolean | literal | 9 | 66.7% (6/9) | 100.0% (9/9) | 66.7% (6/9) |
| identifier-multi-edit | identifier | 9 | 66.7% (6/9) | 100.0% (9/9) | 66.7% (6/9) |
| off-by-one | literal | 9 | 44.4% (4/9) | 100.0% (9/9) | 44.4% (4/9) |
| remove-early-return | structural | 9 | 33.3% (3/9) | 100.0% (9/9) | 33.3% (3/9) |
| remove-negation | operator | 9 | 33.3% (3/9) | 100.0% (9/9) | 33.3% (3/9) |
| remove-optional-chain | access | 9 | 44.4% (4/9) | 100.0% (9/9) | 44.4% (4/9) |
| swap-adjacent-lines | structural | 9 | 33.3% (3/9) | 100.0% (9/9) | 33.3% (3/9) |
| swap-arithmetic | operator | 9 | 66.7% (6/9) | 100.0% (9/9) | 66.7% (6/9) |
| swap-call-args | call | 9 | 22.2% (2/9) | 100.0% (9/9) | 22.2% (2/9) |
| swap-comparison | operator | 9 | 77.8% (7/9) | 100.0% (9/9) | 77.8% (7/9) |
| swap-equality | operator | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) |
| swap-if-else | structural | 9 | 33.3% (3/9) | 100.0% (9/9) | 33.3% (3/9) |
| swap-increment-decrement | operator | 9 | 88.9% (8/9) | 100.0% (9/9) | 88.9% (8/9) |
| swap-logical | operator | 9 | 66.7% (6/9) | 100.0% (9/9) | 66.7% (6/9) |
| swap-named-imports | import | 9 | 77.8% (7/9) | 100.0% (9/9) | 77.8% (7/9) |
| swap-nullish | operator | 9 | 66.7% (6/9) | 100.0% (9/9) | 66.7% (6/9) |
| swap-regex-quantifier | regex | 9 | 88.9% (8/9) | 100.0% (9/9) | 88.9% (8/9) |
| unicode-hyphen | unicode | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) |

## Difficulty Summary

| Difficulty Score | Runs | Verified | Edit Used | Success |
|------------------|------|----------|-----------|---------|
| 0-2 | 18 | 83.3% (15/18) | 100.0% (18/18) | 83.3% (15/18) |
| 3-5 | 36 | 63.9% (23/36) | 100.0% (36/36) | 63.9% (23/36) |
| 6-8 | 72 | 62.5% (45/72) | 100.0% (72/72) | 62.5% (45/72) |
| 9+ | 54 | 51.9% (28/54) | 100.0% (54/54) | 51.9% (28/54) |

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
  commitIndex,
  commitTree,
  profilerStore,
  rootID,
}): ChartData {
  const commitDatum = profilerStore.getCommitData(rootID, commitIndex);
```

**Patch args**

```diff
@@ export function getChartData({
   commitIndex,
   commitTree,
   profilerStore,
   rootID,
 }): ChartData {
-  const commitDatum = profilerStore.getCommitData(rootID, commitIndex);
+  const commitDatum = profilerStore.getCommitData(commitIndex, rootID);
```

### Identifier Identifier Multi Edit 001 (TabBar.js)

#### Run 1

##### Attempt 1

- Path: /tmp/edit-bench-batch-rxDMFB/TabBar.js
- Operation: —

**Tool error**

```
Line 2: Hunk does not contain any lines
```

**Patch args**

```diff
@@ checked={currentTab === di}
```

### Literal Flip Boolean 003 (ReactFlightDOMClientEdge.js)

#### Run 1

##### Attempt 1

- Path: /tmp/edit-bench-batch-7X4glF/ReactFlightDOMClientEdge.js
- Operation: —

**Tool error**

```
Line 2: Hunk does not contain any lines
```

**Patch args**

```diff
@@ __DEV__ && options ? options.replayConsoleLogs === false : false, // defaults to false
```

#### Run 3

##### Attempt 1

- Path: ReactFlightDOMClientEdge.js
- Operation: —

**Tool error**

```
Line 2: Hunk does not contain any lines
```

**Patch args**

```diff
@@ __DEV__ && options ? options.replayConsoleLogs === false : false, // defaults to false
```

### Literal Off By One 002 (code-path.js)

#### Run 1

##### Attempt 1

- Path: code-path.js
- Operation: —

**Tool error**

```
rename path is the same as source path
```

**Patch args**

```diff
@@ // Update the stack.
      end = segment.nextSegments.length - 1;
      if (index < end) {
```

### Operator Remove Negation 002 (NativeEventsView.js)

#### Run 1

##### Attempt 1

- Path: /tmp/edit-bench-batch-lo5WHd/NativeEventsView.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/edit-bench-batch-lo5WHd/NativeEventsView.js:
    };
    if (rectIntersectsRect(eventRect, rect)) {
     if (!rectIntersectsRect(eventRect, rect)) {
      return; // Not in view
    }
    if (!rectIntersectsRect(eventRect, rect)) {
      return; // Not in view
    }
```

**Patch args**

```diff
@@ size: {width: xStop - xStart, height: NATIVE_EVENT_HEIGHT},
     };
     if (rectIntersectsRect(eventRect, rect)) {
      if (!rectIntersectsRect(eventRect, rect)) {
       return; // Not in view
     }
-    if (!rectIntersectsRect(eventRect, rect)) {
-      return; // Not in view
-    }

```

### Operator Swap Arithmetic 003 (hooks.js)

#### Run 3

##### Attempt 1

- Path: hooks.js
- Operation: —

**Tool error**

```
Failed to find expected lines in hooks.js:
      setIsOverflowing(container.clientWidth <= totalChildWidth);
      setIsOverflowing(container.clientWidth <= totalChildWidth);
```

**Patch args**

```diff
@@ const handleResize = () =>
       setIsOverflowing(container.clientWidth <= totalChildWidth);
-      setIsOverflowing(container.clientWidth <= totalChildWidth);
+      setIsOverflowing(container.clientWidth < totalChildWidth);
```

##### Attempt 2

- Path: hooks.js
- Operation: —

**Tool error**

```
Failed to find expected lines in hooks.js:
      setIsOverflowing(container.clientWidth <= totalChildWidth);
    const handleResize = () =>
      setIsOverflowing(container.clientWidth <= totalChildWidth);
```

**Patch args**

```diff
@@ const handleResize = () =>
       setIsOverflowing(container.clientWidth <= totalChildWidth);
-    const handleResize = () =>
-      setIsOverflowing(container.clientWidth <= totalChildWidth);
+    const handleResize = () =>
+      setIsOverflowing(container.clientWidth < totalChildWidth);
```

### Operator Swap Increment Decrement 002 (ReactFlightDOMClientNode.js)

#### Run 1

##### Attempt 1

- Path: ReactFlightDOMClientNode.js
- Operation: —

**Tool error**

```
Failed to find expected lines in ReactFlightDOMClientNode.js:
      if (--streamEndedCount === 2) {
      if (--streamEndedCount === 2) {
```

**Patch args**

```diff
@@     const handleEnd = () => {
       if (--streamEndedCount === 2) {
-      if (--streamEndedCount === 2) {
+      if (++streamEndedCount === 2) {
```

### Operator Swap Logical 002 (SourceMapMetadataConsumer.js)

#### Run 2

##### Attempt 1

- Path: /tmp/edit-bench-batch-St2QB5/SourceMapMetadataConsumer.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/edit-bench-batch-St2QB5/SourceMapMetadataConsumer.js:
 source = util.normalize(source);
 // Always ensure that absolute sources are internally stored relative to
 // the source root, if the source root is absolute. Not doing this would
 // be particularly problematic when the source root is a prefix of the
 // source (valid, but why??). See github issue #199 and bugzil.la/1188982.
 source =
   sourceRoot != null && util.isAbsolute(sourceRoot) || util.isAbsolute(source)
    ? util.relative(sourceRoot, source)
    : source;
 return util.computeSourceURL(sourceRoot, source);
```

**Patch args**

```diff
@@ // See bugzil.la/1090768.
  source = util.normalize(source);
  // Always ensure that absolute sources are internally stored relative to
  // the source root, if the source root is absolute. Not doing this would
  // be particularly problematic when the source root is a prefix of the
  // source (valid, but why??). See github issue #199 and bugzil.la/1188982.
  source =
-   sourceRoot != null && util.isAbsolute(sourceRoot) || util.isAbsolute(source)
+   sourceRoot != null && (util.isAbsolute(sourceRoot) || util.isAbsolute(source))
     ? util.relative(sourceRoot, source)
     : source;
  return util.computeSourceURL(sourceRoot, source);
```

### Operator Swap Nullish 002 (EnterLeaveEventPlugin.js)

#### Run 2

##### Attempt 1

- Path: EnterLeaveEventPlugin.js
- Operation: —

**Tool error**

```
Failed to find expected lines in EnterLeaveEventPlugin.js:
      win = doc.defaultView ?? doc.parentWindow;
    } else {
      win = doc.defaultView ?? doc.parentWindow;
```

**Patch args**

```diff
@@ if (doc) {
       win = doc.defaultView ?? doc.parentWindow;
     } else {
-      win = doc.defaultView ?? doc.parentWindow;
+      win = doc.defaultView || doc.parentWindow;
```

### Operator Swap Nullish 003 (backend.js)

#### Run 3

##### Attempt 1

- Path: /tmp/edit-bench-batch-rxDMFB/backend.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/edit-bench-batch-rxDMFB/backend.js:
    resolveRNStyle || hook.resolveRNStyle;
```

**Patch args**

```diff
@@ const nativeStyleResolver: ResolveNativeStyle | void =
-    resolveRNStyle || hook.resolveRNStyle;
+    resolveRNStyle ?? hook.resolveRNStyle;
```

### Structural Remove Early Return 003 (ReactFiberAsyncAction.js)

#### Run 1

##### Attempt 1

- Path: ReactFiberAsyncAction.js
- Operation: —

**Tool error**

```
Failed to find expected lines in ReactFiberAsyncAction.js:
     stopIsomorphicDefaultIndicator();
   }
   if (currentEntangledListeners === null) {
     return;
   }
   // All the actions have finished. Close the entangled async action scope
   // and notify all the listeners.
   if (currentEntangledActionThenable !== null) {
     const fulfilledThenable: FulfilledThenable<void> =
       (currentEntangledActionThenable: any);
     fulfilledThenable.status = 'fulfilled';
   }
   const listeners = currentEntangledListeners;
   currentEntangledListeners = null;
   currentEntangledLane = NoLane;
   currentEntangledActionThenable = null;
   needsIsomorphicIndicator = false;
   for (let i = 0; i < listeners.length; i++) {
     const listener = listeners[i];
     listener();
   }
```

**Patch args**

```diff
@@ if (pendingEntangledRoots === 0) {
      stopIsomorphicDefaultIndicator();
    }
    if (currentEntangledListeners === null) {
      return;
    }
    // All the actions have finished. Close the entangled async action scope
    // and notify all the listeners.
    if (currentEntangledActionThenable !== null) {
      const fulfilledThenable: FulfilledThenable<void> =
        (currentEntangledActionThenable: any);
      fulfilledThenable.status = 'fulfilled';
    }
    const listeners = currentEntangledListeners;
    currentEntangledListeners = null;
    currentEntangledLane = NoLane;
    currentEntangledActionThenable = null;
    needsIsomorphicIndicator = false;
    for (let i = 0; i < listeners.length; i++) {
      const listener = listeners[i];
      listener();
    }
```

### Structural Swap Adjacent Lines 003 (backend.js)

#### Run 2

##### Attempt 1

- Path: /tmp/edit-bench-batch-Fg6OzI/backend.js
- Operation: —

**Tool error**

```
Found 2 matches for context 'const agent = new Agent(bridge, isProfiling, onReloadAndProfile);' in /tmp/edit-bench-batch-Fg6OzI/backend.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
   if (typeof onReloadAndProfileFlagsReset === 'function') {
     onReloadAndProfileFlagsReset();
   }

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
+
+  if (typeof onReloadAndProfileFlagsReset === 'function') {
+    onReloadAndProfileFlagsReset();
+  }
-
-  if (typeof onReloadAndProfileFlagsReset === 'function') {
-    onReloadAndProfileFlagsReset();
-  }

```

##### Attempt 2

- Path: /tmp/edit-bench-batch-Fg6OzI/backend.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/edit-bench-batch-Fg6OzI/backend.js:
  const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
  if (typeof onReloadAndProfileFlagsReset === 'function') {
    onReloadAndProfileFlagsReset();
  }

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

  const unsubscribeBackend = initBackend(

  if (typeof onReloadAndProfileFlagsReset === 'function') {
    onReloadAndProfileFlagsReset();
  }
```

**Patch args**

```diff
@@ export function connectWithCustomMessagingProtocol({
   const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
   if (typeof onReloadAndProfileFlagsReset === 'function') {
     onReloadAndProfileFlagsReset();
   }

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

   const unsubscribeBackend = initBackend(
+
+  if (typeof onReloadAndProfileFlagsReset === 'function') {
+    onReloadAndProfileFlagsReset();
+  }
-
-  if (typeof onReloadAndProfileFlagsReset === 'function') {
-    onReloadAndProfileFlagsReset();
-  }

```

##### Attempt 3

- Path: /tmp/edit-bench-batch-Fg6OzI/backend.js
- Operation: —

**Tool error**

```
Found 2 matches for context 'bridge.send('overrideComponentFilters', savedComponentFilters);' in /tmp/edit-bench-batch-Fg6OzI/backend.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ bridge.send('overrideComponentFilters', savedComponentFilters);
   }

   const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
   if (typeof onReloadAndProfileFlagsReset === 'function') {
     onReloadAndProfileFlagsReset();
   }

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

   const unsubscribeBackend = initBackend(
     hook,
     agent,
     window,
     isReloadAndProfileSupported,
   );

+  if (typeof onReloadAndProfileFlagsReset === 'function') {
+    onReloadAndProfileFlagsReset();
+  }
-
-  if (typeof onReloadAndProfileFlagsReset === 'function') {
-    onReloadAndProfileFlagsReset();
-  }

```

## Flaky Tasks (partial passing)

### Access Remove Optional Chain 002 (TimelineContext.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 38 / 948 | 15.9s |
| 2 | ❌ | File mismatch for TimelineContext.js | 45 / 1,164 | 18.1s |
| 3 | ❌ | File mismatch for TimelineContext.js | 13 / 654 | 9.0s |

### Call Swap Call Args 001 (testHelpers.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for testHelpers.js | 15 / 1,117 | 15.0s |
| 2 | ❌ | File mismatch for testHelpers.js | 15 / 596 | 11.3s |
| 3 | ✅ | — | 18 / 538 | 9.3s |

### Call Swap Call Args 003 (SyntheticEvent.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for SyntheticEvent.js | 14 / 1,311 | 13.0s |
| 2 | ✅ | — | 13 / 1,029 | 11.4s |
| 3 | ❌ | File mismatch for SyntheticEvent.js | 26 / 1,868 | 21.5s |

### Duplicate Duplicate Line Flip 003 (SyntheticEvent.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 15 / 479 | 10.1s |
| 2 | ✅ | — | 46 / 1,562 | 23.8s |
| 3 | ❌ | File mismatch for SyntheticEvent.js | 14 / 820 | 16.8s |

### Identifier Identifier Multi Edit 001 (TabBar.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 53 / 1,771 | 26.1s |
| 2 | ❌ | File mismatch for TabBar.js | 13 / 837 | 11.0s |
| 3 | ❌ | File mismatch for TabBar.js | 15 / 904 | 9.8s |

### Identifier Identifier Multi Edit 002 (EventPluginRegistry.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 27 / 903 | 15.4s |
| 2 | ❌ | File mismatch for EventPluginRegistry.js | 13 / 617 | 9.4s |
| 3 | ✅ | — | 19 / 859 | 11.6s |

### Import Swap Named Imports 003 (StyleEditor.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 15 / 421 | 7.5s |
| 2 | ❌ | File mismatch for StyleEditor.js | 15 / 822 | 11.7s |
| 3 | ❌ | File mismatch for StyleEditor.js | 13 / 1,074 | 15.4s |

### Literal Off By One 001 (githubAPI.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for githubAPI.js | 15 / 516 | 7.2s |
| 2 | ✅ | — | 15 / 395 | 6.9s |
| 3 | ✅ | — | 15 / 427 | 8.3s |

### Literal Off By One 003 (InspectedElement.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for InspectedElement.js | 19 / 531 | 9.7s |
| 2 | ✅ | — | 21 / 633 | 11.6s |
| 3 | ✅ | — | 13 / 645 | 10.1s |

### Operator Swap Comparison 002 (ReactFlightDOMServerBrowser.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for ReactFlightDOMServerBrowser.js | 14 / 1,111 | 13.8s |
| 2 | ✅ | — | 15 / 671 | 11.0s |
| 3 | ❌ | File mismatch for ReactFlightDOMServerBrowser.js | 57 / 1,516 | 26.3s |

### Operator Swap Increment Decrement 001 (ReactFlightDOMClientNode.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 14 / 466 | 7.8s |
| 2 | ❌ | File mismatch for ReactFlightDOMClientNode.js | 15 / 555 | 9.3s |
| 3 | ✅ | — | 15 / 516 | 9.1s |

### Operator Swap Logical 001 (profiling.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 39 / 1,124 | 15.2s |
| 2 | ❌ | File mismatch for profiling.js | 15 / 462 | 7.7s |
| 3 | ❌ | File mismatch for profiling.js | 15 / 446 | 10.6s |

### Operator Swap Logical 002 (SourceMapMetadataConsumer.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 13 / 699 | 10.5s |
| 2 | ❌ | File mismatch for SourceMapMetadataConsumer.js | 50 / 1,848 | 24.9s |
| 3 | ✅ | — | 45 / 1,791 | 24.5s |

### Operator Swap Nullish 002 (EnterLeaveEventPlugin.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for EnterLeaveEventPlugin.js | 45 / 1,489 | 23.4s |
| 2 | ✅ | — | 22 / 663 | 8.9s |
| 3 | ✅ | — | 57 / 2,250 | 33.3s |

### Operator Swap Nullish 003 (backend.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 18 / 681 | 11.1s |
| 2 | ❌ | File mismatch for backend.js | 15 / 407 | 7.2s |
| 3 | ❌ | File mismatch for backend.js | 70 / 1,690 | 29.2s |

### Regex Swap Regex Quantifier 003 (utils.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 39 / 1,473 | 20.1s |
| 2 | ❌ | File mismatch for utils.js | 15 / 1,018 | 12.8s |
| 3 | ✅ | — | 15 / 687 | 9.7s |

### Structural Remove Early Return 001 (InspectedElementStateTree.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for InspectedElementStateTree.js | 20 / 704 | 10.6s |
| 2 | ✅ | — | 15 / 577 | 9.3s |
| 3 | ❌ | File mismatch for InspectedElementStateTree.js | 19 / 795 | 12.7s |

### Structural Remove Early Return 002 (useCommitFilteringAndNavigation.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 15 / 487 | 8.0s |
| 2 | ✅ | — | 13 / 455 | 8.5s |
| 3 | ❌ | File mismatch for useCommitFilteringAndNavigati... | 15 / 476 | 7.2s |

## Failed Tasks (0% passing)

### Access Remove Optional Chain 003 (astUtils.js) — 0/3

**All runs failed with same error:** File mismatch for astUtils.js

**Sample agent response (run 1):**
```
Done. I've restored the optional chaining on line 345. The bracket access `bindings[hookDeclaredVariableName]` now uses optional chaining syntax `bindings?.[hookDeclaredVariableName]` to safely handle the case where `bindings` might be null or undefined.
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

### Call Swap Call Args 002 (FlamegraphChartBuilder.js) — 0/3

**All runs failed with same error:** File mismatch for FlamegraphChartBuilder.js

**Sample agent response (run 1):**
```
Done. The bug was at line 130 in the `getChartData` function. The call `walkTree(id, baseDuration, 1)` had its arguments swapped - `baseDuration` and `1` were in the wrong order. They've been swapped to `walkTree(id, 1, baseDuration)` to match the correct parameter order: `(id, rightOffset, currentDepth)`.
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
@@ -141 @@
         throw Error(`Could not find node with id "${id}" in commit tree`);
       }
       baseDuration += node.treeBaseDuration;
-      walkTree(id, baseDuration, 1);
+      walkTree(id, 1, baseDuration);
     }
 
     fiberActualDurations.forEach((duration, id) => {
```

### Literal Flip Boolean 003 (ReactFlightDOMClientEdge.js) — 0/3

**All runs failed with same error:** File mismatch for ReactFlightDOMClientEdge.js

**Sample agent response (run 1):**
```
Fixed. The inverted boolean was on line 98: `options.replayConsoleLogs === false` should be `options.replayConsoleLogs !== false`. The original code would invert the boolean value, causing the opposite behavior than intended.
```

**Diff (expected vs actual):**
```diff
@@ -100 @@
     typeof options.nonce === 'string' ? options.nonce : undefined,
     options && options.temporaryReferences ? options.temporaryReferences : undefined,
     __DEV__ && options && options.findSourceMapURL ? options.findSourceMapURL : undefined,
-    __DEV__ && options ? options.replayConsoleLogs === true : false, // defaults to false
+    __DEV__ && options ? options.replayConsoleLogs !== false : false, // defaults to false
     __DEV__ && options && options.environmentName ? options.environmentName : undefined,
     __DEV__ && options && options.startTime != null ? options.startTime : undefined,
     __DEV__ && options && options.endTime != null ? options.endTime : undefined,
```

### Literal Off By One 002 (code-path.js) — 0/3

**All runs failed with same error:** File mismatch for code-path.js

**Sample agent response (run 1):**
```
Done. The off-by-one error has been fixed. The `end` variable is now set to `segment.nextSegments.length` instead of `segment.nextSegments.length - 1`. This ensures proper boundary checking: when `index < end`, we have more segments to process; when `index === end`, we've processed all segments and should pop the stack.
```

**Diff (expected vs actual):**
```diff
@@ -220 @@
       }
 
       // Update the stack.
-      end = segment.nextSegments.length - 1;
+      end = segment.nextSegments.length;
       if (index < end) {
         item[1] += 1;
         stack.push([segment.nextSegments[index], 0]);
@@ -226 @@
         stack.push([segment.nextSegments[index], 0]);
       } else if (index === end) {
         item[0] = segment.nextSegments[index];
-        item[1] = 0;
+        item[1] = 1;
       } else {
         stack.pop();
       }
```

### Operator Remove Negation 001 (ReactDOMClient.js) — 0/3

**All runs failed with same error:** File mismatch for ReactDOMClient.js

**Sample agent response (run 1):**
```
Done. The stray logical negation (`!`) has been removed from line 58 (the protocol test). The condition now correctly checks if the protocol IS `https?` or `file` (standard protocols) before showing the DevTools download message, rather than the inverted logic that would only show the message for exotic protocols.
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

**All runs failed with same error:** File mismatch for ReactFlightUnbundledReferences.js

**Sample agent response (run 1):**
```
Let me continue reading to find the 'then' case:
```

**Diff (expected vs actual):**
```diff
@@ -243 @@
       );
       return true;
     case 'then':
-      if (target.then) {
+      if (!target.then) {
         // Use a cached value
         return target.then;
       }
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

**All runs failed with same error:** File mismatch for hooks.js

**Sample agent response (run 1):**
```
Done. The arithmetic operator bug was in the `useIsOverflowing` function. The comparison was using `<=` (less than or equal to) when it should have been `<` (less than). When the container width is *exactly equal* to the total child width, the content fits without overflowing, so the function should only return true when the container is strictly smaller than the content.
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

### Structural Delete Statement 002 (getComponentNameFromFiber.js) — 0/3

**All runs failed with same error:** File mismatch for getComponentNameFromFiber.js

**Sample agent response (run 1):**
```
Fixed. I restored the deleted statement on line 61:
```javascript
const functionName = getComponentNameFromType(innerType) || '';
```

This statement was missing from the `getWrappedName` function. It retrieves the component name from the `innerType` parameter and stores it in `functionName`, which is then used in the return statement to conditionally wrap the name with the wrapper name (e.g., "ForwardRef(MyComponent)").
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

### Structural Delete Statement 003 (simulateBrowserEventDispatch.js) — 0/3

**All runs failed with same error:** File mismatch for simulateBrowserEventDispatch.js

**Sample agent response (run 1):**
```
The bug has been fixed. The critical missing statement was the `return` keyword in the `simulateEventDispatch` function.

**The issue:** The function was calling `await _dispatch.call(this, eventImpl)` but not returning the result. The `_dispatch` function returns `!eventImpl._canceledFlag` (line 236), which indicates whether the event was prevented or not. This return value must be propagated back to the caller.

**The fix:** Added `return` before the `await _dispatch.call(this, eventImpl)` ...
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

### Structural Remove Early Return 003 (ReactFiberAsyncAction.js) — 0/3

**All runs failed with same error:** File mismatch for ReactFiberAsyncAction.js

**Sample agent response (run 1):**
```
Perfect. The guard clause has been restored. The removed guard clause was checking `if (currentEntangledListeners === null) return;`, which prevents the function from executing the cleanup logic if there are no listeners. By removing the nesting level and adding the early return guard clause back, the code maintains the correct logic flow while being clearer and avoiding unnecessary nesting.
```

**Diff (expected vs actual):**
```diff
@@ -101 @@
     if (pendingEntangledRoots === 0) {
       stopIsomorphicDefaultIndicator();
     }
-    if (currentEntangledListeners !== null) {
-      // All the actions have finished. Close the entangled async action scope
-      // and notify all the listeners.
-      if (currentEntangledActionThenable !== null) {
-        const fulfilledThenable: FulfilledThenable<void> = (currentEntangledActionThenable: any);
-        fulfilledThenable.status = 'fulfilled';
-      }
-      const listeners = currentEntangledListeners;
-      currentEntangledListeners = null;
-      currentEntangledLane = NoLane;
-      currentEntangledActionThenable = null;
-      needsIsomorphicIndicator = false;
-      for (let i = 0; i < listeners.length; i++) {
-        const listener = listeners[i];
-        listener();
-      }
+    if (currentEntangledListeners === null) {
+      return;
     }
     }
+    // All the actions have finished. Close the entangled async action scope
+    // and notify all the listeners.
+    if (currentEntangledActionThenable !== null) {
+      const fulfilledThenable: FulfilledThenable<void> = (currentEntangledActionThenable: any);
+      fulfilledThenable.status = 'fulfilled';
+    }
+    const listeners = currentEntangledListeners;
+    currentEntangledListeners = null;
+    currentEntangledLane = NoLane;
+    currentEntangledActionThenable = null;
+    needsIsomorphicIndicator = false;
+    for (let i = 0; i < listeners.length; i++) {
+      const listener = listeners[i];
+      listener();
+    }
   }
 }
 
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
Perfect. The bug is fixed. The two adjacent statements have been swapped back to their correct order:

- **Before**: `flushBuffered` was incorrectly nested inside the `stringToChunk` function body
- **After**: `stringToChunk` properly returns `textEncoder.encode(content)`, followed by `flushBuffered` as a separate method in the config object

The code structure is now correct with proper method definitions in the ReactFlightServer configuration object.
```

**Diff (expected vs actual):**
```diff
@@ -42 @@
   completeWriting(destination: Destination): void {},
   close(destination: Destination): void {},
   closeWithError(destination: Destination, error: mixed): void {},
-  flushBuffered(destination: Destination): void {},
   stringToChunk(content: string): Uint8Array {
     return textEncoder.encode(content);
   },
   stringToChunk(content: string): Uint8Array {
     return textEncoder.encode(content);
   },
+  flushBuffered(destination: Destination): void {},
   stringToPrecomputedChunk(content: string): Uint8Array {
     return textEncoder.encode(content);
   },
```

### Structural Swap Adjacent Lines 003 (backend.js) — 0/3

**All runs failed with same error:** File mismatch for backend.js

**Sample agent response (run 1):**
```
Now I still have a duplicate. Let me reconsider. Looking at the code structure, the real bug is that the flag reset is in the wrong place compared to adding listeners. Let me read the file completely again to understand what the original should have been:
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
@@ -366 @@
   if (onSettingsUpdated != null) {
     agent.addListener('updateHookSettings', onSettingsUpdated);
   }
+  if (typeof onReloadAndProfileFlagsReset === 'function') {
+    onReloadAndProfileFlagsReset();
+  }
   agent.addListener('shutdown', () => {
     if (onSettingsUpdated != null) {
       agent.removeListener('updateHookSettings', onSettingsUpdated);
```

### Structural Swap If Else 001 (importFile.js) — 0/3

**All runs failed with same error:** File mismatch for importFile.js

**Sample agent response (run 1):**
```
Done. The fix negates the condition from `if (error instanceof InvalidProfileError)` to `if (!(error instanceof InvalidProfileError))` and swaps the branch bodies. Now:
- When error is NOT an InvalidProfileError, it returns `INVALID_PROFILE_ERROR` status
- When error IS an InvalidProfileError, it returns `UNEXPECTED_ERROR` status

This corrects the swapped logic.
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
         status: 'INVALID_PROFILE_ERROR',
         error,
```

### Structural Swap If Else 002 (ReactNativeFiberInspector.js) — 0/3

**All runs failed with same error:** File mismatch for ReactNativeFiberInspector.js

**Sample agent response (run 1):**
```
Done. The bug was in the `getInspectorDataForViewTag` function where the if and else branches were logically swapped. The condition `if (__DEV__)` has been negated to `if (!__DEV__)` so that:
- In **production** (`__DEV__` is false): throws an error as intended
- In **development** (`__DEV__` is true): returns the inspector data as intended

This now matches the expected behavior and the pattern used in `getInspectorDataForViewAtPoint`.
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
